// 把 plus 桌面插件挂进 dsh profile 的 node_modules（符号链接，幂等）。
//
// dsh 的插件就是一个能被 profile 解析到的包。bun 时期的做法是把包目录 symlink 进
// `<profile>/node_modules/<包名>`（旧壳 Rust 的 materialize_pool_package），不跑 pnpm ——
// 装包要联网，启动期一次 pnpm install 就能让窗口永远出不来。这里沿用同一条路子：
// 建链接是本地操作、毫秒级、幂等；单插件失败只说一句，桌面本体照常启动。
//
// 幂等判定看链接指向：已经指向同一个包目录就跳过；悬空链接（包被移动/删除）重建。

import { existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 一个待挂载的插件：包名 + 包目录。 */
export interface StagedPluginSource {
  name: string
  dir: string
}

/** 依赖注入（测试注入假 fs）。 */
export interface StagePluginsDeps {
  /** dsh profile 目录（$DSH_HOME/profiles/<name>）。 */
  profileDir: string
  /** 要挂进去的插件包。 */
  plugins: readonly StagedPluginSource[]
  log?: ((line: string) => void) | undefined
}

/** 已挂上的链接。 */
export interface StagedPlugin {
  name: string
  dir: string
  link: string
}

/** 本次挂载结果；failed 里的插件只是缺席，不影响桌面启动。 */
export interface StagePluginsResult {
  staged: StagedPlugin[]
  already: string[]
  failed: { name: string; reason: string }[]
  /** profile 清单是否被改动（依赖 + bundles 登记）。 */
  manifest: boolean
}

/** 链接已经指向同一个包目录。 */
function linkedTo(link: string, dir: string): boolean {
  try {
    return readlinkSync(link) === dir
  } catch {
    return false
  }
}

/** 一份最小 profile 清单：dependencies 供解析，dsh.profile.bundles 决定谁被打包层加载。 */
interface ProfileManifest {
  dependencies: Record<string, string>
  dsh: { profile: { bundles: string[] } }
  [key: string]: unknown
}

/** 读出 profile 清单；缺失/损坏就返回一个空壳（写回时重建，不丢其它字段）。 */
function readProfileManifest(profileDir: string): ProfileManifest {
  const path = join(profileDir, 'package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { dependencies: {}, dsh: { profile: { bundles: [] } } }
  }
  const base = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const dependencies = typeof base.dependencies === 'object' && base.dependencies !== null ? (base.dependencies as Record<string, string>) : {}
  const dsh = typeof base.dsh === 'object' && base.dsh !== null ? (base.dsh as Record<string, unknown>) : {}
  const profile = typeof dsh.profile === 'object' && dsh.profile !== null ? (dsh.profile as Record<string, unknown>) : {}
  const bundles = Array.isArray(profile.bundles) ? (profile.bundles as string[]) : []
  return { ...base, dependencies, dsh: { profile: { bundles } } }
}

/**
 * 把插件登记进 profile：dependencies 写 `link:<包目录>`（与 dsh plugin add 的本地包形式一致），
 * bundles 追加包名（dsh 只对列在这里的包应用其 cordis.patch.yml）。
 * @param profileDir - dsh profile 目录
 * @param plugins - 已就位的插件
 * @returns 清单是否被改动（已登记就不碰文件，保留 mtime）
 */
function registerProfileManifest(profileDir: string, plugins: readonly StagedPluginSource[]): boolean {
  const manifest = readProfileManifest(profileDir)
  let changed = false
  for (const plugin of plugins) {
    const wanted = `link:${plugin.dir}`
    if (manifest.dependencies[plugin.name] !== wanted) {
      manifest.dependencies[plugin.name] = wanted
      changed = true
    }
    if (!manifest.dsh.profile.bundles.includes(plugin.name)) {
      manifest.dsh.profile.bundles = [...manifest.dsh.profile.bundles, plugin.name]
      changed = true
    }
  }
  if (!changed) return false
  const path = join(profileDir, 'package.json')
  mkdirSync(profileDir, { recursive: true })
  const temporary = `${path}.plus-tmp`
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(temporary, path)
  return true
}

/**
 * 把插件包挂进 profile 的 node_modules。从不抛错：缺一个插件只是少一块桌面 UI。
 * @param deps - profile 目录、待挂插件与日志出口
 * @returns 新挂载、已存在、失败的清单
 */
export function stageDesktopPlugins(deps: StagePluginsDeps): StagePluginsResult {
  const log = deps.log ?? (() => {})
  const pool = join(deps.profileDir, 'node_modules')
  const staged: StagedPlugin[] = []
  const already: string[] = []
  const failed: { name: string; reason: string }[] = []
  try {
    mkdirSync(pool, { recursive: true })
  } catch (error) {
    return { staged, already, failed: deps.plugins.map((plugin) => ({ name: plugin.name, reason: `node_modules unavailable: ${String(error)}` })), manifest: false }
  }
  for (const plugin of deps.plugins) {
    if (!existsSync(join(plugin.dir, 'package.json'))) {
      failed.push({ name: plugin.name, reason: `no package.json at ${plugin.dir}` })
      continue
    }
    const link = join(pool, plugin.name)
    try {
      if (linkedTo(link, plugin.dir)) {
        already.push(plugin.name)
        continue
      }
      rmSync(link, { recursive: true, force: true })
      mkdirSync(dirname(link), { recursive: true })
      symlinkSync(plugin.dir, link, 'dir')
      staged.push({ name: plugin.name, dir: plugin.dir, link })
    } catch (error) {
      failed.push({ name: plugin.name, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  const present = [...staged, ...already.map((name) => ({ name, dir: deps.plugins.find((plugin) => plugin.name === name)?.dir ?? '' }))]
    .filter((entry) => entry.dir !== '')
    .map((entry) => ({ name: entry.name, dir: entry.dir }))
  let manifest = false
  try {
    manifest = registerProfileManifest(deps.profileDir, present)
  } catch (error) {
    failed.push({ name: 'profile-manifest', reason: error instanceof Error ? error.message : String(error) })
  }
  log(`plus plugins: staged ${String(staged.length)}, already ${String(already.length)}, failed ${String(failed.length)}, manifest ${manifest ? 'updated' : 'unchanged'}`)
  for (const entry of failed) log(`plus plugin skipped: ${entry.name} — ${entry.reason}`)
  return { staged, already, failed, manifest }
}
