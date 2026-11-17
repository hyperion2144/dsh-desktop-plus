/**
 * 安装门控的 Electron 接线（#122）：codesign 自省、app-update.yml 解析、dmg
 * 下载与打开、系统通知和结果弹窗都走真实 Electron/系统面。纯判定与门控在
 * bundle-signature / manual-dmg / install-gate，这里只做默认装配；
 * 注入面供测试整体替换，缺省值全部惰性求值（模块加载不触碰 Electron API）。
 */
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { app, dialog, Notification, shell } from 'electron'
import { plusFormat, plusShellCopy } from '../locale/plus-copy.ts'
import { inspectMacosBundleSignature, resolveMacosUpdateInstallMode, type CodesignRunner, type MacosUpdateInstallMode } from './bundle-signature.ts'
import { createPlusUpdateGate, type UpdateCoordinatorView } from './install-gate.ts'
import { createManualDmgInstaller, parseAppUpdateFeedUrl, type DmgDownloader, type ManualInstallOutcome } from './manual-dmg.ts'

/** 门控装配项；除 coordinator 外全部可注入，缺省走真实 Electron/系统。 */
export interface PlusMacosUpdateGateOptions {
	/** 官方 coordinator 的最小观察面（模块作用域的 plusUpdates 即可）。 */
	coordinator: UpdateCoordinatorView
	/** 界面语言 id（与官方 currentDesktopLocale().id 同源），用于挑壳侧文案。 */
	localeId?: () => string
	runCodesign?: CodesignRunner
	fetchImpl?: typeof fetch
	openPath?: (path: string) => Promise<void>
	openExternal?: (url: string) => Promise<void>
	notify?: (title: string, body: string) => void
	showOutcome?: (outcome: ManualInstallOutcome, version: string) => Promise<void>
	resourcesPath?: () => string
	userDataPath?: () => string
	platform?: NodeJS.Platform
	arch?: string
}

/** 装配 plus 的 macOS 安装门控，返回接进官方 beforeRestart 缝的判定函数。 */
/** @param options - coordinator 观察面（必填）与其余可注入装配项。@returns 接进官方 beforeRestart 缝的门控。 */
export function createPlusMacosUpdateGate(options: PlusMacosUpdateGateOptions): () => Promise<boolean> {
	const platform = (): NodeJS.Platform => options.platform ?? process.platform
	const arch = (): string => options.arch ?? process.arch
	const localeId = (): string => options.localeId?.() ?? app.getLocale()
	const resourcesPath = (): string => options.resourcesPath?.() ?? process.resourcesPath
	const userDataPath = (): string => options.userDataPath?.() ?? app.getPath('userData')
	const runCodesign: CodesignRunner = options.runCodesign ?? ((args) => new Promise((resolve, reject) => {
		execFile('codesign', args, { timeout: 15_000 }, (error, stdout, stderr) => {
			// 只有进程没跑起来才走 unknown；非零退出仍带回输出交给解析。
			if (error !== null && typeof error.code !== 'number') { reject(error); return }
			resolve({ stdout: String(stdout), stderr: String(stderr) })
		})
	}))
	let cachedMode: MacosUpdateInstallMode | undefined
	const resolveInstallMode = async (): Promise<MacosUpdateInstallMode> => {
		const current = platform()
		if (current !== 'darwin') return 'shipit'
		if (cachedMode === undefined) {
			// 打包态 execPath 位于 <App>.app/Contents/MacOS/ 下，向上三级即 bundle。
			const appPath = dirname(dirname(dirname(process.execPath)))
			cachedMode = resolveMacosUpdateInstallMode(current, await inspectMacosBundleSignature(appPath, runCodesign))
		}
		return cachedMode
	}
	const download: DmgDownloader = async (url, destination) => {
		await mkdir(dirname(destination), { recursive: true })
		await rm(destination, { force: true })
		const fetchImpl = options.fetchImpl ?? fetch
		const response = await fetchImpl(url)
		if (!response.ok || response.body === null) throw new Error(`dmg download failed: HTTP ${response.status}`)
		await pipeline(Readable.fromWeb(response.body as NodeWebReadableStream<Uint8Array>), createWriteStream(destination))
	}
	const openPath = options.openPath ?? (async (path) => {
		const failure = await shell.openPath(path)
		if (failure !== '') throw new Error(failure)
	})
	const notify = options.notify ?? ((title, body) => {
		if (Notification.isSupported()) new Notification({ title, body }).show()
	})
	const openedCopy = (version: string): { title: string; detail: string } => {
		const copy = plusShellCopy(localeId())
		return { title: copy.manualInstallOpenedTitle, detail: plusFormat(copy.manualInstallOpenedDetail, { version }) }
	}
	const installer = createManualDmgInstaller({
		feedUrl: async () => parseAppUpdateFeedUrl(await readFile(join(resourcesPath(), 'app-update.yml'), 'utf8').catch(() => {
			// app-update.yml 缺席或不可读：feed 视为未配置，安装收敛为失败并引导发布页。
			return ''
		})),
		arch,
		targetDir: () => join(userDataPath(), 'manual-update'),
		download,
		openPath,
		notify,
		notifyCopy: (version) => {
			const copy = plusShellCopy(localeId())
			const opened = openedCopy(version)
			return { startedTitle: copy.manualInstallFetchingTitle, startedBody: plusFormat(copy.manualInstallFetchingBody, { version }), openedTitle: opened.title, openedBody: opened.detail }
		},
	})
	const showOutcome = options.showOutcome ?? (async (outcome, version) => {
		const copy = plusShellCopy(localeId())
		if (outcome.kind === 'opened') {
			const opened = openedCopy(version)
			await dialog.showMessageBox({ type: 'info', title: opened.title, message: opened.title, detail: opened.detail, buttons: [copy.ok], noLink: true })
			return
		}
		const buttons = outcome.releasePageUrl === undefined ? [copy.ok] : [copy.openReleasePage, copy.cancel]
		const result = await dialog.showMessageBox({ type: 'warning', title: copy.manualInstallFailedTitle, message: copy.manualInstallFailedTitle, detail: plusFormat(copy.manualInstallFailedDetail, { reason: outcome.reason }), buttons, cancelId: buttons.length - 1, noLink: true })
		const openExternal = options.openExternal ?? ((url) => shell.openExternal(url))
		if (result.response === 0 && outcome.releasePageUrl !== undefined) await openExternal(outcome.releasePageUrl)
	})
	return createPlusUpdateGate({
		coordinator: options.coordinator,
		resolveInstallMode,
		manualInstaller: installer,
		onOutcome: (outcome, version) => {
			void showOutcome(outcome, version).catch((error: unknown) => { console.error('plus manual update outcome:', error) })
		},
	})
}
