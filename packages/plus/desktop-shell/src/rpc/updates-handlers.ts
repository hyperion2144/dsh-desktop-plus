// 更新组命令：桥官方 update-coordinator（electron-updater 包装），通知偏好由壳持久化。
import type { RpcHandlers } from './types.ts'
import { loadDesktopSettings, saveDesktopSettings } from './desktop-settings.ts'

export interface UpdatesRpcDeps {
	dshHome: () => string
	/** 官方 coordinator 能力（dev/未打包时 enabled=false）。 */
	enabled: () => boolean
	check: () => Promise<{ update_available: boolean; version: string | null }>
	download: () => Promise<{ ok: boolean; reason?: string }>
	apply: () => Promise<{ ok: boolean; reason?: string }>
}

export function createUpdatesRpcHandlers(deps: UpdatesRpcDeps): RpcHandlers {
	const readState = () => {
		const settings = loadDesktopSettings(deps.dshHome())
		return {
			enabled: settings['update_notice_enabled'] !== false,
			ignored_version: typeof settings['update_notice_ignored'] === 'string' ? settings['update_notice_ignored'] : null,
		}
	}
	return {
		get_update_state: async () => {
			const availability = deps.enabled() ? await deps.check() : { update_available: false, version: null as string | null }
			const latest = availability.version ?? ''
			const available = availability.update_available === true
			const phase = available ? 'available' as const : 'idle' as const
			// 契约 UpdateSnapshot：客户端卡片直接读 view.phase / actions，字段不全就会整张卡片崩。
			return {
				available,
				reason: deps.enabled() ? '' : 'updater disabled in development builds',
				view: {
					available, reason: '', phase, label: '', status: phase, message: '',
					current: '', latest, channel: '', baseUrl: '', feedUrl: '',
					updateAvailable: available, updateReady: false, progress: null,
					bytesDownloaded: null, totalBytes: null, error: '', at: 0,
				},
				actions: { canCheck: deps.enabled(), canDownload: available, canApply: false, hint: '' },
				...readState(),
				backend: deps.enabled() ? 'electron-updater' : 'disabled',
			}
		},
		check_update: async () => (deps.enabled() ? deps.check() : { update_available: false, version: null, reason: 'updater disabled in development builds' }),
		download_update: () => deps.download(),
		apply_update: () => deps.apply(),
		get_update_notice_state: () => readState(),
		set_update_notice_enabled: (params) => {
			saveDesktopSettings(deps.dshHome(), { update_notice_enabled: params.enabled !== false })
			return readState()
		},
		restore_update_notice: () => {
			saveDesktopSettings(deps.dshHome(), { update_notice_enabled: true, update_notice_ignored: null })
			return readState()
		},
		clear_update_notice_ignored: () => {
			saveDesktopSettings(deps.dshHome(), { update_notice_ignored: null })
			return readState()
		},
	}
}
