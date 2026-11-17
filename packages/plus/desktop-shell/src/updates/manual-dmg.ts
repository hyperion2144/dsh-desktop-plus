/**
 * 未签名 macOS 构建的手动安装路径（#122）：从更新 feed 对应的 release 取 dmg
 * 安装镜像并打开，由用户拖拽安装（ShipIt 交接在 install-gate 被否决）。
 * 地址推导与执行分离：推导可独立测试，下载与打开全部注入。
 */
import { join } from 'node:path'
import { statSync } from 'node:fs'

/** 手动安装目标：dmg 下载地址、落盘文件名、兜底的发布页地址。 */
export interface ManualDmgTarget {
	readonly url: string
	readonly fileName: string
	readonly releasePageUrl: string | undefined
}

/** 从 app-update.yml 抽 `url:` 一行（行级解析，不引 YAML 依赖）。@param appUpdateYaml - app-update.yml 全文。@returns feed 根；缺失为 undefined。 */
export function parseAppUpdateFeedUrl(appUpdateYaml: string): string | undefined {
	const line = appUpdateYaml.split('\n').find((candidate) => /^url:\s*\S/.test(candidate))
	if (line === undefined) return undefined
	const value = line.slice('url:'.length).trim()
	return value === '' ? undefined : value
}

/**
 * 由 feed 根、目标版本与架构推导 dmg 地址。plus 产物命名是构建侧约定
 * （`dsh-desktop-plus-<version>-mac-<arch>-unsigned.dmg`）。GitHub 形 feed
 * （…/releases/latest/download/）换算到对应 tag 的固定地址，避免 release 前进后
 * latest 指向别的版本；自定义镜像退化为 feed 根 + 约定文件名，且无已知发布页。
 * @param feedUrl - app-update.yml 的 feed 根。
 * @param version - 目标更新版本。
 * @param arch - 目标架构（arm64/x64）。
 * @returns dmg 下载地址、落盘文件名与兑底发布页（未知为 undefined）。
 */
export function resolveManualDmgTarget(feedUrl: string, version: string, arch: string): ManualDmgTarget {
	const fileName = `dsh-desktop-plus-${version}-mac-${arch}-unsigned.dmg`
	const github = /^(https:\/\/[^/]+)\/([^/]+)\/([^/]+)\/releases\/latest\/download\/$/.exec(feedUrl)
	// 捕获组运行时必非空；undefined 分支只为 noUncheckedIndexedAccess 的类型收窄。
	if (github === null || github[1] === undefined || github[2] === undefined || github[3] === undefined) {
		return { url: `${feedUrl}${fileName}`, fileName, releasePageUrl: undefined }
	}
	const [origin, owner, repo] = [github[1], github[2], github[3]]
	return {
		url: `${origin}/${owner}/${repo}/releases/download/v${version}/${fileName}`,
		fileName,
		releasePageUrl: `${origin}/${owner}/${repo}/releases/tag/v${version}`,
	}
}

/** 注入的下载器：把 url 落到 destination（目录创建与旧文件清理由实现负责）。 */
export type DmgDownloader = (url: string, destination: string) => Promise<void>
/** 注入的打开器：用系统默认方式打开 dmg。 */
export type DmgOpener = (path: string) => Promise<void>
/** 注入的通知器：下载开始与镜像打开时给用户一句状态。 */
export type ManualInstallNotifier = (title: string, body: string) => void

/** 手动安装结局：镜像已打开，或失败（展示 reason + 兜底发布页）。 */
export type ManualInstallOutcome = { kind: 'opened'; path: string } | { kind: 'failed'; reason: string; releasePageUrl?: string }

/** 开始/成功两条提示的文案包（由接线层按当前语言生成）。 */
export interface ManualInstallNotifyCopy {
	startedTitle: string
	startedBody: string
	openedTitle: string
	openedBody: string
}

export interface ManualDmgInstallerDeps {
	/** app-update.yml 里的 feed 根（异步：读包内配置；undefined = 未配置）。 */
	feedUrl: () => Promise<string | undefined>
	arch: () => string
	/** dmg 落盘目录。 */
	targetDir: () => string
	download: DmgDownloader
	openPath: DmgOpener
	notify?: ManualInstallNotifier
	notifyCopy: (version: string) => ManualInstallNotifyCopy
}

/**
 * 组装手动安装器。install 依次：推导地址 → 通知开始 → 下载 → 打开镜像 →
 * 通知成功；任一步失败都收敛为 failed 结局（不抛出），由门控层负责呈现。
 * @param deps - 下载/打开/通知与文案的全部注入面。
 * @returns 带 install(version) 的手动安装器。
 */
export function createManualDmgInstaller(deps: ManualDmgInstallerDeps): { install(version: string): Promise<ManualInstallOutcome> } {
	return {
		async install(version: string): Promise<ManualInstallOutcome> {
			const feedUrl = await deps.feedUrl()
			if (feedUrl === undefined) return { kind: 'failed', reason: 'no packaged update feed is configured' }
			const target = resolveManualDmgTarget(feedUrl, version, deps.arch())
			const destination = join(deps.targetDir(), target.fileName)
			// 同版本镜像已在本地（上次点过安装）：直接再打开，不整包重下。
			const hasLocalCopy = (): boolean => { try { return statSync(destination).size > 0 } catch { return false } }
			const copy = deps.notifyCopy(version)
			try {
				deps.notify?.(copy.startedTitle, copy.startedBody)
				if (!hasLocalCopy()) await deps.download(target.url, destination)
				await deps.openPath(destination)
				deps.notify?.(copy.openedTitle, copy.openedBody)
				return { kind: 'opened', path: destination }
			} catch (error) {
				return {
					kind: 'failed',
					reason: error instanceof Error ? error.message : String(error),
					...(target.releasePageUrl === undefined ? {} : { releasePageUrl: target.releasePageUrl }),
				}
			}
		},
	}
}
