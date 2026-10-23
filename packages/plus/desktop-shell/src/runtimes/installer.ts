// 运行时安装/卸载编排（#28）。官方没有这一层 —— 桌面更新是整包替换，运行时独立落盘。
//
// 流程：installTree 拉取并解包到 <runtimes>/<version>.staging → verifyDesktopRuntime 校验 →
// 原子 rename 到 <runtimes>/<version>。任一步失败或取消都清掉 staging，绝不留半截目录；
// 已装版本重装 = 先清旧目录再落位。卸载拒绝当前运行时（正在被 host 使用）。
// installTree 的真实实现在壳侧注入（npm 拉取 @deepseek-ai/dsh@<version> 依赖树，与打包
// prepare 同机制），本模块只编排顺序、守卫与清理，全部可测。

import { rmSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 依赖注入（测试注入内存实现）。 */
export interface RuntimeInstallerDeps {
  /** 拉取并解包版本依赖树到 destination（staging 目录，由本模块创建/清理）。 */
  installTree: (version: string, destination: string, options: RuntimeInstallOptions) => Promise<void>
  /** 校验落盘目录是可用的 dsh 运行时；失败抛错。 */
  verify: (directory: string) => Promise<void>
  /** 当前激活的运行时版本（正在被 host 使用的那个）；未知为 undefined。 */
  activeVersion: () => string | undefined
  log?: ((line: string) => void) | undefined
}

export interface RuntimeInstallOptions {
  onProgress?: ((bytes: number, totalBytes: number | undefined) => void) | undefined
  signal?: AbortSignal | undefined
}

export interface RuntimeInstaller {
  /** runtimes 根目录（<userData>/runtimes）。 */
  readonly root: string
  install(version: string, options?: RuntimeInstallOptions): Promise<void>
  uninstall(version: string): void
}

/** Normalizes a version like `v1.2.3` / `1.2.3-rc.1` to the bare semver core. */
export function normalizeRuntimeVersion(version: string): string {
  const trimmed = version.trim()
  const withoutSuffix = trimmed.split('+')[0] ?? trimmed
  return withoutSuffix.startsWith('v') ? withoutSuffix.slice(1) : withoutSuffix
}

export function createRuntimeInstaller(root: string, deps: RuntimeInstallerDeps): RuntimeInstaller {
  const log = deps.log ?? (() => { })
  const versionDir = (version: string): string => join(root, version)
  // Read through a function: AbortSignal.aborted mutates at runtime, so narrowing a
  // direct property check would wrongly reject the second cancellation probe.
  const isAborted = (options: RuntimeInstallOptions): boolean => options.signal?.aborted === true

  return {
    root,
    async install(version: string, options: RuntimeInstallOptions = {}): Promise<void> {
      const final = normalizeRuntimeVersion(version)
      if (final === '') throw new Error('runtime install: empty version')
      if (isAborted(options)) throw new Error('runtime install: cancelled')
      const destination = versionDir(final)
      const staging = `${destination}.staging`
      rmSync(staging, { recursive: true, force: true })
      try {
        await deps.installTree(version, staging, options)
        if (isAborted(options)) throw new Error('runtime install: cancelled')
        await deps.verify(staging)
        if (existsSync(destination)) {
          log(`runtime ${final}: replacing existing install`)
          rmSync(destination, { recursive: true, force: true })
        }
        renameSync(staging, destination)
        log(`runtime ${final}: installed at ${destination}`)
      } catch (error) {
        // Never leave a half-installed tree behind: the retry starts from an empty staging.
        rmSync(staging, { recursive: true, force: true })
        throw error
      }
    },
    uninstall(version: string): void {
      const final = normalizeRuntimeVersion(version)
      if (deps.activeVersion() === final) {
        throw new Error(`runtime ${final} is the active runtime and cannot be removed; switch to another runtime first`)
      }
      const destination = versionDir(final)
      if (!existsSync(destination)) throw new Error(`runtime ${final} is not installed`)
      rmSync(destination, { recursive: true, force: true })
      log(`runtime ${final}: removed`)
    },
  }
}
