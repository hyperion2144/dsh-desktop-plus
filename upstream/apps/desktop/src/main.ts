import type { ProductEventMap, ProductEvent } from '@deepseek-ai/dsh-client-product-analytics/types'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'
/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  powerSaveBlocker,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Session,
} from 'electron'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { applyLoginItemFromEnv, remoteProfileName, loadRemoteAddressList, partitionFor, remoteOrigin, listProfileDirs, createProfilesRpcHandlers, createUpdatesRpcHandlers, createSettingsRpcHandlers, createNotificationsRpcHandlers, applyWindowsAppUserModelId, attachDownloads, attachPackagedDevTools, attachPageConsole, collectDiagnostics, clearSelectedRuntime, createDownloadRpcHandlers, createElectronProfileRuntime, createLoggingKernel, createLoggingRpcHandlers, createProfileTray, createRpcRegistry, createShellKernel, ensurePlusProfileBundles, PLUS_BUNDLE_NAMES, DEFAULT_PROFILE, resolveStartupRuntimeSelection, restartApplicationInPlace, runPlusStartup, loadDesktopSettings, saveDesktopSettings, soundCapabilityReport, playSoundFile, createLifecycleRpcHandlers, resolveProxyEnv, proxyEnvRecord, detectSystemProxy, plusApplicationVersion, type RpcRegistry, type ProfileTray } from '@deepseek-ai/dsh-desktop-plus-shell'
import { createBusyLease, createPlusNotifier, createSleepGate, createSplashWindow, deliverHostNotice, loadNotificationConfig, noticePolicyFromConfig, systemDefaultSoundCommand, type RestartAllOutcome } from '@deepseek-ai/dsh-desktop-plus-shell'
import { plusShellCopy } from '@deepseek-ai/dsh-desktop-plus-shell'
import { installShellConsoleTee } from '@deepseek-ai/dsh-desktop-plus-shell'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import { promptProfileName } from './profile-name-window.ts'
import { confirmProfileDelete } from './profile-delete-window.ts'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager } from './project-manager.ts'
import { DesktopHostFatalError, DesktopHostProcess, DesktopHostUncleanExitError, setPlusShellNotifyHandler, setPlusShellRpcHandler } from './host-process.ts'
import { DesktopPlatformView, PLATFORM_IPC, platformBounds } from './platform-view.ts'
import { installDesktopFileDrag } from './file-drag.ts'
import { installDesktopDirectoryPicker } from './directory-picker.ts'
import { installMicrophonePermissions } from './microphone-permissions.ts'
import { DesktopBackendController } from './backend-controller.ts'
import { DESKTOP_IPC, SCHEME, assertDesktopSender, type DesktopUpdateState } from './ipc.ts'
import { readDeviceInfo } from './device-info.ts'
import { desktopUpdateReadyConfirmation, formatDesktopMessage, resolveDesktopLocale, resolveDesktopStartupLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { desktopUpdateChannel } from './update-channel.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { prepareDesktopUpdateWindow } from './update-window.ts'
import { DesktopCommandManager } from './command-management.ts'
import { serveWebDocument, authenticateWebHost, forwardWebRequest } from './web-document.ts'
import { DesktopFatalRecovery } from './fatal-recovery.ts'
import { pruneCrashReports, RendererConsoleTail, writeCrashReport, type CrashReportSource } from './crash-report.ts'
import { OperationJournal } from './operation-journal.ts'
import { runOperationReportJob, type OperationReportJobResult } from './operation-report-job.ts'
import { openWelcomeWindow } from './welcome-window.ts'
import { WELCOME_IPC, needsWelcome, type WelcomeNotice } from './welcome-api.ts'
import { connectDesktopWelcome, type DesktopWelcomeBackend } from './welcome-backend.ts'
import { DesktopUpdateJournal } from './update-journal.ts'
import { DesktopUpdatePreparationError } from './update-error.ts'
import { DesktopUpdateSchedule, resolveDesktopUpdateScheduleConfig } from './update-schedule.ts'
import { desktopUpdateErrorSummary, presentDesktopUpdate } from './update-presentation.ts'
import { desktopErrorState } from './startup-error.ts'
import { readDesktopLoginShellEnvironment, resolveDesktopLoginShellConfig } from './login-shell-environment.ts'
import { DesktopMandatoryUpdatePolicy, resolveDesktopPolicyConfig, type DesktopPolicyState } from './mandatory-update-policy.ts'
import { desktopClientMetadata, desktopClientVersion } from './client-metadata.ts'
import { DesktopMandatoryUpdateWindow } from './mandatory-update-window.ts'
import { DesktopPolicyTestAuth } from './policy-test-auth.ts'
import { readDesktopSettings } from './settings.ts'
import { readDesktopLocaleCache, writeDesktopLocaleCache } from './locale-cache.ts'
import { DesktopUpdateDialog, type UpdateDialogOptions } from './update-dialog.ts'
import { readDesktopRuntime, verifyDesktopRuntime } from './runtime-tree.ts'
import { DesktopBrowserGuests } from './browser-guests.ts'
import { installDesktopShortcuts } from './keyboard.ts'
import { DesktopUpdateOverlays } from './update-overlay.ts'
import { DesktopQuitConfirmation } from './quit-confirmation.ts'
import { DesktopTray } from './tray.ts'
import { DesktopBackgroundNotice } from './background-notice.ts'

let focusPrimaryWindow = (): void => {}
let stopForRecovery = async (): Promise<void> => { await stopOperationReports() }
let shuttingDown = false
/**
 * Set by quit entries that must not ask: crash recovery exit and restart, and the
 * development restart command. The installer handoff has its own before-quit branch.
 */
let skipQuitConfirmation = false
let windowsLanguage: string | undefined = readDesktopLocaleCache(app.getPath('userData'))
/**
 * The official main window, resolved live: the plus tray reads it before the window exists.
 */
let plusDesktopWindow: () => BrowserWindow | undefined = () => undefined
/**
 * Restarts the official backend inside this process: the Host stops and starts again.
 */
let plusRestartBackend: (() => Promise<void>) | undefined
/** #8：profile 窗口的官方 createWindow 工厂；main() 启动后注入（依赖 appPreload/quitting 等主进程态）。 */
let plusProfileWindowFactory: ((name: string) => BrowserWindow) | undefined
/** 只停官方后端（托盘的「退出 profile」对默认 profile 用它：停实例、关窗、托盘留驻）。 */
let plusStopBackend: (() => Promise<void>) | undefined
/** The plus profile tray, so profile and window changes can refresh its menu. */
let plusProfileTray: ProfileTray | undefined
/** Rebuilds the plus tray menu from the live profile and window state. */
function refreshPlusTray(): void {
  if (!plusShell.state.tray) return
  plusProfileTray?.refresh()
}
/** 官方「检查更新」入口（main() 内定义）：托盘只转发，不重写更新流程。 */
let plusOpenUpdatePrompt: ((manual?: boolean) => void) | undefined
/** 官方「注册命令」入口（DesktopCommandManager.show）：托盘只转发，不复制安装逻辑。 */
let plusShowCliCommands: (() => void) | undefined

/**
 * 托盘里的应用级条目：状态（只读）、检查更新、安装 CLI 命令、打开日志目录、开发者工具。
 * 每一条都转发到官方已有入口（electron-updater / DesktopCommandManager / webContents），
 * 托盘不实现它们；官方入口不可用时置灰，不造成功假象。
 * @returns application-level tray items, rebuilt from live state on every refresh.
 */
function plusApplicationMenuItems(): MenuItemConstructorOptions[] {
  const cp = plusShellCopy(currentDesktopLocale().id)
  // desktop 是官方宿主，不在 plusProfiles 的托管列表里：状态行要把它单独带上，
  // 否则宿主明明在跑却显示「运行中 profile：无」。
  const running = [
    ...(plusDesktopWindow() === undefined
      ? []
      : [`${DEFAULT_PROFILE} · ${plusHostPort === null ? cp.unknown : String(plusHostPort)}`]),
    ...plusProfiles.manager.list().map((entry) => `${entry.name} · ${String(plusProfilePorts.get(entry.name) ?? cp.unknown)}`),
  ]
  const stateRows: MenuItemConstructorOptions[] = [
    { label: `${cp.appVersion}: ${plusDisplayVersion()}`, enabled: false },
    { label: `${cp.builtinDsh}: ${plusBuiltinRuntimeVersion ?? cp.unknown}`, enabled: false },
    { label: `${cp.hostPort}: ${plusHostPort === null ? cp.notStarted : String(plusHostPort)}`, enabled: false },
    { label: `${cp.runningProfiles}: ${running.length === 0 ? cp.none : running.join(cp.zh ? '、' : ', ')}`, enabled: false },
    { label: `${cp.logDir}: ${plusLogDir}`, enabled: false },
  ]
  // 官方只在 macOS / Windows 摆「注册命令」，且未装在应用程序目录时 worker 会拒绝。
  const cliReady = plusShowCliCommands !== undefined && app.isPackaged &&
    (process.platform === 'darwin' ? app.isInApplicationsFolder() : process.platform === 'win32')
  return [
    { label: cp.status, submenu: stateRows },
    { type: 'separator' },
    { label: cp.checkUpdates, enabled: plusOpenUpdatePrompt !== undefined, click: () => { plusOpenUpdatePrompt?.(true) } },
    { label: cp.installCli, enabled: cliReady, click: () => { plusShowCliCommands?.() } },
    { type: 'separator' },
    { label: cp.openLogs, click: () => { void shell.openPath(plusLogDir) } },
    { label: cp.developerTools, click: () => { togglePlusDevTools() } },
  ]
}

/** 新建 profile：官方脚手架写三份文件，已存在不覆盖；不合法名与已存在都如实回原因。 */
function plusCreateProfile(name: string): { ok: boolean, reason?: string } {
  const trimmed = name.trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return { ok: false, reason: 'profile 名只能用小写字母、数字与连字符' }
  try {
    const dir = resolveProfileDir(trimmed, resolveDshHome())
    if (existsSync(dir)) return { ok: false, reason: `profile ${trimmed} 已存在` }
    const template = PROFILE_TEMPLATES.web
    if (template === undefined) return { ok: false, reason: '官方缺少 web profile 模板' }
    initProfile(dir, [...template.bundles, ...PLUS_BUNDLE_NAMES])
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** 删除 profile：挡默认 profile、运行中的 profile 与远程地址，其余整目录删除。 */
function plusDeleteProfile(name: string): { ok: boolean, reason?: string } {
  if (name === DEFAULT_PROFILE) return { ok: false, reason: '默认 profile 不能删除' }
  if (loadRemoteAddressList(resolveDshHome()).some((url) => remoteProfileName(url) === name)) return { ok: false, reason: '远程地址不是本地目录，不能在这里删除' }
  if (plusProfiles.manager.list().some((entry) => entry.name === name)) return { ok: false, reason: `profile ${name} 正在运行，先退出再删` }
  try {
    const dir = resolveProfileDir(name, resolveDshHome())
    if (!existsSync(dir)) return { ok: false, reason: `profile ${name} 不存在` }
    rmSync(dir, { recursive: true, force: true })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
/** Restarts the official backend in place; the tray's restart entries go through it. */
async function restartOfficialBackend(): Promise<void> {
  if (plusRestartBackend === undefined) throw new Error('dsh desktop: the desktop backend is not ready')
  // #⑦：先关旧窗（splash 已盖住）→ 重启宿主 → reconcile 里的 openInitialWindow 重建窗口并导航新地址。
  plusRebuildingDesktopWindow = true
  plusDesktopWindow()?.destroy()
  try {
    await plusRestartBackend()
  } finally {
    plusRebuildingDesktopWindow = false
  }
}

/**
 * 托盘/侧边栏的「退出 desktop profile」：真退出语义 = 停 dsh 进程树 + 销毁窗口（不是隐藏）。
 * destroy 绕过官方 close→hide 拦截；plusRebuildingDesktopWindow 让 window-all-closed 在这段
 * 时间不退主进程（托盘与应用留驻，#11 原话第 4 条）。closed 事件自带托盘刷新。
 */
async function quitDesktopProfile(): Promise<void> {
  if (plusStopBackend === undefined) return
  plusRebuildingDesktopWindow = true
  try {
    await plusStopBackend()
    plusDesktopWindow()?.destroy()
  } finally {
    plusRebuildingDesktopWindow = false
  }
}

/** profile 名对应的运行中宿主实例（主宿主不在表内，见 plusProfileOfWindow）。 */
const plusProfileHostInstances = new Map<string, DesktopHostProcess>()

/**
 * Profile name that owns one window, derived from the page URL port the profile host
 * reported; the primary window keeps no entry in `plusProfilePorts`.
 * @param window - window whose profile is asked for.
 * @returns The owning DesktopHostProcess and profile name; `name` is undefined for the primary window.
 */
function plusProfileHostOfWindow(window: BrowserWindow): { host: DesktopHostProcess; name: string | undefined } | undefined {
  try {
    const port = Number(new URL(window.webContents.getURL()).port) || undefined
    if (port === undefined || !plusProfilePorts.size) return undefined
    for (const [name, value] of plusProfilePorts) {
      if (value !== port) continue
      const host = plusProfileHostInstances.get(name)
      if (host !== undefined) return { host, name }
    }
    return undefined
  } catch {
    return undefined
  }
}

/** 主宿主实例桥接：右键「重载插件」的编排定义在 main 内，用它拿到 DesktopHostProcess。 */
let plusPrimaryHost: DesktopHostProcess | undefined
/** 右键菜单（模块级 createWindow 内）经它调 main 内的编排；main 装配后赋值。 */
let plusReloadPlugins: ((window: BrowserWindow) => Promise<void>) | undefined

/**
 * Whether the backend has reached ready: false until the first ready, back to
 * false when a restart returns it to starting, frozen during shutdown so a
 * failure while tearing down a ready backend still reads as `running`.
 */
let backendReady = false
/** Error-level console output of the primary window, attached to crash reports. */
const rendererConsole = new RendererConsoleTail()

// Platform-conventional logs directory (macOS ~/Library/Logs/<name>, otherwise under userData);
// set before ready so the first fatal report already resolves under it.
// #2：plus 与官方桌面同机共存——官方包把 userData 落在 @deepseek-ai/dsh-desktop，
// 两包共用会互抢单实例锁：官方在跑时 plus 的 requestSingleInstanceLock 直接失败，
// 表现为点击 Dock 图标闪一下即退。plus 钉自己的 userData（在任何锁/设置读取之前）。
app.setPath('userData', join(app.getPath('appData'), 'DSH Desktop Plus'))
app.setName('DSH Desktop Plus')

// #5：托盘/右键菜单的 DevTools 统一为 detach 弹窗，与 F12 行为一致；已打开则关闭。
function togglePlusDevTools(): void {
  const window = plusDesktopWindow()
  if (window === undefined) return
  const wc = window.webContents
  if (wc.isDevToolsOpened()) wc.closeDevTools()
  else wc.openDevTools({ mode: 'detach' })
}

// #11：退出流程中断开页面 console 镜像，host 断连的 connection lost 不再写进退出日志。
app.setAppLogsPath()

/**
 * 展示用的应用版本（关于窗口 / 托盘状态）。
 * 打包构建把 plus 版本注入 `DSH_DESKTOP_BUILD_VERSION`，并用 `extraMetadata.version` 覆盖 Electron 的版本；
 * 开发态两层都没有（跑在上游树上），所以由壳从自己的 manifest 读 plus 版本（见 `plusApplicationVersion`）。
 * @returns plus 版本号，无注入时回退 Electron 读到的版本。
 */
function plusDisplayVersion(): string {
  return plusApplicationVersion() ?? app.getVersion()
}
function currentDesktopLocale(): ReturnType<typeof resolveDesktopLocale> {
  // #4：Windows 重启路径上 app.getLocale() 偶发回落 en-US；系统语言列表更可靠，优先用它。
  return resolveDesktopLocale(windowsLanguage ?? app.getPreferredSystemLanguages()[0] ?? app.getLocale())
}

/**
 * Install the host auth cookie into one Electron session.
 * The inspector panel is a same-origin iframe on the host origin: its document and its
 * `ws://` upgrades need this cookie to pass `authorizeIndex`. Setting the same value
 * twice is a no-op, so every call site may re-assert it.
 * @param origin - host origin (`http://127.0.0.1:<port>`).
 * @param cookie - `name=value` from `authenticateWebHost`; undefined before the host is up.
 * @param target - session to write into; the default session unless a window passes its own.
 */
async function installHostSessionCookie(origin: string, cookie: string | undefined, target: Session = session.defaultSession): Promise<void> {
  if (cookie === undefined) return
  const [name, ...value] = cookie.split('=')
  if (name === undefined || name === '' || value.length === 0) return
  try {
    // 诊断面板 iframe 挂在宿主 origin，相对 dsh-app:// 页面是第三方上下文：Lax/Strict 的 cookie
    // 不会随 iframe 请求发出，诊断页就会回「dsh web authentication required」。
    // 127.0.0.1 属于可信源，Chromium 允许 SameSite=None 不配 Secure。
    await target.cookies.set({ url: origin, name, value: value.join('='), httpOnly: true, sameSite: 'no_restriction' })
  } catch (error) {
    // 写 cookie 失败只影响诊断面板鉴权，不影响启动；记一行日志便于排查。
    plusLogger.append(`[desktop] host session cookie not installed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
/** Quit without the task confirmation; the caller has already decided the application must stop. */
function quitWithoutConfirmation(): void {
  skipQuitConfirmation = true
  app.quit()
}
const recovery = new DesktopFatalRecovery({
  messages: () => currentDesktopLocale().messages,
  show: options => dialog.showMessageBox(options),
  stop: () => { shuttingDown = true; return stopForRecovery() },
  disablePlugins: async () => {
    const manager = new DesktopProjectManager(resolveDesktopPaths(), runtimeResources())
    const backupPath = await manager.disableAllPlugins()
    console.info('Desktop profile recovery completed:', { profilePatchBackup: backupPath ?? null, homePatch: 'unchanged' })
  },
  exit: () => { quitWithoutConfirmation() },
  restart: () => { app.relaunch(); quitWithoutConfirmation() },
  writeReport: (error, source) => persistCrashReport(error, source),
  revealReport: async (path) => { await access(path); shell.showItemInFolder(path) },
})

let operationJournal: OperationJournal | undefined
let operationReportJob: Promise<OperationReportJobResult> | undefined
let operationReportAbort: AbortController | undefined
let operationReportsStopping = false
let operationReportStop: Promise<void> | undefined

/** Bound application shutdown waiting without claiming that an unresponsive Worker has exited. */
function stopOperationReports(): Promise<void> {
  operationReportStop ??= waitForOperationReports()
  return operationReportStop
}

async function waitForOperationReports(): Promise<void> {
  operationReportsStopping = true
  operationReportAbort?.abort()
  const job = operationReportJob
  if (job === undefined) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const exited = await Promise.race([job.then(() => true), new Promise<false>((resolve) => {
      timer = setTimeout(() => { resolve(false) }, 500)
    })])
    if (!exited) console.error('dsh desktop: operation report Worker has not exited; continuing shutdown')
  } finally { clearTimeout(timer) }
}

function persistCrashReport(error: unknown, source: CrashReportSource): Promise<string | undefined> {
  const directory = app.getPath('logs')
  const report = writeCrashReport(directory, {
    operationHistoryPlanned: !shuttingDown && !operationReportsStopping,
    source,
    phase: backendReady ? 'running' : 'startup',
    error,
    ...(error instanceof DesktopHostFatalError && error.diagnostic !== undefined ? { hostDiagnostic: error.diagnostic } : {}),
    rendererConsole: rendererConsole.snapshot(),
    app: {
      name: app.name, version: plusDisplayVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, locale: currentDesktopLocale().id,
    },
    time: new Date(),
  })
  void report.then((path) => {
    if (path !== undefined && operationReportJob === undefined && !shuttingDown && !operationReportsStopping) {
      operationReportAbort = new AbortController()
      operationReportJob = runOperationReportJob({ reportPath: path, directory: join(app.getPath('userData'), 'plugin-operations'),
        limits: { bytes: 64 * 1024, recordBytes: 4096, records: 100, outputBytes: 64 * 1024 },
        journal: operationJournal?.status() ?? null,
      }, { timeoutMs: 500, cancellationGraceMs: 100 }, operationReportAbort.signal)
      void operationReportJob.finally(() => { operationReportJob = undefined; operationReportAbort = undefined })
    }
  }).catch((_error: unknown) => { /* Basic persistence failure is owned by fatal recovery. */ })
  return report
}

function reportFatal(error: unknown, source: CrashReportSource): void {
  console.error(error)
  if (shuttingDown) {
    // No dialog during shutdown, but the report still records what failed on the way out.
    void persistCrashReport(error, source)
    return
  }
  void recovery.report(error, source).catch(async (failure: unknown) => {
    console.error(failure)
    shuttingDown = true
    await stopOperationReports()
    app.exit(1)
  })
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    codeCache: true,
  },
}])

interface RuntimeResources {
  readonly nodeBin: string
  readonly node: string
  readonly pnpm: string
  readonly dsh: string
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = process.execPath
  const nodeBin = development ? join(app.getAppPath(), 'scripts', 'node-bin') : join(process.resourcesPath, 'runtime', 'bin')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? (development ? join(app.getAppPath(), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
      : join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'))
  const dsh = (development ? process.env.DSH_DESKTOP_DSH_DIR : undefined)
    ?? (development ? join(app.getAppPath(), '.desktop-build', 'development', 'project') : plusRuntimeDshOverride ?? join(app.getAppPath(), 'dsh'))
  return { node, nodeBin, pnpm, dsh }
}

function developmentPrimaryRuntime(): string {
  const directory = process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR
  if (directory === undefined || directory === '') {
    throw new Error('dsh desktop: DSH_DESKTOP_PRIMARY_RUNTIME_DIR is required for an unpackaged launch')
  }
  return directory
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

/**
 * Opaque chrome fallback matching the built-in sidebar palette (the resolved
 * `--dsw-static-neutral-bluish-900` / `-50` tokens). An approximation for
 * custom themes: Windows swaps in the renderer's measured palette over the
 * windowsAppearance IPC, and macOS shows it only while minimized or hidden.
 * @returns the sidebar fill hex for the active system color scheme.
 */
function chromeFallbackFill(): string {
  return nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb'
}

/**
 * Add the effective Desktop palette to a Platform authorization URL so the
 * login page opens in the application's theme. `system` resolves through
 * `nativeTheme.shouldUseDarkColors`, which follows the theme source the
 * application preload publishes.
 * @param authorizeUrl - validated Platform authorization URL.
 * @returns the authorization URL carrying `theme=light` or `theme=dark`.
 */
function platformLoginUrl(authorizeUrl: string): string {
  const url = new URL(authorizeUrl)
  url.searchParams.set('theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  return url.href
}

  /**
   * 创建应用窗口。
   * @param preload - 窗口 preload 脚本路径。
   * @param show - 创建即显示。
   * @param primary - 主窗口（决定退出/单实例等主窗口语义）。
   * @param partition - 可选 session partition（profile 窗口隔离 cookie/存储）。
   * @param chrome - 是否用桌面 chrome（Win 隐藏标题栏 + webview）。#1：与 primary 解耦，profile 窗口也要。
   */
  function createWindow(preload: string, show = false, primary = false, partition?: string, chrome = primary): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    show,
    ...(process.platform === 'win32' && chrome ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT, color: chromeFallbackFill(),
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115' },
    } : {}),
    // hiddenInset places traffic lights inside the sidebar; sidebar vibrancy
    // needs a transparent window background to show through the page.
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      // 'active' keeps the vibrancy material stable when the window blurs;
      // 'followWindow' washes the sidebar out behind an unfocused window.
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    webPreferences: {
      preload,
      // #8：profile 窗口带自己的 session partition（隔离 cookie/存储），其余与主窗口同构。
      ...(partition === undefined ? {} : { partition }),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: chrome,
      devTools: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.platform === 'darwin' || process.platform === 'win32') {
    // Fullscreen hides native window controls; overlays drop their caption clearance.
    const sendFullscreen = (): void => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.windowFullscreen, window.isFullScreen())
    }
    window.on('enter-full-screen', sendFullscreen)
    window.on('leave-full-screen', sendFullscreen)
    // Reloads and navigations re-register the preload listener; resend the
    // current state so a fullscreen reload does not fall back to windowed CSS.
    window.webContents.on('did-finish-load', sendFullscreen)
  }
  if (process.platform === 'darwin') {
    // Deminiaturize reattaches the NSVisualEffectView material late
    // (electron/electron#25368), so a transparent window shows the desktop
    // through the sidebar until then. Paint an opaque base while minimized or
    // hidden so the deminiaturize animation and the reattachment gap show a
    // solid fill; restoring flips back, and the null -> 'sidebar' transition
    // forces the material to reattach.
    const applyBackdrop = (): void => {
      if (window.isDestroyed()) return
      if (window.isMinimized() || !window.isVisible()) {
        window.setVibrancy(null)
        window.setBackgroundColor(chromeFallbackFill())
      } else {
        window.setVibrancy('sidebar')
        window.setBackgroundColor('#00000000')
      }
    }
    window.on('minimize', applyBackdrop)
    window.on('hide', applyBackdrop)
    window.on('restore', applyBackdrop)
    window.on('show', applyBackdrop)
  }
  // 页面右键菜单：官方只给编辑角色，空白处什么都不弹；这里补齐 bun 旧壳的能力
  // （重新加载 / 在新浏览器开链接 / 复制链接 / 开发者工具），实现复用官方这套
  // Menu.buildFromTemplate + popup，不另建第二条菜单通道。
  window.webContents.on('context-menu', (_event, params) => {
    const { isEditable, selectionText, editFlags, linkURL } = params
    const copy = plusShellCopy(currentDesktopLocale().id)
    const items: MenuItemConstructorOptions[] = []
    if (linkURL !== '') {
      items.push(
        { label: copy.openLink, click: () => { void shell.openExternal(linkURL) } },
        { label: copy.copyLink, click: () => { clipboard.writeText(linkURL) } },
        { type: 'separator' },
      )
    }
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll },
      )
    } else if (selectionText.length > 0) {
      items.push({ role: 'copy', enabled: editFlags.canCopy })
    }
    // 空白处也要有菜单（bun 旧壳就是如此）：强制重载（绕过插件 bundle 缓存，#12）+ 开发者工具。
    if (items.length === 0) {
      items.push({ label: `${copy.reloadPage}${currentDesktopLocale().id.startsWith('zh') ? '（重载插件）' : ' (reload plugins)'}`, click: () => { void plusReloadPlugins?.(window) } })
      // 开发者工具只在设置开关打开时出现，且永远由人工触发；不自动弹窗。
      if (loadPlusDesktopSettings().dev_tools === true) {
        items.push(
          { type: 'separator' },
          { label: copy.openDevTools, click: () => { togglePlusDevTools() } },
        )
      }
    }
    // Empty accelerators suppress Electron's default shortcut labels for native roles.
    if (items.length > 0) {
      const messages = currentDesktopLocale().messages
      Menu.buildFromTemplate(items.map(item => ({
        ...item,
        ...(process.platform === 'win32' && item.role !== undefined && item.role in messages
          ? { label: messages[item.role as keyof typeof messages] } : {}),
        accelerator: '',
      }))).popup({ window })
    }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url)
    const current = new URL(window.webContents.getURL())
    if (destination.protocol !== `${SCHEME}:`
      && !(destination.protocol === 'http:' && destination.origin === current.origin)) {
      event.preventDefault()
      if (['http:', 'https:'].includes(destination.protocol)) void shell.openExternal(url)
    }
  })
  return window
}

async function main(onHostOutput?: (line: string) => void): Promise<void> {
  const desktopSettings = readDesktopSettings(app.getPath('userData'))
  void pruneCrashReports(app.getPath('logs'))
  const journalDirectory = process.env.DSH_DESKTOP_UPDATE_JOURNAL_DIR
  const updateJournal = journalDirectory === undefined ? undefined : new DesktopUpdateJournal(journalDirectory, app.getVersion())
  try {
    const selection = await resolveStartupRuntimeSelection(app.getPath('userData'), {
      verifyRuntime: async (root, version) => { await verifyDesktopRuntime(root, version) },
      clearSelected: () => clearSelectedRuntime(app.getPath('userData')),
    })
    if (selection.kind === 'selected') plusRuntimeDshOverride = selection.root
    else if (selection.kind === 'fallback') console.error(`plus runtime ${selection.version} unusable, falling back to builtin: ${selection.reason}`)
  } catch (error) {
    console.error('plus runtime selection failed, using builtin', error)
  }
  startPlusDownloads()
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  // plus 插件是安装内置 bundle（asar 的 dsh/node_modules，经 cli 依赖闭包打入），
  // 组合走官方 bundle 层机制：每个 profile 的 dsh.profile.bundles 列出包名，
  // 宿主按各包自己的 cordis.patch.yml 叠层；启用/停用由插件管理器照常处理。
  ensurePlusProfileBundles(
    [paths.profile, ...listProfileDirs(resolveDshHome())
      .map((name) => resolveProfileDir(name, resolveDshHome()))
      .filter((dir) => dir !== paths.profile)],
    PROFILE_TEMPLATES.web?.bundles ?? [],
    (line: string) => plusLogger.append(line),
  )
  const development = !app.isPackaged
  // 开发态的 .app 是 Electron 壳：Dock 图标要换回官方图标，否则显示 Electron 默认图标。
  if (development && process.platform === 'darwin') {
    const devIcon = join(app.getAppPath(), 'resources', 'icon-macos.png')
    if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
  }
  const primaryRuntime = development
    ? developmentPrimaryRuntime()
    : join(process.resourcesPath, 'runtime', 'primary-runtime')
  // 内置 dsh 版本：官方不变式「内置运行时版本 = 桌面声明版本」，所以直接用应用版本，
  // 不再去运行时树里猜路径（dev 下那棵树是外部目录，路径不固定）。
  plusBuiltinRuntimeVersion = app.getVersion()
  const activeProject = paths.profile
  const manager = new DesktopProjectManager(paths, resources)
  // Dock and Finder launches inherit only launchd's environment; every Host shares one login-shell read.
  const loginShellRead = new AbortController()
  // The probe runs in its own process group, which outlives Desktop unless the read is aborted.
  app.on('will-quit', () => { loginShellRead.abort() })
  const loginShell = readDesktopLoginShellEnvironment(process.env, resolveDesktopLoginShellConfig(process.env), {
    signal: loginShellRead.signal,
  }).then((result) => {
    for (const failure of result.failures) console.warn(`desktop login shell: ${failure.shell} failed (${failure.reason})`)
    return result.environment
  })
  let hostEnvironment: NodeJS.ProcessEnv = process.env
  const prepareHostEnvironment = async (): Promise<void> => { hostEnvironment = await loginShell }
  // The plus profile windows start their own Host runtimes from the official seams.
  plusProfileHostContext = { resources, primaryRuntime, hostEnvironment: () => hostEnvironment }
  let quitting = false
  let startup: Promise<void> | undefined
  let workspaceRecovery: Promise<void> | undefined
  let mainWindow: BrowserWindow | undefined
  // The plus tray reads the official window through this getter; the window itself appears later.
  plusDesktopWindow = () => mainWindow
  let welcomeWindow: BrowserWindow | undefined
  const installFileDrag = (): (() => Promise<void>) => installDesktopFileDrag(
    event => assertProductSender(event),
    (address, signal) => {
      const host = backend.host
      if (host === undefined) return Promise.reject(new Error('File drag Host unavailable'))
      return host.resolveDragResource(address, signal)
    },
  )
  const fileDragCleanups = new Set([installFileDrag()])
  let fileDragStopped = false
  const disposeFileDrag = async (): Promise<void> => {
    fileDragStopped = true
    const results = await Promise.allSettled([...fileDragCleanups].map(async (release) => {
      await release()
      fileDragCleanups.delete(release)
    }))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
  let enteredWorkspace = false
  // NSIS passes --updated when it launches the application after installation.
  let raiseAfterUpdate = process.platform === 'win32' && process.argv.includes('--updated')
  let shellInstallerOwnsQuit = false
  let requireCleanStop = false
  let updateStoppedHost = false
  let updateStopFailure: DesktopHostUncleanExitError | undefined
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const systemLanguages = app.getPreferredSystemLanguages()
  let locale = windowsLanguage === undefined
    ? resolveDesktopStartupLocale(null, systemLanguages) : resolveDesktopLocale(windowsLanguage)
  windowsLanguage = locale.id
  let mandatoryPolicy: DesktopMandatoryUpdatePolicy | undefined
  let mandatoryUI: DesktopMandatoryUpdateWindow | undefined
  let policyAuth: DesktopPolicyTestAuth | undefined
  let tray: DesktopTray | undefined
  /**
   * The operating system is ending the session: the quit skips its confirmation. Windows sets it
   * on the definitive session-end message. macOS sets it on the power-off notification, which
   * another application can still cancel, so the next focus or show of the main window clears it.
   */
  let sessionEnding = false
  const isQuitting = (): boolean => quitting
  const currentMainWindow = (): BrowserWindow | undefined => mainWindow
  const ordinaryDialogs = new Set<AbortController>()
  const currentDialogWindow = (): BrowserWindow | undefined => welcomeWindow ?? mainWindow
  const updateOverlays = new DesktopUpdateOverlays()
  const updateDialog = new DesktopUpdateDialog(fileURLToPath(new URL('./preload-update-dialog.cjs', import.meta.url)), () => locale, updateOverlays)
  const isMandatory = (): boolean => mandatoryPolicy?.state.blocking === true
  const ordinaryMessageBox = async (options: UpdateDialogOptions): Promise<Electron.MessageBoxReturnValue> => {
    const controller = new AbortController()
    ordinaryDialogs.add(controller)
    try {
      const parent = currentDialogWindow()
      if (parent === undefined) return { response: options.cancelId ?? 0, checkboxChecked: false }
      return await updateDialog.show(parent, { ...options, signal: controller.signal })
    }
    finally { ordinaryDialogs.delete(controller) }
  }

  /**
   * 右键「重载插件」的统一入口（unlag 移植，壳侧编排）：先让对应宿主重新收集 boot
   * 注入/清单（插件管理器启停或产物更新后的最新 rev），成功才重载页面——页面不再拿
   * 启动时冻结的旧清单，也不会再触发 web boot 批量 import 失败；宿主不可用或收集失败
   * 时弹窗说明，不盲刷。
   * @param window - 要刷新的窗口。
   */
  async function reloadPluginsInWindow(window: BrowserWindow): Promise<void> {
    const zh = currentDesktopLocale().id.startsWith('zh')
    const primary = plusDesktopWindow()
    const isPrimary = primary === undefined || window === primary
    const target = isPrimary ? plusPrimaryHost : plusProfileHostOfWindow(window)?.host
    try {
      if (target === undefined) throw new Error(zh ? '宿主进程不在运行' : 'The host process is not running')
      const fresh = await target.refreshReady()
      if (isPrimary) {
        injections = fresh.injections ?? injections
        hostUrl = fresh.url
      } else {
        const profile = plusProfileHostOfWindow(window)
        if (profile?.name !== undefined) {
          const port = Number(new URL(fresh.url).port) || undefined
          if (port !== undefined) plusProfilePorts.set(profile.name, port)
        }
      }
      window.webContents.reloadIgnoringCache()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      plusLogger.append(`[desktop] plugin reload failed: ${detail}`)
      await ordinaryMessageBox({ type: 'warning',
        title: zh ? '重载插件' : 'Reload plugins',
        message: zh ? '无法重载插件' : 'Cannot reload plugins',
        detail: zh ? `宿主未返回新的插件清单：${detail}\n页面保持原样，可稍后重试。` : `The host did not return a fresh plugin roster: ${detail}\nThe page was left as is; try again later.`,
        buttons: [zh ? '好' : 'OK'] })
    }
  }
  plusReloadPlugins = reloadPluginsInWindow
  // #7：菜单与关于框里的产品名跟 app.getName()（DSH Desktop Plus），不再出现官方名。
  const plusMenuMessage = (key: 'aboutMenu' | 'hideApplication' | 'aboutProduct'): string => {
    const zh = currentDesktopLocale().id.startsWith('zh')
    const name = app.getName()
    if (key === 'aboutMenu') return zh ? `关于 ${name}` : `About ${name}`
    if (key === 'hideApplication') return zh ? `隐藏 ${name}` : `Hide ${name}`
    return name
  }
  // Copy comes from the same locale as the update prompts so the dialog
  // chrome and its content never mix languages.
  const showAbout = async (): Promise<void> => {
    await ordinaryMessageBox({ type: 'info', title: plusMenuMessage('aboutMenu'), message: plusMenuMessage('aboutProduct'),
      detail: formatDesktopMessage(locale.messages.aboutVersion, { version: plusDisplayVersion() }),
      buttons: [locale.messages.updateAcknowledge], cancelId: 0 })
  }
  const commandManager = new DesktopCommandManager({
    resources: process.resourcesPath,
    isPackaged: app.isPackaged,
    isInstalledLocation: () => process.platform !== 'darwin' || app.isInApplicationsFolder(),
    isInstalling: () => updateState.phase === 'installing',
    isQuitting,
    messages: () => currentDesktopLocale().messages,
    show: ordinaryMessageBox,
  })
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const applicationUrl = `${SCHEME}://app/`
  let hostUrl: string | undefined
  let hostCookie: string | undefined
  const browserGuests = new DesktopBrowserGuests(() => hostUrl)
  let injections: readonly unknown[] = []
  let welcomeBackend: DesktopWelcomeBackend | undefined
  let reportedLaunch = false
  let analyticsEnabled = false
  const track = async <K extends keyof ProductEventMap>(eventName: K, attributes: ProductEventMap[K]): Promise<void> => {
    const event = { eventName, attributes, timestamp: Date.now() } as ProductEvent
    try {
      if (analyticsEnabled) await welcomeBackend?.report(event)
    } catch (_error) { /* Analytics cannot interrupt native actions. */ }
  }
  let stopAccount: (() => void) | undefined
  let openedAttempt: string | undefined
  let returnedAttempt: string | undefined
  let pendingWelcomeNotice: WelcomeNotice | undefined
  let previousAccountStatus: string | undefined
  const assertProductSender = (event: IpcMainInvokeEvent): BrowserWindow => {
    assertDesktopSender(event, ['app'])
    if (mainWindow === undefined || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
      || event.senderFrame === null || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('dsh desktop: rejected IPC from an unowned renderer')
    }
    return mainWindow
  }
  let navigation: { window: BrowserWindow; url: string; promise: Promise<void> } | undefined
  const navigateMain = (url: string): Promise<void> => {
    const window = mainWindow
    if (quitting || window === undefined || window.isDestroyed()) return Promise.resolve()
    if (navigation?.window === window && navigation.url === url) return navigation.promise
    const next = { window, url, promise: Promise.resolve() }
    next.promise = window.loadURL(url).catch((error: unknown) => {
      if (quitting || shuttingDown || window.isDestroyed() || navigation !== next
        || (error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED')) return
      navigation = undefined
      throw error
    })
    navigation = next
    return next.promise
  }
  const platformView = new DesktopPlatformView(join(app.getAppPath(), 'lib', 'preload-platform-account.cjs'),
    () => locale.id === 'zh-CN' ? 'zh_CN' : 'en_US', process.platform === 'win32' ? 'win32' : 'darwin',
    owner => isMandatory() || updateOverlays.input(owner).blocked)
  const backend = new DesktopBackendController((onFailure) => {
    const hostInspectPort = developmentHostInspectPort(development)
    plusShell.noteHostPhase('starting')
    const trackedFailure = (error: Error): void => { plusShell.noteHostPhase('failed', error); onFailure(error) }
    const host = new DesktopHostProcess(resources.node, resources.dsh, activeProject,
      hostInspectPort, { ...hostEnvironment, ...resolvedProxyEnvRecord(), DSH_CLIENT_VERSION: desktopClientVersion(), DSH_REMOTE_LANE_PORT: String(lanePortFor(DEFAULT_PROFILE)), DSH_DESKTOP_PORT_FILE: join(app.getPath('userData'), 'dsh-desktop-port'), ...plusTelemetryOptOutEnv() }, trackedFailure,
      primaryRuntime,
      resources, (next) => { platformView.setSession(next) }, (record) => {
        operationJournal ??= new OperationJournal(join(app.getPath('userData'), 'plugin-operations'), {
          segmentBytes: 256 * 1024, recordBytes: 4096, queuedBytes: 64 * 1024,
        })
        operationJournal.enqueue(JSON.stringify(record))
      }, (line) => { plusLogger.append(`[${DEFAULT_PROFILE}] ${line}`); onHostOutput?.(line) })
    plusPrimaryHost = host
    return {
      start: async () => {
        const ready = await host.start()
        writeDshPortFileFromUrl(ready.url)
        plusShell.noteHostPhase('ready')
        hostCookie = await authenticateWebHost(ready.url)
        // #7：cookie 在 host ready 就入会话——诊断面板若在启动 IPC 之前挂 iframe，也能过鉴权。
        await installHostSessionCookie(new URL(ready.url).origin, hostCookie)
        hostUrl = ready.url
        // 设置面板要显示宿主端口（get_dsh_source / get_dsh_status）：hostUrl 是 main() 局部变量，
        // 模块级的 RPC handlers 拿不到，所以在这里把端口同步出去。
        plusHostPort = Number(new URL(ready.url).port) || null
        if (ready.injections === undefined) throw new Error('Desktop Host did not provide boot injections')
        injections = ready.injections
        welcomeBackend = await connectDesktopWelcome(ready.url, (input, init) => net.fetch(input, init), async () => (await session.defaultSession.cookies.get({ url: ready.url })).map(cookie => `${cookie.name}=${cookie.value}`).join('; '))
        analyticsEnabled = await welcomeBackend.analyticsEnabled().catch(() => false)
        if (!reportedLaunch) { reportedLaunch = true; void track('desktop_app_launch', {}) }
        stopAccount?.()
        const accountBackend = welcomeBackend.account
        stopAccount = accountBackend.watch((state) => {
          if (quitting) return
          if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.webContents.send(WELCOME_IPC.state, state)
          const attempt = state.attempt
          if (attempt?.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && openedAttempt !== attempt.id) {
            openedAttempt = attempt.id
            void shell.openExternal(platformLoginUrl(attempt.authorizeUrl)).catch(() => undefined)
          }
          if ((attempt?.phase === 'failed' || attempt?.phase === 'expired') && returnedAttempt !== attempt.id) {
            returnedAttempt = attempt.id
            focusPrimaryWindow()
          }
          if (state.status === 'credential-stored' && attempt?.phase === 'succeeded' && welcomeWindow !== undefined) void enterWorkspace({ activate: false }).catch(() => undefined)
          if (previousAccountStatus === 'credential-stored' && state.status === 'signed-out') {
            void readWelcomeState().then(async (value) => {
              if (needsWelcome(value) && !quitting) {
                enteredWorkspace = false
                await showWelcome()
                if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.webContents.send(WELCOME_IPC.state, state)
              }
              return undefined
            }).catch(() => undefined)
          }
          previousAccountStatus = state.status
      }, () => {
          // The stream reconnects; a transport failure does not change account state.
        }, () => {
          void readWelcomeState().then(async (value) => {
            if (!needsWelcome(value) || quitting) return
            pendingWelcomeNotice = 'session-expired'
            enteredWorkspace = false
            await showWelcome()
            const state = await accountBackend.state()
            if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.webContents.send(WELCOME_IPC.state, state)
          }).catch(() => undefined)
        }, (enabled) => { analyticsEnabled = enabled })
      },
      stop: async () => {
        analyticsEnabled = false
        stopAccount?.()
        try { await host.stop(requireCleanStop) }
        catch (error) {
          if (!requireCleanStop || !(error instanceof DesktopHostUncleanExitError)) throw error
          // Backend cleanup succeeded; installation still rejects the unsuccessful task teardown.
          updateStopFailure = error
        }
      },
      updateTasks: (action: 'inspect' | 'lock' | 'unlock') => host.updateTasks(action),
      inspectQuit: () => host.inspectQuit(),
      resolveDragResource: (address: string, signal?: AbortSignal) => host.resolveDragResource(address, signal),
    }
  }, (state) => {
    if (state.phase === 'error') reportFatal(state.failure, 'host')
    else if (!shuttingDown) backendReady = state.phase === 'ready'
  })

  const updateErrors = new WeakMap<DesktopUpdateState, Promise<void>>()
  const showUpdateFailure = (state: DesktopUpdateState): Promise<void> => {
    if (state.phase !== 'error') return Promise.resolve()
    if (isMandatory()) { mandatoryUI?.sync(); return Promise.resolve() }
    let shown = updateErrors.get(state)
    if (shown === undefined) {
      shown = ordinaryMessageBox({ type: 'error', title: locale.messages.updateFailedTitle,
        message: desktopUpdateErrorSummary(state, locale.messages),
        technicalDetails: state.technicalDetails ?? state.message ?? '' }).then(() => {})
      updateErrors.set(state, shown)
    }
    return shown
  }
  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateJournal?.state(state)
    updateState = state
    mandatoryUI?.sync()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesPresentation, presentDesktopUpdate(state))
    }
    if (state.phase === 'error' && state.failedOperation !== 'check') {
      if (state.failedOperation === 'install' && fileDragStopped && !quitting) {
        fileDragCleanups.add(installFileDrag())
        fileDragStopped = false
      }
      const restoreHost = state.failedOperation === 'install' && updateStoppedHost && !quitting
      if (state.failedOperation === 'install' && !quitting) {
        operationReportsStopping = shuttingDown
        operationReportStop = undefined
      }
      shellInstallerOwnsQuit = false
      updateStoppedHost = false
      if (restoreHost) {
        // Only confirmed process exit permits replacement before another installation confirmation.
        const hostReady = backend.start(prepareHostEnvironment)
        startup = hostReady
        const recovery = hostReady.then(async () => {
          if (quitting) return
          // A replacement Host can have a new port, cookie, or boot injections even at the same URL.
          navigation = undefined
          await navigateMain(applicationUrl)
          if (backend.host !== undefined) updateJournal?.action('workspace-ready')
        })
        workspaceRecovery = recovery
        void recovery.catch((error: unknown) => { reportFatal(error, 'main') }).finally(() => {
          if (startup === hostReady) startup = undefined
          if (workspaceRecovery === recovery) workspaceRecovery = undefined
        })
      }
      void showUpdateFailure(state).catch((error: unknown) => { console.error(error) })
    }
    return state
  }

  const readWelcomeState = async () => {
    if (backend.host === undefined || welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
    return welcomeBackend.read()
  }
  stopForRecovery = async () => {
    const reports = stopOperationReports()
    try { await backend.close() }
    finally { await Promise.all([operationJournal?.drain(500), reports]) }
  }
  // The plus tray restarts the application in place: the backend stops and starts again in this process.
  plusRestartBackend = async () => { await backend.stop(); await reconcileBackend() }
  // 托盘的「退出 profile」对默认 profile：停实例 + 关窗，托盘与应用进程留驻（#11 原话第 4 条）。
  // 停实例必须用 stop()（之后还能 start）；close() 会永久置 closed，重启/重启应用将报 backend is closed。
  plusStopBackend = async () => { await backend.stop() }

  const reconcileBackend = (): Promise<void> => {
    startup ??= (async () => {
      await navigateMain(applicationUrl)
      await backend.start(async () => {
        await Promise.all([manager.applyRelease(), prepareHostEnvironment()])
      })
      if (backend.host !== undefined) await openInitialWindow()
      if (backend.host !== undefined) updateJournal?.action('workspace-ready')
      // The existing Web document resumes through the boot IPC response.
    })().catch((error: unknown) => {
      updateJournal?.action('workspace-failed')
      reportFatal(error, 'main')
      throw error
    }).finally(() => { startup = undefined })
    return startup
  }

  const manifest: unknown = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8'))
  const updateChannel = desktopUpdateChannel(manifest)
  let updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      await commandManager.idle()
      await workspaceRecovery
      await startup?.catch(() => undefined)
      const host = backend.host
      if (host === undefined) throw new DesktopUpdatePreparationError('tasks-unavailable', locale.messages.updateTasksUnavailable)
      const active = await host.updateTasks('inspect')
      const parent = currentDialogWindow()
      if (parent === undefined || !await prepareDesktopUpdateWindow(parent, locale.messages.updateFullscreenTimeout)) return false
      const ready = desktopUpdateReadyConfirmation(locale.messages, updates.state.version ?? '', process.platform)
      const confirmation: Electron.MessageBoxOptions = {
        type: active ? 'warning' : 'info', title: locale.messages.updateTitle,
        message: active ? locale.messages.updateActiveTasks : ready.message,
        detail: active ? locale.messages.updateActiveTasksDetail : ready.detail,
        buttons: active ? [locale.messages.updateStopTasks, locale.messages.updateLater] : [locale.messages.installAndRestart],
        defaultId: 1, cancelId: 1,
      }
      if (isMandatory()) {
        if (!await mandatoryUI?.confirm(updates.state.version ?? '', active)) return false
      } else {
        const result = await updateDialog.show(parent, confirmation)
        if (result.response !== 0 || isMandatory()) return false
      }
      // The update lock rejects new HTTP requests, including analytics intake.
      await track('desktop_upgrade_install_restart_click', {})
      if (backend.host !== host) throw new DesktopUpdatePreparationError('tasks-unavailable', locale.messages.updateTasksUnavailable)
      try {
        const stillActive = await host.updateTasks('lock')
        if (stillActive && !active) throw new DesktopUpdatePreparationError('tasks-changed', locale.messages.updateTasksChanged)
        mandatoryUI?.preparingRestart(stillActive)
        // The embedded Platform document holds credentials issued by the Host that is about to stop.
        await platformView.closeAndWait()
        await disposeFileDrag().catch((error: unknown) => { console.error(error) })
        requireCleanStop = true
        updateStopFailure = undefined
        await Promise.all([backend.stop(), stopOperationReports()])
        updateStoppedHost = true
        // The backend's async cleanup callback can assign this after the reset above.
        const stopFailure = updateStopFailure as DesktopHostUncleanExitError | undefined
        if (stopFailure !== undefined) throw new DesktopUpdatePreparationError('stop-failed', locale.messages.updateStopFailed, stopFailure.message)
        await operationJournal?.drain(500)
        updateJournal?.action('install-confirmed')
        shellInstallerOwnsQuit = true
      } catch (error) {
        operationReportsStopping = shuttingDown
        operationReportStop = undefined
        if (!updateStoppedHost) await host.updateTasks('unlock').catch((unlockError: unknown) => { console.error(unlockError) })
        throw error
      } finally {
        requireCleanStop = false
      }
      return true
    },
    undefined, undefined, undefined,
    (success, reason) => { void track('desktop_upgrade_download_result', { is_success: success, ...reason === undefined ? {} : { error_reason: reason } }) },
    updateChannel,
  )

  const updateSchedule = new DesktopUpdateSchedule(updates, resolveDesktopUpdateScheduleConfig(process.env))

  plusUpdates = updates
  const downloadUpdate = async (version: string): Promise<DesktopUpdateState> => {
    void track('desktop_upgrade_click', {})
    updateJournal?.action('download-requested')
    const state = await updates.download(version)
    if (state.phase !== 'ready' || quitting) return state
    // Only a completed user-driven download opens this prompt; cancelling installation does not reopen it.
    // A confirmation on a hidden window would go unseen, so it waits for the next show; the mandatory
    // flow keeps its own taskbar and Dock attention instead.
    if (!isMandatory()) await windowShown()
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- A quit can begin while the show is awaited.
    if (quitting) return state
    return updates.install(version)
  }
  const windowShown = (): Promise<void> => new Promise((resolve) => {
    const window = currentDialogWindow()
    if (window === undefined || window.isDestroyed() || window.isVisible()) { resolve(); return }
    window.once('show', () => { resolve() })
    window.once('closed', () => { resolve() })
  })

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    // Shell-owned documents live in the application bundle and never pass through the Host.
    if (url.hostname === 'shell') return serveWebDocument(request, join(app.getAppPath(),
      url.pathname === '/design-platform.css' ? 'lib/welcome' : 'renderer'))
    if (url.hostname === 'app') {
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
        || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
        return serveWebDocument(request, join(resources.dsh, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist'))
      }
      if (backend.host === undefined || hostUrl === undefined || hostCookie === undefined) {
        return Promise.resolve(new Response(null, { status: 503 }))
      }
      return forwardWebRequest(request, hostUrl, hostCookie)
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })

  installDesktopDirectoryPicker(() => mainWindow)
  installMicrophonePermissions(session.defaultSession, () => mainWindow?.webContents)
  const shortcuts = installDesktopShortcuts(() => mainWindow, app.getPath('userData'),
    process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux', () => { refreshApplicationMenu() }, window => updateOverlays.input(window))
  app.on('will-quit', () => { shortcuts.dispose() })

  ipcMain.handle(DESKTOP_IPC.boot, async (event) => {
    assertDesktopSender(event, ['app'])
    await startup
    if (backend.host === undefined || hostUrl === undefined) throw new Error('Desktop Host is unavailable')
    // #7：host ready 时已写入默认会话；这里再按发起窗口的会话确认一次——profile 窗口走独立 partition，
    // 它的诊断面板 iframe 也带得上这份 cookie。
    await installHostSessionCookie(new URL(hostUrl).origin, hostCookie, event.sender.session)
    return { injections, streamBaseUrl: new URL(hostUrl).origin }
  })

  ipcMain.handle(DESKTOP_IPC.bootFailed, (event, message: unknown) => {
    assertDesktopSender(event, ['app'])
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('dsh desktop: rejected startup failure from a non-primary frame')
    }
    if (typeof message !== 'string') throw new Error('dsh desktop: startup failure must be text')
    reportFatal(new Error(message), 'web-boot')
  })

  ipcMain.handle(DESKTOP_IPC.browserAcquire, (event, workspace: unknown) => {
    assertProductSender(event)
    return browserGuests.acquire(event.sender, workspace)
  })
  ipcMain.handle(DESKTOP_IPC.browserRelease, (event, lease: unknown) => {
    assertProductSender(event)
    return browserGuests.release(event.sender, lease)
  })

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*', 'wss://127.0.0.1/*'] }, (details, callback) => {
    if (hostUrl === undefined || hostCookie === undefined || details.webContentsId !== mainWindow?.webContents.id) {
      callback({})
      return
    }
    const target = new URL(hostUrl)
    const requested = new URL(details.url)
    if (requested.host !== target.host || requested.protocol !== (target.protocol === 'https:' ? 'wss:' : 'ws:')) { callback({}); return }
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
    // 页面主源是 dsh-app://app；诊断面板 iframe 挂在宿主 origin，它的 ws Origin 就是宿主 origin。
    // 只放行这两种来源，其它 origin 的 ws 依旧直接取消。
    if (headers.origin !== 'dsh-app://app' && headers.origin !== target.origin) { callback({ cancel: true }); return }
    callback({ requestHeaders: { ...headers, origin: target.origin, cookie: hostCookie, 'sec-fetch-site': 'same-origin' } })
  })


  const assertMainApplication = (event: IpcMainInvokeEvent): BrowserWindow => {
    const owner = mainWindow
    if (owner === undefined || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame
      || !event.senderFrame.url.startsWith('dsh-app://app/')) throw new Error('Rejected Platform command')
    return owner
  }
  ipcMain.on(PLATFORM_IPC.bootstrap, (event) => {
    try { event.returnValue = platformView.bootstrap(event) }
    catch { event.returnValue = null }
  })
  ipcMain.handle(PLATFORM_IPC.open, (event, page: unknown, bounds: unknown) => {
    const owner = assertMainApplication(event)
    if (page !== 'usage' && page !== 'top-up') throw new Error('Invalid Platform page')
    return platformView.open(owner, page, platformBounds(bounds))
  })
  ipcMain.handle(PLATFORM_IPC.bounds, (event, bounds: unknown) => {
    assertMainApplication(event)
    platformView.setBounds(platformBounds(bounds))
  })
  ipcMain.handle(PLATFORM_IPC.close, (event) => { assertMainApplication(event); platformView.close() })
  // Only the main window may synchronize its palette with the native material.
  ipcMain.on(DESKTOP_IPC.nativeThemeSet, (event, source: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return
    if (source === 'light' || source === 'dark' || source === 'system') nativeTheme.themeSource = source
  })
  ipcMain.handle(DESKTOP_IPC.localeBootstrap, async (event) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== new URL(applicationUrl).origin) {
      throw new Error('desktop welcome: rejected locale request from an unowned frame')
    }
    if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
    return { languages: systemLanguages, preference: await welcomeBackend.readLocalePreference() }
  })
  ipcMain.on(DESKTOP_IPC.localeChanged, (event, next: unknown) => {
    const window = mainWindow
    if (window === undefined || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || typeof next !== 'string') return
    const current = resolveDesktopStartupLocale(next, systemLanguages)
    writeDesktopLocaleCache(app.getPath('userData'), current.id)
    if (current.id === locale.id) return
    locale = current
    platformView.notifyLocaleChanged()
    windowsLanguage = locale.id
    refreshApplicationMenu()
  })
  ipcMain.handle(DESKTOP_IPC.updatesStatus, (event) => {
    assertProductSender(event)
    return presentDesktopUpdate(updates.state)
  })
  ipcMain.handle(DESKTOP_IPC.deviceInfo, (event) => {
    assertProductSender(event)
    return readDeviceInfo()
  })
  ipcMain.handle(DESKTOP_IPC.onboardingApiKey, async (event) => {
    assertProductSender(event)
    return (await readWelcomeState()).hasApiKey
  })
  ipcMain.on(DESKTOP_IPC.onboardingActive, (event, active: unknown) => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame
      || !event.senderFrame.url.startsWith(`${SCHEME}://app/`) || typeof active !== 'boolean') return
    window.setMinimumSize(active ? 960 : 520, 600)
    if (active) {
      const { width, height } = window.getBounds()
      if (width < 960) window.setSize(960, height)
    }
  })
  ipcMain.handle(DESKTOP_IPC.updatesOpen, async (event) => {
    assertProductSender(event)
    await openUpdatePrompt()
  })

  let promptOperation: Promise<void> | undefined
  let policyAuthenticationQueued = false
  const openUpdatePrompt = (manual = false): Promise<void> => {
    if (authenticationOperation !== undefined) {
      policyAuth?.focus(); updateDialog.focus()
    }
    let failedOperation: 'check' | 'download' | 'install' = 'check'
    promptOperation ??= Promise.resolve().then(async () => {
      if (manual) updateJournal?.action('check-requested')
      const joinedPolicyAuthentication = authenticationOperation !== undefined
      if (joinedPolicyAuthentication) await authenticatePolicy()
      if (isMandatory()) {
        mandatoryUI?.focus()
        if (manual) await Promise.all([checkPolicyManually(), updateSchedule.check(true)])
        return
      }
      let controller: AbortController | undefined
      let progress: Promise<unknown> | undefined
      try {
        let state = updates.state
        if (manual || state.phase === 'idle' || (state.phase === 'error' && state.failedOperation === 'check')) {
          controller = new AbortController()
          ordinaryDialogs.add(controller)
          const parent = currentDialogWindow()
          progress = parent === undefined ? Promise.resolve() : updateDialog.show(parent, { type: 'info', title: locale.messages.updateCheckTitle,
            message: locale.messages.updateChecking, buttons: [locale.messages.later], cancelId: 0, signal: controller.signal })
          if (!joinedPolicyAuthentication) {
            void checkPolicyManually('deferred').catch((error: unknown) => { console.error(error) })
          }
          state = await updateSchedule.check(true)
        }
        if (isMandatory()) { mandatoryUI?.focus(); return }
        if (state.phase === 'error' && state.failedOperation === 'check') { await showUpdateFailure(state); return }
        if (state.phase === 'idle') {
          await ordinaryMessageBox({ type: 'info', title: locale.messages.updateCheckTitle,
            message: locale.messages.updateCurrent,
            detail: formatDesktopMessage(locale.messages.updateCurrentDetail, { version: app.getVersion() }) })
          return
        }
        if (state.phase === 'ready' || (state.phase === 'error' && state.failedOperation === 'install')) {
          if (state.version !== undefined) {
            failedOperation = 'install'
            await showUpdateFailure(await updates.install(state.version))
          }
          return
        }
        if (state.phase !== 'available' && !(state.phase === 'error' && state.failedOperation === 'download')) return
        if (manual) {
          const result = await ordinaryMessageBox({ title: locale.messages.updateCheckTitle,
            message: formatDesktopMessage(locale.messages.updateAvailable, { version: state.version ?? '' }),
            detail: locale.messages.updateDetail,
            buttons: [locale.messages.updateDownload], cancelId: 1 })
          if (result.response !== 0) return
        }
        if (!isMandatory() && state.version !== undefined) {
          controller?.abort()
          failedOperation = 'download'
          await showUpdateFailure(await downloadUpdate(state.version))
        }
      } finally {
        controller?.abort()
        if (controller !== undefined) ordinaryDialogs.delete(controller)
        await progress
      }
    }).catch((error: unknown) => showUpdateFailure({ phase: 'error', failedOperation,
      message: desktopErrorState(error).message }))
      .finally(() => { promptOperation = undefined; flushQueuedPolicyAuthentication() })
    return promptOperation
  }

  let authenticationOperation: Promise<DesktopPolicyState | undefined> | undefined
  const authenticatePolicy = () => {
    if (authenticationOperation !== undefined) { policyAuth?.focus(); updateDialog.focus() }
    authenticationOperation ??= runPolicyAuthentication().finally(() => { authenticationOperation = undefined })
    return authenticationOperation
  }
  const flushQueuedPolicyAuthentication = (): void => {
    if (!policyAuthenticationQueued || promptOperation !== undefined || authenticationOperation !== undefined
      || isMandatory() || quitting) return
    policyAuthenticationQueued = false
    void authenticatePolicy().catch((error: unknown) => { console.error(error) })
  }
  const queuePolicyAuthentication = (): void => {
    if (!desktopSettings.updates.allowTestAuthPopupWindow) return
    if (authenticationOperation !== undefined) {
      policyAuth?.focus(); updateDialog.focus()
      return
    }
    policyAuthenticationQueued = true
    flushQueuedPolicyAuthentication()
  }
  const runPolicyAuthentication = async () => {
    if (!desktopSettings.updates.allowTestAuthPopupWindow
      || policyAuth === undefined || mandatoryPolicy === undefined || quitting) return undefined
    const parent = mandatoryUI?.confirmationWindow ?? currentDialogWindow()
    if (parent === undefined) return undefined
    const consent = await updateDialog.show(parent, { type: 'info', title: locale.messages.policyLoginTitle,
      message: locale.messages.policyLoginRequired, buttons: [locale.messages.policyLogin, locale.messages.later], cancelId: 1 })
    if (consent.response !== 0 || isQuitting()) return undefined
    const outcome = await policyAuth.login()
    if (isQuitting() || outcome === 'cancelled') return undefined
    if (outcome === 'failed') {
      await updateDialog.show(parent, { type: 'error', title: locale.messages.policyLoginTitle,
        message: locale.messages.policyLoginFailed, buttons: [locale.messages.updateAcknowledge], cancelId: 0 })
      return undefined
    }
    // Drain a pre-login request before asking the server to evaluate the new cookies.
    await mandatoryPolicy.check('login-return')
    if (isQuitting()) return undefined
    return mandatoryPolicy.check('login-return', true)
  }

  const checkPolicyManually = async (authentication: 'immediate' | 'deferred' = 'immediate') => {
    if (authenticationOperation !== undefined) return authenticatePolicy()
    const policy = await mandatoryPolicy?.check('manual', true)
    if (policy?.error !== 'authentication-required' || !desktopSettings.updates.allowTestAuthPopupWindow) return policy
    if (authentication === 'immediate') return authenticatePolicy()
    queuePolicyAuthentication()
    return policy
  }

  const automaticCheck = (): void => {
    if (!quitting) void mandatoryPolicy?.check('foreground-or-resume').catch((error: unknown) => { console.error(error) })
    if (!quitting) void updateSchedule.check().catch((error: unknown) => { console.error(error) })
  }
  powerMonitor.on('resume', automaticCheck)
  app.on('will-quit', () => {
    updateSchedule.dispose()
    powerMonitor.off('resume', automaticCheck)
    updates.dispose()
  })

  const applicationIconPath = development ? join(app.getAppPath(), 'resources', 'icon-windows.png')
    : join(process.resourcesPath, 'icon.png')
  app.setAboutPanelOptions({
    applicationName: 'DSH Desktop Plus',
    applicationVersion: plusDisplayVersion(),
    // The release has no separate build number; omit Electron's bundle version.
    version: '',
    copyright: '',
    iconPath: applicationIconPath,
  })
  // A custom application menu replaces Electron's default menu, so macOS needs
  // its standard menus and application hide commands declared explicitly.
  // Keep app.name stable: Electron derives its default userData directory from it.
  const darwin = process.platform === 'darwin'
  const platformMenus = (): MenuItemConstructorOptions[] => darwin
    ? [shortcuts.fileMenu(currentDesktopLocale().messages), { role: 'editMenu' }, { role: 'windowMenu' }]
    : [{ role: 'editMenu' }]
  const hideCommands: MenuItemConstructorOptions[] = darwin
    ? [{ role: 'hide', label: plusMenuMessage('hideApplication') },
      { role: 'hideOthers', label: currentDesktopLocale().messages.hideOtherApplications },
      { role: 'unhide', label: currentDesktopLocale().messages.showAllApplications }, { type: 'separator' }]
    : []
  const applicationItems = (): MenuItemConstructorOptions[] => [
    // Windows has no system About panel; Electron's fallback is a plain
    // message box, so the shell shows its own dimmed dialog instead.
    process.platform === 'win32'
      ? { label: plusMenuMessage('aboutMenu'),
        click: () => { void showAbout().catch((error: unknown) => { console.error(error) }) } }
      : { label: plusMenuMessage('aboutMenu'), role: 'about' },
    { type: 'separator' },
    { label: currentDesktopLocale().messages.checkUpdatesMenu, click: () => { void openUpdatePrompt(true) } },
    ...process.platform === 'darwin' || process.platform === 'win32'
      ? [{ label: currentDesktopLocale().messages.cliCommandMenu, click: () => { void commandManager.show() } }] : [],
    ...development ? [
      { type: 'separator' as const },
      { label: currentDesktopLocale().messages.reloadPageMenu, role: 'reload' as const },
      { label: currentDesktopLocale().messages.restartAppHostMenu, click: () => {
        if (quitting) return
        app.relaunch()
        quitWithoutConfirmation()
      } },
      // #12：强制刷新＝绕过缓存重拉全部插件 bundle——插件更新后点它，新代码立即生效（会话持久化不受影响）。
      { label: `${currentDesktopLocale().messages.reloadPageMenu}（插件）`, click: () => { const target = plusDesktopWindow(); if (target !== undefined) void reloadPluginsInWindow(target) } },
    ] : [],
    { type: 'separator' },
    ...hideCommands,
    { role: 'quit', ...(darwin ? { label: currentDesktopLocale().messages.quitApplication }
      : process.platform === 'win32' ? { label: currentDesktopLocale().messages.exitApplication } : {}) },
  ]
  const devToolsItems: MenuItemConstructorOptions[] = [
    { role: 'toggleDevTools', visible: false },
    { role: 'toggleDevTools', visible: false, accelerator: 'F12' },
  ]
  const refreshApplicationMenu = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform === 'win32' ? devToolsItems : [{
      label: darwin ? app.name : currentDesktopLocale().messages.application,
      submenu: [...applicationItems(), ...devToolsItems],
    }, ...platformMenus()]))
    tray?.relabel()
  }
  refreshApplicationMenu()
  // 托盘只转发官方的这两条入口：检查更新与注册命令，不重写流程。
  plusOpenUpdatePrompt = (manual = false) => { void openUpdatePrompt(manual) }
  plusShowCliCommands = () => { void commandManager.show() }
  const trayIconPath = process.platform === 'win32'
    ? (development ? join(app.getAppPath(), 'resources', 'tray-windows.ico') : join(process.resourcesPath, 'tray.ico'))
    : (development ? join(app.getAppPath(), '..', '..', '..', 'scripts', 'plus', 'assets', 'tray-22.png') : join(process.resourcesPath, 'tray.png'))
    if (process.platform === 'win32' && !plusShell.ownsTray()) {
    // The tray is the way back to a hidden window; without it, relaunching the application still focuses it.
    try {
      tray = new DesktopTray({ iconPath: trayIconPath, locale: currentDesktopLocale,
        open: () => { focusPrimaryWindow() }, quit: () => { app.quit() } })
    } catch (error) { console.warn('desktop tray: unavailable', error) }
  }
  const backgroundNotice = process.platform === 'win32'
    ? new DesktopBackgroundNotice({ markerPath: join(app.getPath('userData'), 'background-close-confirmed'),
      locale: () => locale, show: ordinaryMessageBox, focus: () => { updateDialog.focus() } })
    : undefined
  const quitConfirmation = new DesktopQuitConfirmation({
    locale: () => locale,
    inspect: () => backend.host?.inspectQuit(),
    // No owner window: a hidden window stays hidden and the native box is its own top-level window.
    show: options => dialog.showMessageBox(options),
    // macOS raises the open alert with the application; Electron exposes no handle to the Windows task
    // dialog, so a repeated request there only joins the open decision.
    focus: () => { if (process.platform === 'darwin') app.focus({ steal: true }) },
    // The task dialog draws its main icon at the system icon size; the multi-size ICO yields that
    // size directly, where the 1024 px PNG would be scaled down by GDI.
    ...(process.platform === 'win32' ? { icon: nativeImage.createFromPath(trayIconPath) } : {}),
  })

  if (process.platform === 'win32') {
    ipcMain.handle(DESKTOP_IPC.windowsMenu, (event, name: unknown, x: unknown, y: unknown) => {
      assertDesktopSender(event, ['app'])
      if (mainWindow === undefined || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('desktop menu: rejected sender')
      if ((name !== 'application' && name !== 'edit')
        || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || y < 0 || x > 100_000 || y > 100_000) throw new Error('desktop menu: invalid popup request')
      const window = mainWindow
      // Editor-owned history listens to key events rather than Chromium's native undo stack.
      const editItem = (label: string, keyCode: string, modifiers: Array<'control'>, accelerator?: string): MenuItemConstructorOptions => ({
        label,
        ...(accelerator === undefined ? {} : { accelerator }),
        click: () => {
          shortcuts.sendEditingKey(keyCode, modifiers)
        },
      })
      const items: MenuItemConstructorOptions[] = name === 'application' ? applicationItems() : [
        editItem(currentDesktopLocale().messages.undo, 'Z', ['control'], 'Ctrl+Z'),
        editItem(currentDesktopLocale().messages.redo, 'Y', ['control'], 'Ctrl+Y'),
        { type: 'separator' },
        editItem(currentDesktopLocale().messages.cut, 'X', ['control'], 'Ctrl+X'),
        editItem(currentDesktopLocale().messages.copy, 'C', ['control'], 'Ctrl+C'),
        editItem(currentDesktopLocale().messages.paste, 'V', ['control'], 'Ctrl+V'),
        editItem(currentDesktopLocale().messages.delete, 'Delete', []),
        { type: 'separator' },
        editItem(currentDesktopLocale().messages.selectAll, 'A', ['control'], 'Ctrl+A'),
        { type: 'separator' },
        // #12：强制刷新＝绕过缓存重拉全部插件 bundle——插件更新后点它，新代码立即生效。
        { label: `${currentDesktopLocale().messages.reloadPageMenu}（重载插件）`, click: () => { if (mainWindow !== undefined) void reloadPluginsInWindow(mainWindow) } },
      ]
      const zoom = mainWindow.webContents.getZoomFactor()
      return new Promise<void>((resolve) => {
        Menu.buildFromTemplate(items).popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: resolve })
      })
    })
    ipcMain.on(DESKTOP_IPC.windowsAppearance, (event, _language: unknown, color: unknown, symbolColor: unknown) => {
      // 每个桌面窗口（主窗 + profile 窗）都跑同一 dsh 页面并上报自己的主题色；
      // overlay 必须落在上报来源的窗口上，否则 profile 窗的控制按钮底色停在初始值。
      if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) return
      if (!event.senderFrame.url.startsWith(`${SCHEME}://app/`)) return
      // Document lang starts as English before Host locale bootstrap; only localeChanged owns shell language.
      // Empty colors precede client stylesheet installation; only CSS color values cross IPC.
      const validColor = (value: unknown): value is string => typeof value === 'string'
        && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(value)
      if (!validColor(color) || !validColor(symbolColor)) return
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (senderWindow === null || senderWindow.isDestroyed()) return
      try { senderWindow.setTitleBarOverlay({ color, symbolColor }) } catch (error) {
        // 无 overlay 的窗口（mac hiddenInset/Linux）不支持 setTitleBarOverlay，忽略即可。
        plusLogger.append(`[desktop] setTitleBarOverlay skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  const hideMainWindow = (window: BrowserWindow): void => {
    if (process.platform === 'darwin' && window.isFullScreen()) {
      // Hiding a fullscreen window leaves an empty black space; leave fullscreen first.
      window.once('leave-full-screen', () => { if (!window.isDestroyed()) window.hide() })
      window.setFullScreen(false)
    } else {
      window.hide()
    }
  }
  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload, false, true)
    mainWindow = window
    refreshPlusTray()
    browserGuests.bind(window, (guest, name) => shortcuts.attachGuest(window, guest, name))
    shortcuts.attach(window)
    window.on('focus', automaticCheck)
    // Closing hides: the page and the Host keep running, and the next show resumes the same document.
    window.on('close', (event) => {
      if (quitting || shellInstallerOwnsQuit || sessionEnding) return
      event.preventDefault()
      if (updateDialog.isOpen) { updateDialog.focus(); return }
      const hide = (): void => {
        if (!quitting && !shellInstallerOwnsQuit && !sessionEnding && !window.isDestroyed()) { hideMainWindow(window); refreshPlusTray() }
      }
      if (backgroundNotice === undefined) hide()
      else backgroundNotice.close(hide)
    })
    if (process.platform === 'win32') {
      // Shutdown, restart, and log-off must not wait on a confirmation. query-session-end is only a
      // question that another application can veto without any follow-up message, so it does not count.
      window.on('session-end', () => { sessionEnding = true })
    } else {
      // The macOS power-off notification arrives before the terminate request; a cancelled shutdown
      // leaves the process running, and user attention on the window shows the session continues.
      window.on('focus', () => { sessionEnding = false })
      window.on('show', () => { sessionEnding = false })
    }
    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined; refreshPlusTray() })
    window.webContents.on('console-message', (details) => {
      if (details.level !== 'error') return
      rendererConsole.push(`${details.sourceId}:${String(details.lineNumber)} ${details.message}`)
    })
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && !quitting && !window.isDestroyed()) {
        reportFatal(new Error(`Desktop page failed to load: ${url} (${String(code)}: ${description})`), 'renderer')
      }
    })
    window.webContents.on('preload-error', (_event, _path, error) => {
      if (!quitting && !window.isDestroyed()) reportFatal(error, 'renderer')
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      navigation = undefined
      if (!quitting && !window.isDestroyed() && details.reason !== 'clean-exit') {
        reportFatal(new Error(`Desktop renderer exited: ${details.reason}`), 'renderer')
      }
    })
    return window
  }
  const enterWorkspace = async ({ activate = true }: { activate?: boolean } = {}): Promise<void> => {
    if (quitting) return
    const window = mainWindow ?? createMainWindow()
    await navigateMain(applicationUrl)
    if (isQuitting() || recovery.active || window.isDestroyed()) return
    if (activate) window.show()
    else window.showInactive()
    enteredWorkspace = true
    if (welcomeWindow !== undefined) {
      welcomeWindow.close()
      window.webContents.send(DESKTOP_IPC.enterWorkspace)
    }
    welcomeWindow = undefined
    if (raiseAfterUpdate) {
      raiseAfterUpdate = false
      window.moveTop()
      window.focus()
    }
    if (activate && development && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  }
  let openingWelcome: Promise<void> | undefined
  const showWelcome = (): Promise<void> => {
    if (quitting) return Promise.resolve()
    if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) {
      if (!welcomeWindow.isVisible()) void track('auth_page_view', {})
      welcomeWindow.show()
      welcomeWindow.focus()
      return Promise.resolve()
    }
    openingWelcome ??= (async () => {
      welcomeWindow = await openWelcomeWindow(locale, {
        analytics: track,
        analyticsEnabled: () => Promise.resolve(analyticsEnabled),
        takeNotice: () => {
          const notice = pendingWelcomeNotice
          pendingWelcomeNotice = undefined
          return Promise.resolve(notice)
        },
        startSignIn: async () => {
          if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
          return welcomeBackend.account.start(desktopClientMetadata(locale.id))
        },
        cancelSignIn: async (id) => {
          if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
          return welcomeBackend.account.cancel(id)
        },
        copySignInLink: async (id) => {
          const state = await welcomeBackend?.account.state()
          if (state?.attempt?.id !== id || state.attempt.phase !== 'waiting-browser' || state.attempt.authorizeUrl === undefined) {
            throw new Error('desktop welcome: login link is unavailable')
          }
          await clipboard.writeText(platformLoginUrl(state.attempt.authorizeUrl))
        },
        saveApiKey: async (apiKey) => {
          if (backend.host === undefined || welcomeBackend === undefined) return { ok: false }
          const saved = await welcomeBackend.save(apiKey)
          if (!saved.ok) return saved
          await enterWorkspace()
          return { ok: true }
        },
        skip: enterWorkspace,
      })
      const window = welcomeWindow
      window.once('closed', () => {
        void welcomeBackend?.account.state().then((state) => {
          if (state.attempt !== null && !enteredWorkspace) return welcomeBackend?.account.cancel(state.attempt.id)
          return undefined
        }).catch(() => undefined)
      })
      window.once('closed', () => {
        if (welcomeWindow === window) welcomeWindow = undefined
        if (enteredWorkspace || recovery.active) return
        // Nothing runs before the workspace opens. macOS keeps the Dock convention and drops the
        // unused main window so the next activation rebuilds the welcome; elsewhere the close quits.
        if (process.platform === 'darwin') mainWindow?.destroy()
        else app.quit()
      })
      if (isQuitting() || recovery.active || enteredWorkspace) window.close()
      else mainWindow?.hide()
    })().finally(() => { openingWelcome = undefined })
    return openingWelcome
  }
  const openInitialWindow = async (): Promise<void> => {
    if (quitting || recovery.active) return
    const state = await readWelcomeState()
    if (isQuitting() || backend.state.phase !== 'ready') return
    locale = resolveDesktopStartupLocale(state.localePreference, systemLanguages)
    writeDesktopLocaleCache(app.getPath('userData'), locale.id)
    windowsLanguage = locale.id
    refreshApplicationMenu()
    if (!enteredWorkspace && needsWelcome({ loggedIn: state.loggedIn, hasApiKey: state.hasApiKey })) {
      // A later login must retain its own activation policy instead of replaying startup focus.
      raiseAfterUpdate = false
      await showWelcome()
    } else {
      await enterWorkspace()
    }
  }
  focusPrimaryWindow = () => {
    if (quitting) return
    if (isMandatory()) { mandatoryUI?.focus(); return }
    const window = welcomeWindow ?? mainWindow
    if (window === undefined || window.isDestroyed()) {
      try { createMainWindow() } catch (error) { reportFatal(error, 'main'); return }
      void (backend.state.phase === 'ready' ? openInitialWindow() : reconcileBackend()).catch((error: unknown) => { reportFatal(error, 'main') })
      return
    }
    // Startup and sign-out select the visible window before activation may reveal the workspace.
    if (window === mainWindow && !enteredWorkspace) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  if (app.isPackaged || process.env.DSH_DESKTOP_DEV_APP === '1') app.setAsDefaultProtocolClient('dsh')
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (url === 'dsh://open' || url === 'dsh://open/') focusPrimaryWindow()
  })

  app.on('activate', (_event, hasVisibleWindows) => {
    if (!hasVisibleWindows) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    // 就地重启（重启应用 / desktop profile 重启）会销毁并重建主窗口：这段时间不能退掉主进程。
    if (plusRestarting || plusRebuildingDesktopWindow) return
    if (process.platform !== 'darwin') app.quit()
  })
  if (process.platform !== 'win32') powerMonitor.on('shutdown', () => { sessionEnding = true })
  const finishQuit = (): void => {
    quitting = true
    shuttingDown = true
    updateJournal?.action('quit-requested')
    quitConfirmation.dispose()
    backgroundNotice?.dispose()
    tray?.dispose()
    stopAccount?.()
    if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.hide()
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.hide()
    updateSchedule.dispose()
    updateDialog.dispose()
    mandatoryUI?.dispose()
    void Promise.all([stopOperationReports(), Promise.resolve(mandatoryPolicy?.dispose()).then(() => policyAuth?.dispose()),
      backend.close().then(async () => { await operationJournal?.drain(500) }, async (error: unknown) => {
        await operationJournal?.drain(500)
        throw error
      }),
      // Plus profile hosts are separate child processes; stop them with the rest.
      plusProfiles.dispose(),
      platformView.dispose(),
      disposeFileDrag(),
    ].map(cleanup => cleanup.catch((error: unknown) => { console.error(error) })))
      .then(() => { app.quit() })
  }
  app.on('before-quit', (event) => {
    if (shellInstallerOwnsQuit) {
      shuttingDown = true
      quitConfirmation.dispose()
      backgroundNotice?.dispose()
      updateJournal?.action('quit-requested')
      tray?.dispose()
      updateDialog.dispose()
      mandatoryUI?.dispose()
      // Installation preparation already awaited Platform storage cleanup.
      void platformView.dispose().catch((error: unknown) => { console.error(error) })
      return
    }
    if (quitting) return
    event.preventDefault()
    if (skipQuitConfirmation || sessionEnding) { finishQuit(); return }
    void quitConfirmation.confirm().then((approved) => {
      if (quitting || shellInstallerOwnsQuit) return
      if (approved) { finishQuit(); return }
      // A quit that started from closing the welcome window destroyed it; a cancelled quit needs it back.
      if (!enteredWorkspace && !recovery.active) void showWelcome().catch((error: unknown) => { reportFatal(error, 'main') })
    }).catch((error: unknown) => { console.error(error); if (!quitting && !shellInstallerOwnsQuit) finishQuit() })
  })

  mainWindow = createMainWindow()
  attachPageConsole(mainWindow.webContents, (line) => { if (!quitting) plusLogger.append(`[${DEFAULT_PROFILE}] ${line}`) })
  // #8：profile 窗口工厂在此注入——createWindow/appPreload/quitting 都是 main() 作用域内的名字。
  plusProfileWindowFactory = (name) => {
    const window = createWindow(appPreload, false, false, partitionFor(name), true)
    // 远程窗口：页面侧「退出本窗口」就地销毁窗口、断开连接（与托盘退出同语义），退出类请求不触达远端。
    // 用 <all_urls> 兜底 + 处理器内精确判定：窄 filter 曾漏匹配导致退出直接透传到远端。
    if (loadRemoteAddressList(resolveDshHome()).some((url) => remoteProfileName(url) === name)) {
      plusLogger.append(`[remote] exit guard armed for ${name}`)
      window.webContents.session.webRequest.onBeforeRequest(
        { urls: ['<all_urls>'] },
        (details, callback) => {
          if (!details.url.includes('/api/shell.invoke')) { callback({}); return }
          const body = details.uploadData?.[0]?.bytes?.toString('utf8') ?? ''
          if (/\"method\"\s*:\s*\"(exit_window_instance|close_current_window)\"/.exec(body) !== null) {
            plusLogger.append(`[remote] exit intercepted for ${name}; destroying local window only`)
            callback({ cancel: true })
            void plusProfiles.quitProfile(name).finally(() => { refreshPlusTray() })
            return
          }
          callback({})
        },
      )
    }
    attachPackagedDevTools(window, app.isPackaged)
    // #6：renderer 硬崩时主进程收不到页面日志，这条是崩溃原因的唯一落点。
    window.webContents.on('render-process-gone', (_event, details) => {
      plusLogger.append(`[${name}] renderer gone: ${details.reason} (exit ${String(details.exitCode)})`)
    })
    // #3：profile 退出中页面会打 connection lost，退出路径上不记这类噪声。
    attachPageConsole(window.webContents, (line) => { if (!quitting && !plusQuittingProfiles.has(name)) plusLogger.append(`[${name}] ${line}`) })
    return window
  }
  attachPackagedDevTools(mainWindow, app.isPackaged)
  plusLogger.prune()
  plusLogger.append(`diagnostics ${JSON.stringify(collectDiagnostics({ logDir: app.getPath('logs'), appVersion: plusDisplayVersion(), profile: 'desktop', deviceInfo: readDeviceInfo() }))}`)
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop policy: invalid application manifest')
  const developmentPolicy = app.isPackaged ? undefined : process.env.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG
  const policyInput: unknown = app.isPackaged
    ? ('dshMandatoryUpdatePolicy' in manifest ? manifest.dshMandatoryUpdatePolicy : undefined)
    : developmentPolicy === undefined ? undefined : JSON.parse(developmentPolicy) as unknown
  const policyConfig = resolveDesktopPolicyConfig(policyInput, !app.isPackaged)
  if (policyConfig !== undefined) {
    if (policyConfig.authentication === 'feishu-test') {
      policyAuth = new DesktopPolicyTestAuth(policyConfig.origin, policyConfig.allowedAuthOrigins, locale,
        () => mandatoryUI?.confirmationWindow ?? currentDialogWindow(),
        (event) => { console.info(`desktop policy authentication: ${event}`); updateJournal?.action(`policy-login-${event}`) })
    }
    if (!['win32', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('desktop policy: unsupported platform')
    let wasBlocking = false
    mandatoryPolicy = new DesktopMandatoryUpdatePolicy(policyConfig, {
      platform: process.platform as 'win32' | 'darwin', arch: process.arch as 'x64' | 'arm64',
      channel: updateChannel,
      bundledDshVersion: app.isPackaged ? readDesktopRuntime(resources.dsh).release.version : app.getVersion(),
    }, (state) => {
      if (state.error !== 'authentication-required') policyAuthenticationQueued = false
      if (state.blocking) {
        for (const controller of ordinaryDialogs) controller.abort()
        if (!wasBlocking) updateDialog.cancel()
      }
      mandatoryUI?.sync()
      if (state.blocking && !wasBlocking) void updateSchedule.check(false, true).catch((error: unknown) => { console.error(error) })
      wasBlocking = state.blocking
    }, policyAuth?.request, () => desktopClientMetadata(locale.id))
    const policy = mandatoryPolicy
    mandatoryUI = new DesktopMandatoryUpdateWindow({
      overlays: updateOverlays,
      preload: fileURLToPath(new URL('./preload-mandatory.cjs', import.meta.url)), locale,
      allowedPageOrigins: policyConfig.allowedPageOrigins, parent: () => mainWindow,
      policy: () => policy.state, update: () => updates.state,
      refresh: async () => { await Promise.all([checkPolicyManually(), updateSchedule.check(true)]) },
      download: downloadUpdate, install: version => updates.install(version),
    })
    void mandatoryPolicy.check('launch').then((state) => {
      if (app.isPackaged && state.error === 'authentication-required' && !isQuitting()) queuePolicyAuthentication()
    }).catch((error: unknown) => { console.error(error) })
  }
  automaticCheck()
  await reconcileBackend().catch(() => undefined)
  // Window lifecycle callbacks run while backend startup is pending.
  if (isQuitting()) return
  const window = currentMainWindow()
  if (window !== undefined && development && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    window.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
}

applyWindowsAppUserModelId()
applyLoginItemFromEnv(app)
// 日志内核：三源统一 sink（shell/webview/relay），按天+按大小轮转、gzip 归档、保留策略。
const plusLogDir = join(resolveDshHome(), 'logs')
/** 日志级别热切换：面板把 log_level 写进 desktop-settings.json，内核每次判定都现读。 */
const plusLogLevel = (): 'debug' | 'info' | 'warn' | 'error' => {
  const value = loadPlusDesktopSettings().log_level
  return value === 'debug' || value === 'warn' || value === 'error' ? value : 'info'
}
const plusLogKernel = createLoggingKernel({ logsDir: plusLogDir, level: plusLogLevel })
// 主进程 console 全部落 shell 源：util.format 格式化参数，sink 内不回写 console（防自我递归）。
installShellConsoleTee((level, line) => {
  // 官方 overlay dispose 会注销 mandatory-status handler，主窗重载时 preload 再 invoke 就打
  // 这条 error（preload 自身容忍该失败，mandatory-update preload 注释）；已知无害噪音不落日志。
  if (line.includes("No handler registered for 'dsh-desktop:mandatory-status'")) return
  plusLogKernel.append('shell', level, line)
})
/** 旧调用点保留 append/prune 形状，内容进内核的 shell 源。 */
const plusLogger = {
  append: (line: string): void => { plusLogKernel.append('shell', 'info', line) },
  prune: (): void => { plusLogKernel.runRetention() },
}
const plusShell = createShellKernel({
  app,
  claimSingleInstance: (refocus) => claimDesktopSingleInstance(app, refocus),
  createTray: ({ onQuit }) => {
    // 文案与官方共用一次判定（currentDesktopLocale），避免同一菜单中英混排。
    const restartProfileWithSplash = (name: string): void => {
      // Profile 重启：只重建该 profile 的 dsh 进程树，托盘不动；窗口走 splash → dsh 重建。
      // #⑥：splash 语言跟系统（app.getLocale），宿主输出行实时推进文案；#⑤：重启完自动显示窗口。
      const splash = createSplashWindow({ width: 460, height: 200, locale: app.getLocale() })
      splash.setStage({ stage: 'splash', detail: name })
      plusProfileSplashes.set(name, splash)
      const restart = name === DEFAULT_PROFILE
        ? restartOfficialBackend
        : async (): Promise<void> => {
          // 远程 profile：先把远端真重启掉，等它恢复再重建窗口（否则窗口会落在重启空窗期呈空白）。
          const remoteUrl = loadRemoteAddressList(resolveDshHome()).find((url) => remoteProfileName(url) === name)
          if (remoteUrl !== undefined) {
            splash.setStage({ stage: 'splash', detail: `等待远端重启 ${remoteProfileName(remoteUrl)}` })
            const cookieHeader = await restartRemoteProfileApp(remoteUrl, name)
            await waitRemoteReady(remoteOrigin(remoteUrl), cookieHeader, 60_000)
          }
          // 未打开的 profile 没有窗口可重启，直接走完整 open（splash 保留到窗口建好并显示）。
          if (plusProfiles.windowState(name) === undefined) await plusProfiles.openProfile(name)
          else await plusProfiles.restartProfile(name)
        }
      void restart().catch((error: unknown) => { console.error(error) }).finally(() => {
        plusProfileSplashes.delete(name)
        if (name !== DEFAULT_PROFILE) plusProfiles.showProfile(name)
        splash.dispose()
        refreshPlusTray()
      })
    }
    // labels 走 getter 现读 plusShellCopy（locale 变化后菜单重建即跟随），不再闭包捕获旧文案。
    try {
      plusProfileTray = createProfileTray({
        // 托盘图标就用官方应用图标本体（彩色，非模板图），retina 自动加载 @2x。
        // 托盘图标就用官方应用图标的本体（彩色、非模板），按 22/44 px 出图， retina 加载 @2x。
        icon: !app.isPackaged
          ? (process.platform === 'win32'
            ? join(app.getAppPath(), 'resources', 'tray-windows.ico')
            : join(app.getAppPath(), '..', '..', '..', 'scripts', 'plus', 'assets', 'tray-22.png'))
          : (process.platform === 'win32'
            ? join(process.resourcesPath, 'tray.ico')
            : join(process.resourcesPath, 'tray.png')),
        // 左键行为读设置（默认 show-hide）：设置里改了就持久化，重启壳后仍生效。
        // 托盘左键固定弹菜单（不再提供 show-hide 设置）；右键同款。
        clickBehavior: () => 'menu',
        clickTargetProfile: () => DEFAULT_PROFILE,
        // 菜单动作（隐藏/显示）完成后重建菜单：文案跟着窗口实际状态翻转。
        // 新建走官方弹窗（renderer html + 专用 preload）；名字与护栏由 plusCreateProfile 判定。
        onNewProfile: () => {
          void promptProfileName(plusDesktopWindow(), plusCreateProfile).then((name) => {
            if (name !== undefined) refreshPlusTray()
          }).catch((error: unknown) => { console.error(error) })
        },
        onAfterAction: () => { refreshPlusTray() },
        // 删除确认走自定义弹窗（profile-delete.html，样式与更新弹窗一致），护栏归 plusDeleteProfile。
        onDeleteProfile: (name) => {
          void confirmProfileDelete(plusDesktopWindow(), name).then((confirmed) => {
            if (!confirmed) return
            const outcome = plusDeleteProfile(name)
            if (outcome.ok) { refreshPlusTray(); return }
            const dc = plusShellCopy(currentDesktopLocale().id)
            const failed = { type: 'error' as const, buttons: [dc.ok], message: dc.deleteFailed, detail: outcome.reason ?? dc.unknown }
            const parent = plusDesktopWindow()
            void (parent === undefined ? dialog.showMessageBox(failed) : dialog.showMessageBox(parent, failed))
          }).catch((error: unknown) => { console.error(error) })
        },
        getStates: () => {
          const window = plusDesktopWindow()
          const remotes = loadRemoteAddressList(resolveDshHome())
          const states: Array<{ name: string, running: boolean, port?: number | null, remote?: boolean }> = [
            {
              name: DEFAULT_PROFILE,
              running: window !== undefined && !window.isDestroyed(),
              port: plusHostPort,
            },
          ]
          // 以磁盘上真实存在的 profile 为准（desktop + 用户/CLI 建的所有 profile），
          // 不能只列壳开过窗口的那几个，否则和本地对不上。
          for (const name of listProfileDirs(resolveDshHome())) {
            if (name === DEFAULT_PROFILE) continue
            states.push({ name, running: plusProfiles.manager.list().some((entry) => entry.name === name), port: plusProfilePorts.get(name) ?? null })
          }
          // 一个远程地址 = 一个 profile（#11 原话第 2 条）：托盘不另列「远程地址」，全部并入 Profile 管理。
          for (const origin of remotes) {
            const parsed = new URL(origin)
            states.push({
              name: remoteProfileName(origin),
              running: true,
              port: Number(parsed.port) || null,
              remote: true,
            })
          }
          return states
        },
        getWindowState: (name) => {
          if (name === DEFAULT_PROFILE) {
            const window = plusDesktopWindow()
            if (window === undefined || window.isDestroyed()) return { visible: false, focused: false }
            return { visible: window.isVisible() && !window.isMinimized(), focused: window.isFocused() }
          }
          return plusProfiles.windowState(name) ?? { visible: false, focused: false }
        },
        // 文案全部来自 plusShellCopy：与官方 currentDesktopLocale() 同一次判定，不再中英混排。
        labels: {
          get manage() { return plusShellCopy(currentDesktopLocale().id).manageProfiles },
          get restartApp() { return plusShellCopy(currentDesktopLocale().id).restartApp },
          get quitApp() { return plusShellCopy(currentDesktopLocale().id).quitApp },
          get show() { return plusShellCopy(currentDesktopLocale().id).show },
          get hide() { return plusShellCopy(currentDesktopLocale().id).hide },
          get restart() { return plusShellCopy(currentDesktopLocale().id).restart },
          get restartRemote() { return plusShellCopy(currentDesktopLocale().id).restartRemote },
          get quit() { return plusShellCopy(currentDesktopLocale().id).quit },
          get startProfile() { return plusShellCopy(currentDesktopLocale().id).startProfile },
          get newProfile() { return plusShellCopy(currentDesktopLocale().id).newProfile ?? 'New Profile…' },
        },
        actions: {
          showOrFocus: (name) => {
            if (name === DEFAULT_PROFILE) { focusPrimaryWindow(); return }
            plusProfiles.showProfile(name)
          },
          startProfile: (name) => {
            if (name === DEFAULT_PROFILE) { restartProfileWithSplash(name); return }
            // #③：profile 启动也走 splash，起来后自动显示窗口（此前静默后台启动、只能从托盘点显示）。
            const splash = createSplashWindow({ width: 460, height: 200, locale: app.getLocale() })
            splash.setStage({ stage: 'splash', detail: name })
            plusProfileSplashes.set(name, splash)
            void plusProfiles.manager.open(name).then(() => {
              plusProfiles.showProfile(name)
              refreshPlusTray()
            }).catch((error: unknown) => { console.error(error) }).finally(() => {
              plusProfileSplashes.delete(name)
              splash.dispose()
            })
          },
          hide: (name) => {
            if (name === DEFAULT_PROFILE) { plusDesktopWindow()?.hide(); refreshPlusTray(); return }
            plusProfiles.manager.hideOrClose(name)
          },
          quit: (name) => {
            // 默认 profile 归官方后端：「退出 profile」= 停实例 + 关窗，托盘与应用留驻（#11 原话第 4 条）。
            if (name === DEFAULT_PROFILE) {
              void quitDesktopProfile().catch((error: unknown) => { console.error(error) }).finally(() => { refreshPlusTray() })
              return
            }
            plusQuittingProfiles.add(name)
            void plusProfiles.quitProfile(name).then((result) => {
              if (!result.ok) console.warn(`plus profile ${name} was not quit: ${result.reason}`)
            }).finally(() => { plusQuittingProfiles.delete(name) })
          },
          restart: (name) => {
            // 远程 profile：先经 lane 调远端 restart_desktop_app（真重启远端进程），再本地重建窗口。
            const remoteUrl = loadRemoteAddressList(resolveDshHome()).find((url) => remoteProfileName(url) === name)
            if (remoteUrl !== undefined) void restartRemoteProfileApp(remoteUrl, name)
            restartProfileWithSplash(name)
          },
          restartApp: () => { restartEverything() },
          quitApp: () => { onQuit() },
        },
        // 应用级条目（状态/更新/注册命令/开发者工具）由壳提供：与官方应用菜单一致的能力，托盘只摆入口。
        extraItems: () => plusApplicationMenuItems(),
      })
      return plusProfileTray
    } catch (error) {
      // A tray that cannot be created must not keep the application from starting.
      console.warn('plus profile tray: unavailable', error)
      return { destroy: () => {} }
    }
  },
  quit: () => { app.quit() },
})

// 下载拦截只能在 app ready 之后装配：session.defaultSession 在 ready 前取值会抛
// "Session can only be received when app is ready"，直接把主进程打死（打包版表现为启动即崩）。
let plusDownloads: ReturnType<typeof attachDownloads> | undefined
const startPlusDownloads = (): void => {
  if (plusDownloads !== undefined) return
  plusDownloads = attachDownloads({ session: session.defaultSession, profileDir: resolveDesktopPaths().profile })
  app.on('will-quit', () => { plusDownloads?.dispose() })
}

/** 下载管理器；未就绪时给 RPC 一个可读错误，而不是把未定义拍给调用方。 */
const plusDownloadsManager = (): NonNullable<typeof plusDownloads>['manager'] => {
  if (plusDownloads === undefined) throw new Error('downloads are not ready yet')
  return plusDownloads.manager
}

let plusUpdates: InstanceType<typeof DesktopUpdateCoordinator> | undefined
/** 默认 profile 宿主端口（设置面板的 dsh 来源/状态卡要显示）。 */
/** 内置 dsh 运行时版本（读不到为 null，面板显示「取不到内置版本」，不编造）。 */
let plusBuiltinRuntimeVersion: string | null = null
/** plus 桌面设置（$DSH_HOME/desktop-settings.json）：面板显示的开关就以它为准。 */
const loadPlusDesktopSettings = (): Record<string, unknown> => loadDesktopSettings(resolveDshHome())
/** 默认 profile 宿主端口（设置面板的 dsh 来源/状态卡要显示）。 */
let plusHostPort: number | null = null
const plusProfilePorts = new Map<string, number>()

const plusRpcRegistry: RpcRegistry = createRpcRegistry([
  createUpdatesRpcHandlers({
    dshHome: () => resolveDshHome(),
    enabled: () => plusUpdates !== undefined,
    check: async () => {
      const coordinator = plusUpdates
      if (coordinator === undefined) return { update_available: false, version: null }
      const state = await coordinator.check(true) as { updateAvailable?: boolean, version?: string }
      return { update_available: state.updateAvailable === true, version: state.version ?? null }
    },
    download: async () => plusUpdates === undefined ? { ok: false, reason: 'update coordinator is not ready yet' } : { ok: ((await plusUpdates.download('')) as unknown) !== undefined || true },
    apply: async () => plusUpdates === undefined ? { ok: false, reason: 'update coordinator is not ready yet' } : { ok: ((await plusUpdates.install('')) as unknown) !== undefined || true },
  }),
  createProfilesRpcHandlers({
    // 端口表给磁盘全量 profile 的真值：页面口是壳分配的随机口（desktop 用宿主口），
    // lane 口以 profile 为唯一维度（profile_lane_ports.<name>；未覆盖的自动分配并持久化，天然互不相同）。
    profiles: () => {
      const laneOf = (name: string): number => lanePortFor(name)
      return [
        { profile: DEFAULT_PROFILE, pagePort: plusHostPort, lanePort: laneOf(DEFAULT_PROFILE), running: plusDesktopWindow() !== undefined },
        ...listProfileDirs(resolveDshHome())
          .filter((name) => name !== DEFAULT_PROFILE)
          .map((name) => ({
            profile: name,
            pagePort: plusProfilePorts.get(name) ?? null,
            lanePort: laneOf(name),
            running: plusProfiles.manager.list().some((entry) => entry.name === name),
          })),
      ]
    },
    pendingRestore: () => [],
    confirm: () => { },
    // 依赖卡要真实行：每个 profile 一行；壳直起 host，pnpm 记录与内置版本同源。
    dependencyRows: () => [{ name: DEFAULT_PROFILE, running: plusDesktopWindow() !== undefined }, ...plusProfiles.manager.list().map((entry) => ({ name: entry.name, running: true }))]
      .map((row) => ({ profile: row.name, recordedPnpm: null, builtinPnpm: plusBuiltinRuntimeVersion, needsRebuild: false, running: row.running })),
    createProfile: plusCreateProfile,
    deleteProfile: plusDeleteProfile,
  }),
  createSettingsRpcHandlers({
    platform: () => process.platform,
    // 面板语言：与壳/官方同一次判定（currentDesktopLocale）。
    locale: () => currentDesktopLocale().id,
    profile: () => DEFAULT_PROFILE,
    dshHome: () => resolveDshHome(),
    port: () => plusHostPort,
    builtinVersion: () => plusBuiltinRuntimeVersion,
    // 设置面板的 profile 下拉列磁盘上真实存在的全部 profile（与托盘一致）。
    profileNames: () => listProfileDirs(resolveDshHome()).map((name) => ({ name, active: name === DEFAULT_PROFILE, selectable: true })),
    // 设置里钉的运行时版本写出 plus-runtime.json；重启服务后由启动解析生效。
    // 防休眠：powerSaveBlocker 全平台可用，能力如实报可开（不需要平台分支）。
    keepAwakeCapability: () => ({ platform: process.platform, backend: 'electron-power-save-blocker', available: true, reason: null }),
    // 两个开关都读 plus 的设置文件：面板显示的是壳真正保存过的值。
    // 缺省开：仅显式 false 关（对齐设置页文案「缺省开」）；undefined/null/true 都算开。
    preventSleepActive: () => loadPlusDesktopSettings().prevent_sleep !== false,
    devToolsActive: () => loadPlusDesktopSettings().dev_tools === true,
    // remote_list 变更即时重建托盘菜单：新增/删除远程地址就是远程 profile 集变化。
    applySetting: (key) => { if (key === 'remote_list') refreshPlusTray() },
  }),
  createNotificationsRpcHandlers({
    dshHome: () => resolveDshHome(),
    bundleId: () => (app.isPackaged ? 'com.deepseek.harness.plus' : null),
    // 本机播放能力如实探测（afplay / paplay / aplay / PowerShell 矩阵），不再恒 null。
    capability: () => {
      const report = soundCapabilityReport()
      plusLogger.append(`[notifications] capability ${JSON.stringify(report)}`)
      return report
    },
    // 试听：默认音走系统提示音，文件音走平台播放器；返回是否真的会响。
    previewSound: (file) => {
      // #3：试听结果落 shell.log——Windows 真机没声时这里就是证据（选了哪个后端、启动是否成功）。
      plusLogger.append(`[notifications] preview file=${file ?? 'default(system beep)'}`)
      if (file === undefined) {
        // #9：默认音先走 systemDefaultSoundCommand（Windows 音效方案为无声时 shell.beep 完全静音），失败再回落 beep。
        const tone = systemDefaultSoundCommand(process.platform)
        if (tone !== null) {
          try {
            const child = spawn(tone[0] as string, tone.slice(1), { stdio: 'ignore' })
            child.on('error', (error: unknown) => { plusLogger.append(`[notifications] default tone failed: ${error instanceof Error ? error.message : String(error)}`) })
            plusLogger.append(`[notifications] preview used systemDefaultSoundCommand ${tone.join(' ')}`)
            return true
          } catch (error: unknown) {
            plusLogger.append(`[notifications] default tone spawn failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        shell.beep()
        plusLogger.append('[notifications] preview used shell.beep')
        return true
      }
      const started = playSoundFile(file)
      plusLogger.append(`[notifications] preview playSoundFile started=${started}`)
      return started
    },
    chooseSoundFile: () => {
      const picked = dialog.showOpenDialogSync({
        properties: ['openFile'],
        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg'] }],
      })
      return picked === undefined ? undefined : picked[0]
    },
  }),
  createDownloadRpcHandlers({
    list: () => plusDownloadsManager().list(),
    pause: (id) => plusDownloadsManager().pause(id),
    resume: (id) => plusDownloadsManager().resume(id),
    cancel: (id) => plusDownloadsManager().cancel(id),
    clearFinished: () => plusDownloadsManager().clearFinished(),
    reveal: (id) => {
      const record = plusDownloadsManager().list().find((entry) => entry.id === id)
      if (record === undefined || record.savedPath === '') return false
      shell.showItemInFolder(record.savedPath)
      return true
    },
    // 并发与下载目录读 plus 设置文件（写侧 set 会落盘），卡片每次轮询都得到真实值。
    settings: () => {
      const values = loadPlusDesktopSettings()
      const concurrency = typeof values.download_concurrency === 'number' ? values.download_concurrency : 3
      return { concurrency, directory: app.getPath('downloads') }
    },
    saveConcurrency: (value: number) => { saveDesktopSettings(resolveDshHome(), { download_concurrency: value }) },
  }),
  createLoggingRpcHandlers({
    kernel: plusLogKernel,
    // 真打开：shell.openPath 会在访达/资源管理器里把目录打开；失败回错误串。
    // 「打开日志目录」打开日志根目录（活跃日志与 archive/ 都在里面）。
    openPath: async (path: string) => await shell.openPath(path),
    collectDiagnostics: async () => collectDiagnostics({ logDir: plusLogDir, appVersion: plusDisplayVersion(), profile: 'desktop', deviceInfo: readDeviceInfo() }),
  }),
  createLifecycleRpcHandlers({
    restartDshService: async () => {
      await plusProfiles.manager.quitProfile(DEFAULT_PROFILE)
      await plusProfiles.manager.open(DEFAULT_PROFILE)
    },
    restartDesktopApp: (): Promise<RestartAllOutcome> => { void restartEverything(); return Promise.resolve({ restarted: [], failed: [] }) },
    exitWindow: () => {
      // #2：侧边栏退出必须真退 profile（停 host + 销毁窗口），只对无 profile 映射的窗口用官方关窗语义。
      const focused = BrowserWindow.getFocusedWindow() ?? plusDesktopWindow()
      if (focused !== undefined) {
        let port = 0
        try { port = Number(new URL(focused.webContents.getURL()).port) } catch { port = 0 }
        const name = [...plusProfilePorts.entries()].find(([, value]) => value === port)?.[0]
        if (name !== undefined) {
          plusQuittingProfiles.add(name)
          void plusProfiles.quitProfile(name).then((result) => {
            if (!result.ok) console.warn(`plus profile ${name} was not quit: ${result.reason}`)
          }).finally(() => { plusQuittingProfiles.delete(name); refreshPlusTray() })
          return
        }
      }
      // desktop（默认窗，无 profile 端口映射）：退出 = 停 dsh 进程树 + 销毁窗口，不是隐藏。
      if (focused === plusDesktopWindow()) {
        void quitDesktopProfile().catch((error: unknown) => { console.error(error) }).finally(() => { refreshPlusTray() })
        return
      }
      focused?.close()
    },
  }),
])

// 宿主里的插件（页面 client 的 host 半区）经宿主 IPC 发起 RPC：用同一张注册表派发。
setPlusShellRpcHandler(async (method, params) => plusRpcRegistry.dispatch(method, params as Record<string, unknown> | undefined))

// ── 宿主插件单向事件（plus-shell-notify）：通知投递 + 防休眠忙租约 ──
const plusNotifier = createPlusNotifier({
  policy: () => noticePolicyFromConfig(loadNotificationConfig(resolveDshHome())),
  context: () => ({
    windowFocused: BrowserWindow.getAllWindows().some((win) => win.isFocused()),
    fullscreen: BrowserWindow.getAllWindows().some((win) => win.isFullScreen()),
  }),
  log: (line) => plusLogger.append(`[notifications] ${line}`),
})
const plusSleepGate = createSleepGate(powerSaveBlocker)
const plusSleepHolders = new Set<string>()
const plusReconcileSleepGate = (active: ReadonlySet<string>): void => {
  const want: ReadonlySet<string> = loadPlusDesktopSettings().prevent_sleep !== false ? active : new Set()
  for (const profile of plusSleepHolders) {
    if (!want.has(profile)) { plusSleepHolders.delete(profile); plusSleepGate.release(profile) }
  }
  for (const profile of want) {
    if (!plusSleepHolders.has(profile)) { plusSleepHolders.add(profile); plusSleepGate.acquire(profile) }
  }
}
const plusBusyLease = createBusyLease({ onChange: plusReconcileSleepGate })
const plusBusySweep = setInterval(() => plusBusyLease.sweep(), 10_000)
plusBusySweep.unref()
setPlusShellNotifyHandler((notice) => {
  if (notice.type === 'busy-state') {
    plusBusyLease.report(notice.profile ?? 'desktop', notice.busy === true)
    return
  }
  deliverHostNotice({ notifier: plusNotifier, config: () => loadNotificationConfig(resolveDshHome()) }, notice)
})

/** Lane 口：profile_lane_ports.<name> 显式覆盖优先；否则自动分配 3091 起的下一个空闲口并持久化（每个 profile 一个稳定端口）。 */
const lanePortFor = (profile: string): number => {
  const settings = loadDesktopSettings(resolveDshHome())
  const overrides = typeof settings['profile_lane_ports'] === 'object' && settings['profile_lane_ports'] !== null
    ? settings['profile_lane_ports'] as Record<string, unknown> : {}
  const explicit = Number(overrides[profile])
  if (Number.isSafeInteger(explicit) && explicit > 0 && explicit < 65536) return explicit
  // 自动分配：避开已显式占用的口；结果写回设置，此后即为该 profile 的稳定端口。
  const taken = new Set(Object.values(overrides).map((raw) => Number(raw)).filter((port) => Number.isSafeInteger(port) && port > 0 && port < 65536))
  let port = 3091
  while (taken.has(port) && port < 65535) port += 2
  saveDesktopSettings(resolveDshHome(), { profile_lane_ports: { ...overrides, [profile]: port } })
  return port
}

/** 代理注入记录：桌面设置显式代理优先，否则检测系统代理；关 = 空记录（不动用户 env）。 */
const resolvedProxyEnvRecord = (): Record<string, string> => {
  const proxy = resolveProxyEnv(loadDesktopSettings(resolveDshHome()), detectSystemProxy({ platform: process.platform, env: process.env }))
  return proxy === null ? {} : proxyEnvRecord(proxy)
}




const writeDshPortFileFromUrl = (hostUrl: string): void => {
    try {
        const port = Number(new URL(hostUrl).port)
        if (port > 0) writeFileSync(join(app.getPath('userData'), 'dsh-desktop-port'), String(port))
    } catch { /* url without port — lane falls back to 3080 */ }
}


/**
 * The official Host seams one plus profile runs on. main() publishes them once the
 * runtime is known; the profile factory reads them when a profile window opens.
 */
let plusRuntimeDshOverride: string | undefined
let plusProfileHostContext: {
  readonly resources: RuntimeResources
  readonly primaryRuntime: string
  readonly hostEnvironment: () => NodeJS.ProcessEnv
} | undefined

/**
 * Start the Host runtime behind one plus profile window. The profile owns its own
 * directory, lock, and session; the official desktop profile stays untouched.
 */
let plusRestarting = false
/** 正在重启/启动中的 profile splash：宿主输出行实时推进它的文案（#⑥）。 */
const plusProfileSplashes = new Map<string, ReturnType<typeof createSplashWindow>>()
/** 就地重启正在销毁并重建主窗口：这段时间 window-all-closed 不能退主进程（Windows/Linux）。 */
let plusRebuildingDesktopWindow = false
/** 正在退出的 profile：退出路径上的 connection lost 页面日志不记（#3）。 */
const plusQuittingProfiles = new Set<string>()
/** 托盘/设置的「重启应用」：主进程留驻，托盘、DSH 服务、全部 profile 窗口依次经 splash 重建。 */
function restartEverything(): void {
  if (plusRestarting) return
  plusRestarting = true
  const zh = currentDesktopLocale().id.startsWith('zh')
  const label = (stage: string): string => stage === 'tray' ? (zh ? '托盘' : 'Tray') : stage === 'dsh' ? (zh ? 'DSH 服务' : 'DSH service') : (zh ? `Profile ${stage}` : `profile ${stage}`)
  const splash = createSplashWindow({ width: 460, height: 200, locale: app.getLocale() })
  const report = (stage: string): void => { splash.setStage({ stage: 'splash', detail: label(stage) }) }
  // #4：完整应用重启——主进程留驻，其余全部退出：主窗口先销毁（重建时走 splash 全流程），
  // 官方 DSH 树与各 profile 进程树依次重启，托盘重建，全部就绪后 splash 才消失。
  plusDesktopWindow()?.destroy()
  void restartApplicationInPlace({
    official: { restart: restartOfficialBackend },
    profiles: plusProfiles.manager.list().map((entry) => ({
      name: entry.name,
      restart: async (): Promise<void> => { await plusProfiles.restartProfile(entry.name) },
    })),
    recreateTray: () => { refreshPlusTray() },
    report,
  }).catch((error: unknown) => {
    console.error(error)
    dialog.showErrorBox('DSH Desktop Plus', String(error instanceof Error ? error.message : error))
  }).finally(() => {
    splash.dispose()
    plusRestarting = false
    refreshPlusTray()
  })
}
/**
 * profile 宿主的启动环境：继承桌面进程环境，所以 profile 窗口同样挂上 plus 插件
 * （desktop-plugin/remote-access，--patch 叠加层随进程环境继承）；
 * lane 端口按 profile 区分，每个宿主各占一个。
 * @param base - 桌面进程继承的环境。
 * @param name - profile 名（lane 端口按 profile 区分）。
 * @returns 带代理/客户端版本/专属 lane 端口的 profile 宿主环境。
 */
/**
 * 遥测 opt-out 环境变量：桌面设置 disable_telemetry 打开时给宿主进程带上
 * DSH_PLUS_DISABLE_TELEMETRY=1，web-app bundle 的两个采集行（OTLP 上报 + 桌面专属
 * 采集）看到它就整行禁用；改动重启 dsh 后生效。
 * @returns 需要叠加进宿主环境的键值（关闭时为空对象，不污染环境）。
 */
function plusTelemetryOptOutEnv(): NodeJS.ProcessEnv {
  const disabled = loadPlusDesktopSettings().disable_telemetry === true
  if (!disabled) return {}
  plusLogger.append('[desktop] telemetry opt-out: DSH_PLUS_DISABLE_TELEMETRY=1')
  return { DSH_PLUS_DISABLE_TELEMETRY: '1' }
}
function plusProfileHostEnv(base: NodeJS.ProcessEnv, name: string): NodeJS.ProcessEnv {
  return { ...base, ...resolvedProxyEnvRecord(), DSH_CLIENT_VERSION: desktopClientVersion(), DSH_REMOTE_LANE_PORT: String(lanePortFor(name)), ...plusTelemetryOptOutEnv() }
}

/** 远程重启 API：带配对 cookie 调远端 restart_desktop_app（lane 反代与 dsh 直连都靠 cookie 鉴权）。 */
async function restartRemoteProfileApp(remoteUrl: string, name: string): Promise<string> {
  const origin = remoteOrigin(remoteUrl)
  // 凭据链：窗口会话 cookie（当前连着就有）→ dsh home 里持久化的 deviceId 走 lane renew
  // → 地址里的 token 换一次（仅在从未配对、token 未消耗时能成功）。
  const stored = await session.fromPartition(partitionFor(name)).cookies.get({ name: 'dsh_mobile_session', url: origin }).catch(() => [])
  let cookieHeader = stored.map((c) => `${c.name}=${c.value}`).join('; ')
  if (cookieHeader === '') {
    const raw = loadDesktopSettings(resolveDshHome())['remote_device_ids']
    const ids = typeof raw === 'object' && raw !== null && Object.values(raw).every((v) => typeof v === 'string')
      ? raw as Record<string, string>
      : {}
    const known = ids[remoteUrl] ?? null
    if (known !== null) {
      const renewed = await fetch(`${origin}/__dsh-mobile/api/pair/renew`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: known }),
      }).catch(() => null)
      cookieHeader = (renewed?.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
      plusLogger.append(`[remote] restart auth via renew HTTP ${String(renewed?.status ?? 'no-response')} cookie=${cookieHeader === '' ? 'none' : 'obtained'}`)
    }
  }
  if (cookieHeader === '') {
    const authed = await fetch(remoteUrl, { redirect: 'manual' }).catch(() => null)
    cookieHeader = (authed?.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  }
  plusLogger.append(`[remote] restart_desktop_app auth=${cookieHeader === '' ? 'none' : 'cookie'} ${origin}`)
  const response = await fetch(`${origin}/api/shell.invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookieHeader !== '' ? { cookie: cookieHeader } : {}) },
    body: JSON.stringify({ rpcId: `plus-remote-restart-${Date.now().toString(36)}`, payload: { method: 'restart_desktop_app', params: {} } }),
  }).catch(() => null)
  if (response === null) {
    plusLogger.append(`[remote] restart_desktop_app transport failure ${origin}`)
    return cookieHeader
  }
  const body = await response.text().catch(() => '')
  plusLogger.append(`[remote] restart_desktop_app HTTP ${String(response.status)} ${body.slice(0, 200)} ${origin}`)
  return cookieHeader
}

/** 等远端重启完成：带配对 cookie 轮询 origin（无 cookie 会被 lane 门禁 401 挡，永远判不就绪）。 */
async function waitRemoteReady(origin: string, cookieHeader: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const probe = await fetch(origin, {
      redirect: 'manual',
      ...(cookieHeader === '' ? {} : { headers: { cookie: cookieHeader } }),
    }).catch(() => null)
    const text = probe === null ? '' : await probe.text().catch(() => '')
    if (probe !== null && probe.status < 400 && !text.includes('unpaired')) {
      plusLogger.append(`[remote] remote ready ${origin}`)
      return
    }
    await new Promise((resolvePromise) => { setTimeout(resolvePromise, 1500) })
  }
  plusLogger.append(`[remote] remote not ready within ${String(timeoutMs)}ms: ${origin}`)
}

async function createPlusProfileHost(name: string, profileDir: string): Promise<{ readonly url: string, readonly authUrl?: string, readonly stop: () => Promise<void> }> {
  // A remote address maps to a profile (bun remote semantics): proxy a best-effort restart
  // request to the far side and hand its origin to the window — no local Host is started.
  const remoteUrl = loadRemoteAddressList(resolveDshHome()).find((url) => remoteProfileName(url) === name)
  if (remoteUrl !== undefined) {
    const origin = remoteOrigin(remoteUrl)
    // 启动不碰 token：配对/续取完全在窗口侧（electron runtime 的 ensure 链）做，
    // 避免这里先消耗一次性 token 导致窗口侧 accept 403。
    return { url: origin, authUrl: remoteUrl, stop: async () => { } }
  }
  const parsePort = (hostUrl: string): number | undefined => {
    try { return Number(new URL(hostUrl).port) || undefined } catch { return undefined }
  }
  const context = plusProfileHostContext
  if (context === undefined) throw new Error('dsh desktop: the plus profile host is not ready')
  const projectManager = new DesktopProjectManager({ profile: profileDir, lock: join(profileDir, 'lock') }, context.resources)
  await projectManager.applyRelease()
  const host = new DesktopHostProcess(context.resources.node, context.resources.dsh, profileDir, undefined,
    plusProfileHostEnv(context.hostEnvironment(), name),
    (error) => { console.error(`plus profile ${name} host failure`, error) },
    context.primaryRuntime, context.resources, () => undefined,
    undefined,
    // #13：profile host 的 stdout 同样带 profile 标识进日志；#⑥：同时推进该 profile 的 splash 文案。
    (line) => {
      plusLogger.append(`[${name}] ${line}`)
      plusProfileSplashes.get(name)?.setStage({ stage: 'host', detail: line.length > 200 ? `${line.slice(0, 200)}…` : line })
    })
  const ready = await host.start()
  const port = parsePort(ready.url)
  if (port !== undefined) plusProfilePorts.set(name, port)
  plusProfileHostInstances.set(name, host)
  return {
    url: ready.url,
    stop: async () => {
      plusProfilePorts.delete(name)
      plusProfileHostInstances.delete(name)
      await host.stop()
    },
  }
}

const plusProfiles = createElectronProfileRuntime({
  app,
  dshHome: resolveDshHome(),
  createHost: (name, profileDir) => createPlusProfileHost(name, profileDir),
  // #8：profile 窗口走官方 createWindow 全流程（preload/桌面 chrome），console 带 profile 标识进日志（#13）。
  createWindow: (name) => plusProfileWindowFactory?.(name) ?? new BrowserWindow({
    title: `DSH Desktop Plus — ${name}`,
    webPreferences: { partition: partitionFor(name), contextIsolation: true, nodeIntegration: false },
  }),
  userDataDir: app.getPath('userData'),
  onChanged: () => { refreshPlusTray() },
  log: (line) => { plusLogger.append(line) },
})

async function reportStartupDiagnostic(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? message : message}\n`).catch(() => undefined)
  }
}
const ownsDesktopInstance = plusShell.claimSingleInstance(() => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(async () => {
  await runPlusStartup({
    startTray: () => { plusShell.start() },
    splashLocale: app.getLocale(),
    startHost: async (onHostOutput) => {
      try {
        await main(onHostOutput)
        // The plus profiles reopen the windows that were open when the application last exited.
        void plusProfiles.restoreAtStartup().catch((error: unknown) => { console.error(error) })
      } catch (error) {
        await reportStartupDiagnostic(error)
        throw error
      }
    },
  })
}).catch(async (error: unknown) => {
  await reportStartupDiagnostic(error)
  reportFatal(error, 'main')
}).catch(async (error: unknown) => {
  console.error(error)
  shuttingDown = true
  await stopOperationReports()
  app.exit(1)
})
