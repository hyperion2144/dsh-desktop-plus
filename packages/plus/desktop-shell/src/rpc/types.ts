// 壳侧 RPC 的线上契约：信封与处理器签名。
//
// 页面半区（desktop-plugin）把每个能力调用打成 `POST /__shell__/rpc`，
// 体 `{ method, params }`，本包按方法名分派到能力模块并回 `{ value }` 或 `{ error }`。
// 命令名与参数形状的唯一事实源是 desktop-plugin 的 `contracts/`；壳侧处理器
// 按 contracts 注释逐条对齐，未知方法返回明确 error（页面显示「未接入」而不是挂死）。

/** 反序列化后的请求参数（未知形状透传给处理器自行收窄）。 */
export type RpcParams = Record<string, unknown>

/** `{ value }` 成功回包或 `{ error }` 业务失败回包（二选一，HTTP 200）。 */
export type RpcEnvelope = { value: unknown } | { error: string }

/** 单条命令的处理器：参数已剥信封，返回值将包成 `{ value }`；抛错包成 `{ error }`。 */
export type RpcHandler = (params: RpcParams) => unknown | Promise<unknown>

/** 一组命令的处理器表；键为 contracts 命令名（snake_case）。 */
export type RpcHandlers = Record<string, RpcHandler>
