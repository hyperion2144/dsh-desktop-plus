/**
 * Host 直连请求的凭据判定（纯函数，Electron 细节由调用方组装）。
 *
 * rc.5 起桌面 Host 的准入由 `connection.authentication` 决定，`/` 与 `index.html`
 * 是 required：裸 `GET /` 直接 401。产品窗口与本地 profile 窗口的页面和 `/api` 都由
 * `dsh-app://` 代理代答，剩下的直连（诊断面板 iframe 的文档与 `ws://` 升级）由主进程
 * 按窗口签名：每个窗口一份凭据，只签它自己 Host 的 host:port，页面永远不接触 cookie。
 *
 * @module @deepseek-ai/dsh-desktop-plus-shell/profiles/host-credential
 */

/** 一次请求的判定输入（Electron `onBeforeSendHeaders` 的 details 子集）。 */
export interface HostCredentialRequest {
	/** 发起请求的 WebContents id；Electron 在非渲染进程请求上留空。 */
	readonly webContentsId?: number
	/** 请求地址。 */
	readonly url: string
	/** 已有请求头。 */
	readonly requestHeaders: Record<string, string>
}

/** bind seam 需要的 Host 事实：地址、凭据与 boot 注入。 */
export interface ProfileHostFacts {
	/** Host 报告的 loopback 地址。 */
	readonly url: string
	/** 该 Host 的准入凭据；远程 profile 没有。 */
	readonly authenticationCookie?: string
	/** Host 交出的 boot 注入；页面 boot 按窗口回答。 */
	readonly injections?: readonly unknown[] | undefined
}

/** 一份 Host 直连凭据及其归属窗口。 */
export interface HostCredential {
	/** 允许携带该凭据的 WebContents id。 */
	readonly webContentsId: number
	/** 发起窗口文档的 origin（`dsh-app://app`、`dsh-app://profile-<name>`）。 */
	readonly documentOrigin: string
	/** Host 的 HTTP origin（`http://127.0.0.1:<port>`）。 */
	readonly hostOrigin: string
	/** 完整的 `cookie` 头值，例如 `dsh-desktop-session=<secret>`。 */
	readonly cookie: string
}

/** 交给 Electron `callback` 的回答：原样放行、取消请求、或改写请求头。 */
export interface HostCredentialDecision {
	/** true 时取消该请求；仅用于陌生 origin 的 ws 升级。 */
	readonly cancel?: boolean
	/** 改写后的请求头；缺省表示原样放行。 */
	readonly requestHeaders?: Record<string, string>
}

/**
 * 该 Host 地址的 origin。
 * @param hostUrl - Host 报告的 loopback 地址。
 * @returns 规范化 origin；地址无法解析或没有端口时返回 undefined。
 */
export function hostOrigin(hostUrl: string): string | undefined {
	let origin: URL
	try {
		origin = new URL(hostUrl)
	} catch {
		return undefined
	}
	return origin.port === '' ? undefined : origin.origin
}

/**
 * 本地 profile 窗口的文档 hostname：页面走 `dsh-app://profile-<name>/`。
 * @param name - profile 名。
 * @returns 绑定表与文档源共用的 hostname。
 */
export function profileDocumentHost(name: string): string {
	return `profile-${name}`
}

/**
 * 请求地址是否指向该 Host。
 *
 * `URL.origin` 对 ws 保留协议（`ws://127.0.0.1:<port>`），与 `http://127.0.0.1:<port>`
 * 永不相等，所以比较按 host:port 精确匹配、协议按 http↔ws / https↔wss 归一。
 * @param requested - 请求地址。
 * @param host - Host 的 HTTP origin。
 * @returns 该地址是否指向这个 Host。
 */
export function hostAddressMatches(requested: URL, host: string): boolean {
	let target: URL
	try {
		target = new URL(host)
	} catch {
		return false
	}
	if (requested.host !== target.host) return false
	return requested.protocol === target.protocol
		|| (target.protocol === 'http:' && requested.protocol === 'ws:')
		|| (target.protocol === 'https:' && requested.protocol === 'wss:')
}

/**
 * 给归属窗口的直连请求附加 Host 凭据。
 *
 * 只签该窗口自己 Host 的 host:port；`cookie` 头整条替换（Host 重启后 secret 会变，
 * 追加会留下一条过期凭据）。ws 升级沿用官方白名单：页面主源或宿主 origin 之外的
 * Origin 直接取消，其余按宿主视角改写为 same-origin。
 * @param details - 请求判定输入。
 * @param credential - 该窗口的 Host 凭据。
 * @returns 要交给 Electron `callback` 的回答；不属于该窗口或不指向该 Host 时原样放行。
 */
export function hostCredentialResponse(
	details: HostCredentialRequest,
	credential: HostCredential,
): HostCredentialDecision {
	if (details.webContentsId !== credential.webContentsId) return {}
	let requested: URL
	try {
		requested = new URL(details.url)
	} catch {
		return {}
	}
	if (!hostAddressMatches(requested, credential.hostOrigin)) return {}
	const headers = Object.fromEntries(
		Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]),
	)
	if (requested.protocol !== 'ws:' && requested.protocol !== 'wss:') {
		return { requestHeaders: { ...headers, cookie: credential.cookie } }
	}
	// 页面主源是 dsh-app://<host>；诊断面板 iframe 挂在宿主 origin，它的 ws Origin 就是宿主 origin。
	// 只放行这两种来源，其它 origin 的 ws 直接取消。
	if (headers.origin !== credential.documentOrigin && headers.origin !== credential.hostOrigin) {
		return { cancel: true }
	}
	return {
		requestHeaders: {
			...headers,
			origin: new URL(credential.hostOrigin).origin,
			cookie: credential.cookie,
			'sec-fetch-site': 'same-origin',
		},
	}
}
