/**
 * #116 通知点击直通：协议解析与会话跳转脚本（纯函数，测试直接覆盖）。
 *
 * toast 的 body click 以协议激活回到应用本体：`dsh-plus://open?profile=<p>&session=<id>`。
 * 目标是「点横幅立即跳」——不落记录、不排队、不轮询。壳侧把这份 URL 解析成目标
 * 窗口与会话，页面侧只暴露 `__dshPlusFocusSession` 一个全局（幂等）。
 */

/** 通知点击协议的 URL 前缀。 */
export const PLUS_OPEN_URL_PREFIX = 'dsh-plus://'

/** 一次协议激活要送达的目标。 */
export interface PlusOpenTarget {
	/** 发起通知的 profile 名；空串表示默认 profile（主窗口）。 */
	readonly profile: string
	/** 目标会话 id；空串表示只聚焦、不切会话。 */
	readonly sessionId: string
}

/**
 * 解析 `dsh-plus://open?profile=&session=` 激活 URL。
 * @param url - 协议激活携带的完整 URL（second-instance argv 或 open-url 事件）。
 * @returns 目标；非 plus 协议、非 `open` host、非法 URL 返回 null（调用方按普通二次启动聚焦）。
 */
export function parsePlusOpenUrl(url: string): PlusOpenTarget | null {
	if (!url.startsWith(PLUS_OPEN_URL_PREFIX)) return null
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return null
	}
	if (parsed.hostname !== 'open') return null
	return {
		profile: (parsed.searchParams.get('profile') ?? '').slice(0, 200),
		sessionId: (parsed.searchParams.get('session') ?? '').slice(0, 200),
	}
}

/**
 * 页面跳会话的 executeJavaScript 源码。
 * `JSON.stringify` 负责引号、反斜杠与 Unicode 转义，id 不回显成页面源码的一部分。
 * @param sessionId - 目标会话 id。
 * @returns 调用页面全局 `__dshPlusFocusSession` 的表达式。
 */
export function plusFocusSessionScript(sessionId: string): string {
	return `window.__dshPlusFocusSession?.(${JSON.stringify(sessionId)})`
}
