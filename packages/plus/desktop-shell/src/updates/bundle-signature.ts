/**
 * macOS bundle 签名形态判定与更新安装模式决策（#122）。
 *
 * ShipIt（Squirrel.Mac）安装前用已装应用的 designated requirement 校验下载的
 * 更新；ad-hoc 签名的隐式 DR 是裸 cdhash 锚，任何新构建都无法满足，因此未签名
 * 的 macOS 构建走应用内自更新必然失败。这里只做判定，动作分流在 install-gate。
 */

/** 一次 codesign 检查得到的 bundle 签名形态。 */
export type MacosBundleSignature = 'developer-id' | 'ad-hoc' | 'unknown'

/** 更新安装动作走哪条路：官方 ShipIt 交接，或打开 dmg 由用户手动安装。 */
export type MacosUpdateInstallMode = 'shipit' | 'manual'

/**
 * 解析 `codesign -dv` 的合并输出（stdout + stderr）。
 * ad-hoc 签名带 `Signature=adhoc` 与 flags 里的 `(adhoc,…)` 标记；Developer ID
 * 签名带 10 字符 TeamIdentifier（`not set` 是 ad-hoc/未签名的特征，不算数）。
 * 两者都不满足（未签名、输出不认识）一律 `unknown`。
 * @param codesignOutput - codesign 的合并输出。
 * @returns bundle 签名形态。
 */
export function parseMacosBundleSignature(codesignOutput: string): MacosBundleSignature {
  if (/(?:Signature=adhoc\b|\(adhoc[,)])/m.test(codesignOutput)) return 'ad-hoc'
  if (/^TeamIdentifier=[A-Z0-9]{10}\s*$/m.test(codesignOutput)) return 'developer-id'
  return 'unknown'
}

/**
 * 安装模式决策：非 darwin 与有效 Developer ID 签名走官方 ShipIt；ad-hoc 与
 * `unknown` 走手动安装——未知按未签名兑底，不把用户推进注定失败的安装。
 * @param platform - 运行平台。
 * @param signature - bundle 签名形态。
 * @returns 安装模式。
 */
export function resolveMacosUpdateInstallMode(platform: NodeJS.Platform, signature: MacosBundleSignature): MacosUpdateInstallMode {
  if (platform !== 'darwin') return 'shipit'
  if (signature === 'developer-id') return 'shipit'
  return 'manual'
}

/** 可注入的 codesign 执行器；进程无法启动时抛错，非零退出仍需带回输出。 */
export type CodesignRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>

/**
 * 对一个 .app 路径做 codesign 检查。先 `--verify --strict`（损坏签名在这里失败），
 * 再 `-dv` 解析形态；执行器抛错（codesign 缺失、超时等）一律收敛为 `unknown`，
 * 由调用方按未签名兑底。
 * @param appPath - `.app` bundle 路径（打包态为 execPath 向上三级）。
 * @param run - codesign 执行器（真实进程或测试桩）。
 * @returns bundle 签名形态。
 */
export async function inspectMacosBundleSignature(appPath: string, run: CodesignRunner): Promise<MacosBundleSignature> {
  try {
    // -dv 只展示不校验：先 --verify --strict 确认签名自洽（损坏签名在这里失败），再看 Team 锚。
    await run(['--verify', '--strict', appPath])
    const result = await run(['-dv', '--verbose=4', appPath])
    return parseMacosBundleSignature(`${result.stdout}\n${result.stderr}`)
  } catch {
    return 'unknown'
  }
}
