# 移动壳网络链路与稳定性机制

本文是移动壳与 DSH/lane 之间完整数据链路的事实源：每一层做什么、靠什么保活、
什么条件断开。排查连接问题先读这里，再动手改代码。

## 一、DSH 官方连接机制（浏览器/桌面/移动同构）

权威源码：`upstream/packages/client/connection/src/client/connection.ts`、
`upstream/packages/client/connection/src/recovery-config.ts`、
`upstream/packages/api/gateway/src/client/stream-client.ts`。

1. **物理承载**：页面 `ConnectionController` 打开一个 generation source——
   对 api gateway 是 `stream-client.ts` 的 `new WebSocket(remoteStreamUrl())`
   （同源 WS）。WS 建立后 gateway 下发 opening frame（host facts），
   generation ready，UI 进入「已连接」。
2. **状态机**：`connected / disconnected / connecting`。侧边栏「重新连接中」
   = `connection.connecting`，是 ConnectionController 的 connecting 状态，
   不是独立健康检查。
3. **重连策略**：指数退避——首重上限 500ms、因子 2、封顶 10s、实际延迟
   50–100% 抖动；`generationReadyTimeoutMs` 15s 内 WS 未就绪即取消本次
   generation 重来（3s 时先 warn）。
4. **无应用层心跳**：dsh 客户端不发任何心跳。连接活性完全依赖
   TCP/WS 层与下面的 lane 保活泵。

## 二、lane 的机制（remote-access host）

权威源码：`packages/plus/desktop-remote-access/src/host/{index,proxy}.ts`。

1. **lane = dsh 端口的完整反代** + 配对门禁（401 `{"error":"unpaired"}`）+
   控制面（`/__dsh-mobile/api/pair/*`）+ `/api/remote.mux` 复用通道。
2. **mux**：移动设备不直连 gateway，gateway 流复用在一条
   `WS /api/remote.mux` 上（多路复用给已配对设备）。移动变体页面的
   generation source 被替换为走 mux。
3. **空闲保活泵**（`createWsKeepalivePump`，缺省 15000/10000ms）：
   客户端无心跳，所以 lane 对空闲复用 WS 在**帧边界注入 PING（0x89 0x00）**；
   客户端内核自动回 PONG；**发出 PING 后 10s 内收不到客户端任何入站字节
   即判死、主动断开**（触发页面快速重连）。这就是「每 1–2 秒重连」检查的
   第一嫌疑：中继只要吞掉一个 PING 或 PONG，10 秒内必断。
   参数：settings `ws_keepalive_ms` / `ws_pong_timeout_ms`，0 = 关闭保活。
4. **凭证（两条腿）**：HTTP 经壳转发时按 `dsh_mobile_session` cookie（`name=value`
   原样解析）鉴权；WS 由页面**直连** lane，跳站握手带不上 cookie（SameSite=Lax），
   改用路径令牌 `/__dsh_ws/<令牌>/…`。两条腿解析/验签后都还原成同一个会话值，
   走同一套设备判定。
5. **直连令牌**：`POST /__dsh-mobile/api/pair/ws-token`（cookie 鉴权）→ `{token}`；
   `ws-token.ts` 用进程内密钥签 HMAC，载荷是会话值 + 到期时间（24h），
   不落地到设备记录（撤销靠会话本身）。**必须先鉴权、后剥前缀**——令牌就在前缀段里，
   先剥再验签就是 401。
6. **压缩终止**（`ws-deflate.ts`）：lane 对页面应答 permessage-deflate
   （`client/server_no_context_takeover`，逐消息独立），对 dsh 仍发明文帧。
   页面压缩帧 → 解压 → 明文给 dsh；dsh 明文 → 压缩 → RSV1 帧回页面。
   于是压缩只发生在「手机 ↔ lane」一跳。

## 三、移动壳的现状（我们的层）

1. **HTTP**：页面同源 fetch → ArkWeb 网络栈 → PageServer（回环 HTTP 服务，
   非拦截器）→ `forwardToLane` 附 cookie 转发。POST body 由 ArkWeb 完整
   送达，不经过 JSProxy。**JSProxy 请求桥已弃用为通道**：桥的结果回传
   （ArkWeb `GetJavaScriptResultV2`）是主线程同步 binder，真机 freeze 堆栈
   实锤它会因页面 RPC 风暴堵死主线程（THREAD_BLOCK_6S）。桥仅保留注册。
2. **WS**：页面直连 lane（`streamBaseUrl = ws://<lane>/__dsh_ws/<令牌>/`），壳**不参与**数据面：
   没有中继、没有二次握手、没有字节搬运。壳只负责在装载页面前把令牌塞进引导载荷。
   页面服务若收到 WS 升级请求，回 501（旧页面或第三方尝试）。
3. **回前台**：三平台都不重载页面——页面状态保全交给官方 generation 重连机制
   （online 事件 → attempt=0 → 最小退避立即重连），壳的任何主动 reload 都会
   摧毁页面状态。
4. **残留清理记录（2026-11-01 稳定性方案，mobile/STABILITY-PLAN.md）**：
   - 鸿蒙中继五处自断点全部移除（采样双发、PONG 守护、CLOSE 嗅探、合成
     未掩码 CLOSE、1.5s 重连延迟、30s 拒绝冷却）——采样双发是「只有 App 重连」
     的根因：每帧双发触发网关 duplicate streamId 判死（close 1008）。
   - `/_loopback/<port>/` 前缀剥除已修复（插件数据面不再 502）。
## 四、稳定性保障的正确姿势（结论）

1. **保活链路的判死窗已放宽**：网关心跳默认 10s（0009 号补丁，官方 Config
   `websocketHeartbeatIntervalMs`，判死窗 2×interval≈20s）；lane pong 超时缺省
   30s（`ws_pong_timeout_ms`）。lane 写目标 socket 失败时立即关整条连接，不养半死连接。
2. **不改动帧字节与顺序**：握手期间页面早发的帧在 101 后按原序补发
   （pending 机制），除此之外零改写。
3. **压缩只在一跳上终止**：页面 ↔ lane 压缩，lane ↔ dsh 明文。dsh 侧不参与压缩，
   压缩态就不会与网关心跳 / 判死窗口互相干扰。唯一必遵的一条：帧长解析必须校验载荷
   是否到齐（跨 TCP 段的半帧不得当整帧消费），否则整条流错位（曾表现为 App 独有秒级重连）。
4. **凭证边界**：cookie 只在壳内（HTTP 转发时出站附加）；页面可见的只有直连令牌，
   它只够建数据面连接，不具备 RPC 权限。
5. **回前台不重载**：交给 generation 重连；重载只留给「页面已不可用」
   的兜底路径。
6. **任何新转发路径先过本文**：移动壳与浏览器的差异只剩两条——
   官方 UI 从本地 dist 出、HTTP 多一层壳内回环转发（短请求，不涉及长连接稳定性）。
   WS 与「浏览器直连 lane」完全同构，唯一区别是凭证放在 URL 而不是 cookie。
7. **弱网与切换（B 系列，2026-11-01）**：≤20s 抖动由 TCP 重传扛住不断线；
   更长断网走官方恢复（online → attempt=0 → 最小退避）；同设备新 mux 升级
   到达时 lane 主动断旧（顶替语义，消除 409 窗口）；Android 前台服务保活；
   iOS 回前台秒恢复（页面不重载）。
