import type { RpcEnvelope, RpcHandler, RpcHandlers, RpcParams } from './types.ts'

/** 方法名 → 处理器 的合并视图。 */
export interface RpcRegistry {
	/** 分派一条命令：命中即调用并包 `{ value }`，抛错包 `{ error }`，未注册回稳定错误信息。 */
	dispatch(method: string, params: RpcParams | undefined): Promise<RpcEnvelope>
	/** 已注册的方法名（诊断/测试用）。 */
	methods(): string[]
}

/**
 * 把各能力模块的处理器表合并成一台分派器。
 *
 * 参数 `params` 缺失按空对象处理（页面对无参命令省略 params）；
 * 处理器抛出的 Error 取 message 作为 `{ error }` 回包，非 Error 值 JSON 化。
 */
export function createRpcRegistry(groups: RpcHandlers[]): RpcRegistry {
	const table = new Map<string, RpcHandler>()
	for (const group of groups) {
		for (const [method, handler] of Object.entries(group)) {
			if (table.has(method)) throw new Error(`duplicate rpc method: ${method}`)
			table.set(method, handler)
		}
	}
	return {
		async dispatch(method, params) {
			const handler = table.get(method)
			if (handler === undefined) return { error: `unknown rpc method: ${method}` }
			try {
				return { value: await handler(params ?? {}) }
			} catch (error) {
				return { error: error instanceof Error ? error.message : JSON.stringify(error) }
			}
		},
		methods: () => [...table.keys()],
	}
}
