# 移动端 WS 直连 lane 方案

状态：**已实施**（lane + 三平台壳）。目标：把外壳从 WS 数据面彻底移除；lane 只做一件事——压缩。
## 为什么必须换令牌（不能直接用 cookie）

1. 页面 origin 是壳回环（`127.0.0.1:<port>`），lane 是 `192.168.x.x:3093` → 跨站；
   `dsh_mobile_session` 为 `SameSite=Lax`，跨站 WS 握手不携带。
2. 改 `SameSite=None` 必须 `Secure`，lane 是明文 HTTP，浏览器拒收。
3. WebSocket API 不允许自定义请求头 → cookie 之外唯一可用的位置是 URL。

结论：lane 签一枚 **直连令牌**（HMAC 签名，内含会话值与到期时间；不是新增身份，验签后仍走既有设备判定），
页面把它放进 URL 直连 lane。令牌 ≠ 会话 cookie：只用于建数据面连接，不具备 RPC 权限，泄露面可控。

## 目标链路

```
页面（本地 dist，壳回环 origin）
  ├─ HTTP/SSE：同源 → 壳 PageServer → 转发 lane（附 cookie，不变）
  └─ WebSocket：ws://<lane>/__dsh_ws/<token>/api/remote.mux  ← 直连，壳不参与
                    │
                    └─ lane：校验令牌 → 终止 permessage-deflate
                        客户端压缩帧 → inflateRaw → 明文 → DSH
                        DSH 明文帧   → deflateRaw → 压缩帧 → 手机
```

## 实施清单

### A. lane（packages/plus/desktop-remote-access）

1. `ws-token.ts`（新增）：`mintWsToken` / `verifyWsToken` / `wsTokenOf`，HMAC-SHA256 签名，
   载荷是 `base64url(会话值).到期时间`；进程内密钥（重启即失效，壳重载页面时重签）。
   —— 不落地到设备记录：令牌是无状态的派生凭证，撤销靠会话本身（移除设备即失效）。
2. `lane-routes.ts`：登记 `/api/pair/ws-token`（**任何新控制端点必须进 `LANE_ROUTE_PATHS`**，
   否则会被当成 dsh 路径透传）；不进冻结别名（别名只收缩不增长）。
3. `index.ts`：`POST /__dsh-mobile/api/pair/ws-token`（cookie 鉴权）→ `{ token }`；
   `auth` 钩子：路径令牌（WS）或 `Authorization: Bearer`（HTTP）验签 → 还原会话值 → `isDevice`。
4. `proxy.ts`：**先鉴权、后剥前缀**。令牌就在前缀段里，先剥再验签等于把凭证扔掉（实机 401）。
5. `proxy.ts` 压缩终止（permessage-deflate，新模块 `ws-deflate.ts` + `ws-frame.ts`）：
   - 页面 offer 时回 `permessage-deflate; client_no_context_takeover; server_no_context_takeover`；
   - 上游不转发扩展协商（dsh 永远只见明文）；
   - 上行：解帧 → 解压 → 明文重加客户端掩码 → 转发；下行：解帧 → 压缩 → RSV1 帧回页面；
   - 控制帧原样透传（按目标方向重写掩码位）；帧流非法时回协议级 close 而不是死磕 raw 透传。
6. `proxy.ts` 保活泵：`wsFrameLength` 必须校验**载荷是否到齐**。不过这一关，跨 TCP 段的大帧
   会被当整帧消费、后续字节错位——App 独有的秒级重连与「历史加载失败」的真正根因。
### B. 壳（三平台同构）

1. 引导载荷装配处（三平台同构，参照鸿蒙 `HostConnector.socketBaseOf`）：
   用会话 cookie 调 `ws-token` → `socketBaseUrl = ws(s)://<lane>/__dsh_ws/<token>/`（**末尾斜杠必需**，
   否则相对解析会把令牌段吃掉）。**签发结果必须三分**（三平台各自一个 `WsTokenOutcome`）：
   - `token`：拼 base；
   - `gated`（lane 401/403 = 会话失效 / 设备被移除）：抛**门禁**异常，交给既有降级链
     （renew → accept → 需重新配对）；令牌比门禁更早发生，若并入「不可达」就等于删了降级链；
   - `unreachable`（网络 / 地址 / 5xx）：只能换下一个候选地址。
   数据面没有回退——但「没有回退」说的是连接形态，不是错误分类。
2. boot.js 不改：`streamBaseUrl` 原样取载荷字段；`createWebSocket` 只改写页面 origin 的 URL，
   直连地址原样落到原生 WebSocket；`protectLaneSocket` 继续绕开 lane 的回环改写补丁。
3. 删除三平台 WS 中继文件与全部装配点；页面服务对 WS 升级请求回 501（数据面不在壳里）。

### C. 验收

- 真机：进会话零「历史加载失败」；挂机 30 分钟零重连；桌面消息与历史上行正常。
- 压缩生效：lane 日志中 `upstream帧` 为明文、页面侧收到 RSV1 帧；弱网下行体积下降。
- 浏览器回归：浏览器仍走 cookie 路径，行为不变。

## 依赖与顺序

1. lane 改动（A）→ 本地 typecheck + 单测。
2. 壳改动（B）→ 三平台构建。
3. 桌面打包新版（lane 生效）→ 手机装新壳 → 联调验收。
