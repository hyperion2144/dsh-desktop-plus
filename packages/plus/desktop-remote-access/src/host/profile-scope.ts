/**
 * 按 profile 隔离的存储落点（#145）。
 *
 * 同一个 `$DSH_HOME` 下可以并存多个 profile（desktop、web、自建 profile……），
 * 每个 profile 是**独立的一次运行**：配对设备、会话 cookie、隧道地址、调优参数
 * 都不该串。以前这些状态共用 `$DSH_HOME/storages/remote-access/`，导致桌面 lane
 * 签发的 cookie 在另一个 profile 的 lane 里也被认（cookie 不区分端口）。
 *
 * 现在统一落到 `$DSH_HOME/storages/remote-access/profiles/<profile>/`：
 *
 * ```
 * profiles/<profile>/pairing.json    配对设备与会话 cookie
 * profiles/<profile>/settings.json   隧道地址 / cloudflared 路径 / ws 调优
 * profiles/<profile>/access.log      转发访问日志
 * ```
 *
 * profile 名由官方 `profileContext.name` 提供；拿不到时回退 `default`（单 profile
 * 场景与旧行为一致，不会因为缺服务就写不进去）。
 */
import os from 'node:os'
import path from 'node:path'

/** 拿不到 profile 名时的回退目录名。 */
export const DEFAULT_PROFILE_SCOPE = 'default'

/** 当前进程的 profile 名；由插件入口在启动时写入（官方 profileContext.name）。 */
let profileScope: string = DEFAULT_PROFILE_SCOPE

/**
 * 设置当前 profile 名（插件入口在 apply 时调用一次）。
 * @param name - 官方 `profileContext.name`；空值忽略，保持回退值。
 */
export function setProfileScope(name: string | null | undefined): void {
  if (typeof name !== 'string') return
  const trimmed = name.trim()
  if (trimmed === '') return
  // 目录名安全：只留字母数字与 . _ -，其余换成 -（profile 名来自官方，正常不会触发）。
  profileScope = trimmed.replace(/[^A-Za-z0-9._-]/gu, '-')
}

/**
 * 当前 profile 名。
 * @returns 已净化的 profile 名，或回退值。
 */
export function currentProfileScope(): string {
  return profileScope
}

/**
 * 插件在 `$DSH_HOME` 下的根目录（不含 profile 段）。
 * @returns 绝对路径。
 */
export function remoteAccessRoot(): string {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'storages', 'remote-access')
}

/**
 * 当前 profile 的存储目录。
 * @returns 绝对路径。
 */
export function profileStorageDir(): string {
  return path.join(remoteAccessRoot(), 'profiles', profileScope)
}

/**
 * 当前 profile 下的某个文件路径。
 * @param name - 文件名（如 `pairing.json`）。
 * @returns 绝对路径。
 */
export function profileStoragePath(name: string): string {
  return path.join(profileStorageDir(), name)
}

/**
 * 旧版（未按 profile 隔离）的存储目录，只用于一次性迁移读取。
 * @returns 绝对路径。
 */
export function legacyStorageDir(): string {
  return remoteAccessRoot()
}
