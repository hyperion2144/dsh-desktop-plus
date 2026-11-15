/**
 * 应用内更新的安装门控（#122）：接在官方 coordinator 的 beforeRestart 缝上。
 * 该缝的官方语义：回调返回 true → 继续收尾并 quitAndInstall 交接 ShipIt；
 * 返回 false → 否决交接，coordinator 干净回到 ready（官方测试有断言）。
 */
import type { MacosUpdateInstallMode } from './bundle-signature.ts'
import type { ManualInstallOutcome } from './manual-dmg.ts'

/** 读安装模式（darwin 上含 codesign 自省，结果由实现缓存）。 */
export type UpdateInstallModeResolver = () => Promise<MacosUpdateInstallMode>
/** 手动安装执行器（下载 dmg 并打开）。 */
export type ManualUpdateInstaller = { install(version: string): Promise<ManualInstallOutcome> }
/** coordinator 的最小观察面：取当前目标版本（模块作用域的 plusUpdates 即可）。 */
export type UpdateCoordinatorView = () => { state: { version?: string } } | undefined
/** 把手动安装结局讲给用户（弹窗/通知），由壳负责。 */
export type ManualOutcomeReporter = (outcome: ManualInstallOutcome, version: string) => void

export interface PlusUpdateGateDeps {
	coordinator: UpdateCoordinatorView
	resolveInstallMode: UpdateInstallModeResolver
	manualInstaller: ManualUpdateInstaller
	onOutcome: ManualOutcomeReporter
}

/**
 * 安装门控：ShipIt 模式放行官方流程；手动模式执行 dmg 安装并否决交接。
 * 版本不可得时同样否决（上报失败结局）——绝不把用户推进注定失败的 ShipIt 安装。
 * @param deps - coordinator 观察面、安装模式解析、手动安装器与结局上报。
 * @returns 接进 beforeRestart 缝的门控函数。
 */
export function createPlusUpdateGate(deps: PlusUpdateGateDeps): () => Promise<boolean> {
	return async () => {
		if (await deps.resolveInstallMode() === 'shipit') return true
		const version = deps.coordinator()?.state.version
		if (version === undefined) {
			// 版本不可得时同样否决交接：绝不把用户推进注定失败的 ShipIt 安装。
			deps.onOutcome({ kind: 'failed', reason: 'desktop update: no checked version is observable' }, '')
			return false
		}
		const outcome = await deps.manualInstaller.install(version)
		deps.onOutcome(outcome, version)
		return false
	}
}

/**
 * 把门控接到官方 beforeRestart 上：gate 放行才执行官方收尾（任务锁定、backend
 * 停机等重流程），gate 否决时直接返回 false，官方重流程完全不跑。
 * @param gate - plus 安装门控。
 * @param original - 官方 beforeRestart 收尾流程。
 * @returns 包装后的 beforeRestart。
 */
export function wrapPlusUpdateInstallGate(gate: () => Promise<boolean>, original: () => Promise<boolean>): () => Promise<boolean> {
	return async () => {
		if (!await gate()) return false
		return original()
	}
}
