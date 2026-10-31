/**
 * 展示用的应用版本号（关于窗口、托盘状态、诊断里的那一个）。
 *
 * 打包构建用 `extraMetadata.version` 让 Electron 读到的版本就是 plus 版本，再用
 * `DSH_DESKTOP_BUILD_VERSION` 显式给壳一份；开发态没有这两层（应用跑在上游树上，
 * `app.getVersion()` 返回官方版本号），由开发启动器写入同一个变量。
 *
 * 不读包 manifest：壳会被打包器内联进桌面主 bundle，`import.meta.url` 那时指向上游
 * 应用目录，读到的会是官方版本号。
 */

/** 打包脚本与开发启动器共用的版本注入变量。 */
export const BUILD_VERSION_ENV = 'DSH_DESKTOP_BUILD_VERSION'

/**
 * 解析展示用版本号：只认注入变量。
 * @param injected - 版本注入值；缺省读 {@link BUILD_VERSION_ENV}。
 * @returns plus 版本号，解析不到时 `undefined`（调用方回退 `app.getVersion()`）。
 */
export function plusApplicationVersion(injected: string | undefined = process.env[BUILD_VERSION_ENV]): string | undefined {
  if (injected === undefined) return undefined
  const value = injected.trim()
  return value === '' ? undefined : value
}
