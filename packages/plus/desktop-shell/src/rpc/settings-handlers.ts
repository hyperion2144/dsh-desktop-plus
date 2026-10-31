// 设置与环境命令的壳侧实现（contracts/settings.ts 的中性行）。
// 读侧一次给全（环境 + 设置数据 + keep-awake 能力快照），保存走原子写；
// 日志保留策略变更时同步触发一次保留清理并带回回执（契约 #221 语义）。

import type { RpcHandlers } from './types.ts'
import { loadDesktopSettings, loadRemoteAddressList, saveDesktopSettings } from './desktop-settings.ts'

/** 设置组依赖（壳侧注入；测试注入内存实现）。 */
export interface SettingsRpcDeps {
        platform: () => string
	/** 与官方 currentDesktopLocale().id 同一判定：面板文案按它选语言。 */
	locale: () => string
        profile: () => string
        dshHome: () => string
        /** 服务端口（壳 HTTP 服务的宿主端口；拿不到为 null）。 */
        port: () => number | null
        /** 内置 dsh 运行时版本（来源卡显示「内置 <版本>」；读不到为 null）。 */
        builtinVersion: () => string | null
        profileNames: () => Array<{ name: string; active: boolean; selectable: boolean }>
        keepAwakeCapability: () => { platform: string; backend: string | null; available: boolean; reason: string | null } | null
        /** 登录自启能力快照（OS 读回为准）；面板据此隐藏开关。 */
        loginItemCapability: () => { supported: boolean; enabled: boolean } | null
        preventSleepActive: () => boolean
        devToolsActive: () => boolean
        /** 保存后的即时生效钩子（例如防休眠开关切换）；失败不阻断保存回执。 */
        applySetting?: ((key: string, value: unknown) => void) | undefined
        /** 日志保留清理（键 log_retention_days 变更时调用）；返回清理回执。 */
        cleanupLogs?: ((days: number) => { removed_files: number; bytes_freed: number }) | undefined
        log?: ((line: string) => void) | undefined
}

/** 构建设置组 handlers（键与 contracts/index.ts 的 settings 段一一对应）。 */
export function createSettingsRpcHandlers(deps: SettingsRpcDeps): RpcHandlers {
        const log = deps.log ?? (() => { })
        return {
		get_desktop_client_environment: () => ({ platform: deps.platform(), profile: deps.profile(), locale: deps.locale() }),

                get_desktop_settings_data: () => {
                        const settings = loadDesktopSettings(deps.dshHome())
                        return {
                                remote_list: loadRemoteAddressList(deps.dshHome()),
                                port: deps.port(),
                                profiles: deps.profileNames(),
                                prevent_sleep: deps.preventSleepActive(),
                                dev_tools: deps.devToolsActive(),
                                keep_awake: deps.keepAwakeCapability(),
                                login_item: deps.loginItemCapability(),
                                settings,
                        }
                },

                save_desktop_settings: (params) => {
                        const patch = typeof params.patch === 'object' && params.patch !== null ? params.patch as Record<string, unknown> : {}
                        const settings = saveDesktopSettings(deps.dshHome(), patch)
                        for (const key of Object.keys(patch)) {
                                try {
                                        deps.applySetting?.(key, settings[key])
                                } catch (error) {
                                        log(`setting ${key} applied with error: ${error instanceof Error ? error.message : String(error)}`)
                                }
                        }
                        if (typeof patch['log_retention_days'] === 'number' && deps.cleanupLogs !== undefined) {
                                return { settings, log_cleanup: deps.cleanupLogs(patch['log_retention_days']) }
                        }
                        return { settings }
                },

                get_proxy_settings: () => {
                        const settings = loadDesktopSettings(deps.dshHome())
                        const proxyMode = typeof settings['proxy_mode'] === 'string' ? settings['proxy_mode'] : 'system'
                        const proxyUrl = typeof settings['proxy_url'] === 'string' ? settings['proxy_url'] : ''
                        const noProxy = typeof settings['no_proxy'] === 'string' ? settings['no_proxy'] : ''
                        const effective = proxyUrl === '' ? null : {
                                http: proxyUrl,
                                https: proxyUrl,
                                all: proxyUrl,
                                no_proxy: noProxy,
                        }
                        return {
                                proxy_mode: proxyMode,
                                proxy_url: proxyUrl,
                                no_proxy: noProxy,
                                proxy_user: typeof settings['proxy_user'] === 'string' ? settings['proxy_user'] : '',
                                proxy_pass: typeof settings['proxy_pass'] === 'string' ? settings['proxy_pass'] : '',
                                effective,
                        }
                },

                save_proxy_settings: (params) => {
                        const patch: Record<string, unknown> = {}
                        for (const key of ['proxy_mode', 'proxy_url', 'no_proxy', 'proxy_user', 'proxy_pass'] as const) {
                                const value = params[key]
                                if (typeof value === 'string') patch[key] = value
                        }
                        const settings = saveDesktopSettings(deps.dshHome(), patch)
                        const proxyUrl = typeof settings['proxy_url'] === 'string' ? settings['proxy_url'] : ''
                        return {
                                ok: true,
                                effective: proxyUrl === '' ? null : {
                                        http: proxyUrl,
                                        https: proxyUrl,
                                        all: proxyUrl,
                                        no_proxy: typeof settings['no_proxy'] === 'string' ? settings['no_proxy'] : '',
                                },
                        }
                },
                // 契约 settings 段其余命令：面板每个卡片都会读，缺一个就整张卡片报错。
                get_dsh_status: () => ({ status: 2, mode: 'builtin', origin: '127.0.0.1', port: deps.port() ?? 0 }),
                toggle_zoom: () => ({ ok: true }),
                ui_input_confirm: () => ({ ok: true }),
                read_desktop_keybindings: () => null,
        }
}
