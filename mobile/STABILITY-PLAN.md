# 移动端连接稳定性方案（HarmonyOS / Android / iOS 三平台）

状态：**已实施，方案后段被取代**。壳内 WS 中继已整体删除，数据面改为页面直连 lane
（见 `WS-DIRECT-PLAN.md`）；本文保留作事实基础与根因记录。
目标（用户原话约束）：

1. 网络好时（局域网）：与浏览器直接访问 lane **完全等价**——零重连、零额外延迟。
2. 网络波动/切换/高时延时：连接稳定；真断了就自动重连，**用户 UI 无感知**（页面不重载、状态不丢、恢复后立即可用）。
3. 允许对 DSH（upstream 补丁集 / lane / plus 包）修改。

---

## 一、事实基础（全部有源码出处）

### 1.1 网关侧：mux 物理连接的全部死法

权威源码：`upstream/packages/api/gateway/src/stream-server.ts`。

| # | 死法 | 出处 | 触发条件 |
|---|------|------|----------|
| 1 | `close(1003)` | L189–191 | 收到**二进制**帧（协议要求文本） |
| 2 | `close(1008)` | L193–197 | 收到的文本帧解析失败 |
| 3 | `close(1008)` | L209–210 注释、L240–241 | **重复 streamId 的 `open`**（注释原话："A duplicate `open` is the one protocol violation that closes the socket"） |
| 4 | `terminate()` | L42 `MAX_MISSED_HEARTBEATS = 2`、L131–150 | 连续 2 个 `websocketHeartbeatIntervalMs`（默认 2000ms）内无任何对端活动 |
| 5 | `close(1001)` | L463–473 | Peer 作用域被销毁（配对注销等） |
| 6 | `close(1011)` | L304–313 | 失败帧写不出去（极端情况） |

关键补充：

- **单条逻辑流的 `error` 帧不碰物理连接**：`sendFailure`（L304–313）只针对该 streamId 写一个 error 帧；客户端收到后只 fail 那一条流（`stream-client.ts` L144–145）。任何业务层/域流报错都与重连无关。
- **存活判定极宽松**（L174–181、L186–188、L335）：PONG、任意入站帧、被拥塞延迟的下行为，全部计为对端活动。
- 心跳间隔是官方 Config：`websocketHeartbeatIntervalMs`，默认 2000ms（`gateway/src/index.ts` L159、`docs/config-catalog.md` L211）。官方 README 原话（`gateway/README.md` L95）："**如果部署的事件循环或网络可能停顿超过该间隔，必须调大此配置**"。

### 1.2 客户端不可能"自发"触发任何死法

权威源码：`upstream/packages/api/gateway/src/client/stream-client.ts`。

- 每条流 `streamId = randomUUID()`（L120）→ 正常客户端**永远不会** duplicate open（#3）。
- 客户端发出的永远是 JSON 文本帧（L391–393）→ 不可能触发 #1；帧不经过任何中间改写就不可能触发 #2。
- 客户端侧 WebSocket 协议栈自动回 PONG → 只要字节能穿透，就不会触发 #4。
- mux 客户端以 `waitForReconnect = 'answer'` 模式构造（`gateway/src/client/index.ts` L159–161：`new RemoteStreamMuxClient(path => connection.openWebSocket(path), connection.interactions === 'answer')`）→ socket 丢失后等待 Connection 换新 socket，业务流等待而不是雪崩。

**推论：在页面与网关之间，唯一能"改变字节"的环节就是壳中继。浏览器直连 lane 零重连 ⟹ 任何只有 App 才出现的重连，必然来自壳中继对字节的改变或对连接的主动处置。**

### 1.3 lane 侧语义（我们的包，非 upstream）

`packages/plus/desktop-remote-access/src/host/proxy.ts`：

- 客户端→上游：**原始管道，一个字节不动**（L668–669）。
- 上游→客户端：帧感知泵 `createWsKeepalivePump`（L317–345）：空闲 `wsPingIntervalMs`（默认 15000，settings 键 `ws_keepalive_ms`）在帧边界注入 PING `0x89 0x00`；发出 PING 后 `wsPongTimeoutMs`（默认 10000，settings 键 `ws_pong_timeout_ms`）内客户端无任何入站字节 → 判死断开。
- 401 门禁按会话 cookie（L618–624）；配对 cookie 可凭持久化 deviceId 续取（`pairing.ts` L258–263 `renew`，"无需重新配对"）。

### 1.4 同一 Peer 的第二条 mux：409 Conflict

`upstream/packages/client/connection/src/rpc-host.ts` L145–151：同一 API Peer 在旧 socket 仍持有所有权（未走到 release）时，新升级请求被拒 **409**。窗口 = 旧 socket 从断开到服务端处理完释放的时长；干净关闭（真实 CLOSE 帧到达并被处理）时该窗口 ≈ 0。客户端对 409 的行为是官方退避重试（见 1.5），无需壳层发明延迟。

### 1.5 官方恢复机制（已存在，壳不要重新发明）

`upstream/packages/client/connection/src/client/connection.ts` + `client/index.ts`：

- `setNetworkAvailable` 接线到页面 `online`/`offline` 事件（`client/index.ts` L209–217）；**网络恢复时 `attempt = 0`**（L128–130）→ 下一次重试用最小退避，立即执行。
- 退避：500ms 起、因子 2、封顶 10s、50–100% 抖动（L139–147）。
- `generationReadyTimeoutMs` 15s 兜底 + generation 机制保全页面状态。
- 结论：**断线后的自动重连 + 页面状态保全，官方全链路已经做好**。壳的任务只有两件：①平时不给官方连接制造死法；②断了之后让"下一次握手"越快成功越好（管道畅通 + 有效 cookie）。

### 1.6 三平台壳中继现状对照

| 平台 | 实现 | 转发语义 | 额外发明 |
|------|------|----------|----------|
| Android | `mobile/android/.../shell/relay/WebSocketRelay.kt`（本地回环 `ServerSocket`） | 双向 `copy()` 纯字节管道 | **无**（嗅探/合成帧/延迟都没有） |
| iOS | `mobile/ios/.../Shell/relay/WebSocketRelay.swift`（`NWListener`） | 双向 receive/send 纯字节管道 | **无** |
| HarmonyOS | `mobile/harmony/.../shell/relay/WebSocketRelay.ets` | 双向泵 | **五处自断点**（见下） |

---

## 二、根因（为什么只有 App 重连）

按「发现顺序」记：每一条都是壳独有的自断点（浏览器没有等价路径），前两条修掉后症状仍在，
第三条才是最终落地的根因。

1. **采样块双重转发（已修，仍复现）**：采样块与 `pump()` 各注册了一次 `page.on('message')`。
   HarmonyOS netstack 的事件是**多播**语义，于是页面每一帧都被发往 lane 两次 → 网关命中
   duplicate streamId → 整条 mux 被 close(1008)。这解释了「只有 App 重连」的一大半，
   但修掉后秒级重连依然出现——它不是全部。
2. **壳发明的自断点（已全部删除）**：PONG 守护（嗅到疑似 PING 就 3s 后主动关）、合成未掩码
   CLOSE（客户端→服务端必须掩码，壳补发的是协议违规）、REOPEN_DELAY 1.5s、REJECT_COOLDOWN 30s。
3. **保活泵的帧边界解析（最终根因）**：`wsFrameLength` 只算信封长度、**不校验载荷是否到齐**。
   一帧跨两个 TCP 读时，泵把这半帧当整帧消费，剩下的半帧在下一个 chunk 里被当成新帧头──
   整条流从这一刻开始错位：页面侧表现为 WS 协议错误后重连，lane 日志表现为解出垃圾关闭码
   （34073 / 12332 / 38373……）。手机端的大帧（历史、长消息）和弱网下的分片读让这条路径成为
   常态，而浏览器直连 lane 根本不经过任何帧级处理，所以从来不复现。
4. **结构性结论**：只要「壳里存在帧级处理」，帧完整性就必须有唯一实现。现在的形态是——
   数据面直连 lane（壳不碰字节），帧级处理只剩 lane 一处，并且被单测钉死
   （`ws-deflate.test.ts` 的「任意切分」用例 + `ws-direct.test.ts` 的端到端链路）。

需求 1（局域网零重连）的落地形态：从「把中继收敛成透明管道」进一步改为「根本不要中继」——
WS 由页面带令牌直连 lane，壳不碰一个字节（下文三、四节保留为演进过程记录）。

---

## 三、方案 A：局域网零重连（需求 1）

改动仅 HarmonyOS 中继一个文件（按 AGENTS.md 深度要求顺手拆小文件）：

**`mobile/harmony/entry/src/main/ets/shell/relay/`**

- `WebSocketRelay.ets`（编排）：握手编排 + 启动泵。
- `LaneSocket.ets`：现有 `PlainLaneSocket` / `SecureLaneSocket`（单监听语义，保留）。
- `LaneHeadReader.ets`：现有 `readLaneHead` / `parseLaneHead`（消费 lane 101 头，保留）。

`handle()` 新流程（每一件都与浏览器等价）：

1. 握手：向 lane 发握手（cookie + 页面扩展协商透传）→ 消费 lane 101 → 回页面 101（accept 按页面 key，extensions 用 lane 同意的那份）→ 补发 pending 早到帧。
2. 泵：`lane.onMessage → page.send`、`page.on('message') → lane.send`，**每个方向恰好一个监听器**；任一方向 send 失败 → 两端立即关闭（不养半死连接）。
3. `lane.onClose → page.close`；`page.on('close'|'error') → lane.close`。**零合成帧、零宽限、零延迟、零冷却。**
4. 保留 lane TCP `keepAlive()`（链路层 SO_KEEPALIVE，不碰协议）。

删除：采样块、awaitingPong 守护、CLOSE 帧嗅探、`CLOSE_FRAME`/`CLOSE_GRACE`/`cleanClose` 合成路径、`lastClosedAt`/`REOPEN_DELAY`、`rejectedAt`/`REJECT_COOLDOWN`。

等价性论证：改完后壳中继对两端都是逐字节直通；App 链路与浏览器链路对 lane/网关**完全同构**，网关判死集合（1.1 的六条）没有任何一条会先于浏览器被 App 触发。浏览器零重连 ⟹ App 零重连。

---

## 四、方案 B：弱网 / 切换 / 高时延无感（需求 2）

分四层，全部有官方依据：

### B1【DSH 补丁·桌面侧】网关心跳 2000ms → 10000ms

- 位置：`upstream/packages/api/gateway/src/index.ts` 的 `DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS`，经 `scripts/plus/hooks/`（desktop patch set，**一处**）改。网关跑在桌面 dsh 进程里，手机只是客户端。
- 效果：判死窗从 ~4s（2×2s）变为 ~20s（2×10s）。**≤20s 的网络抖动/切换（Wi-Fi 漫游、基站切换）期间由 TCP 重传扛住，连接根本不断**，浏览器与 App 同时受益、行为一致。
- 依据：官方 README L95 原话"网络可能停顿超过该间隔的部署必须调大"；远程访问就是这样的部署。代价仅是死客户端 socket 多留 20 秒（无害）。
- 桌面本地直连场景不受影响（PONG/入站帧每 10s 一次，仍在判死窗内）。

### B2【plus 包·桌面侧】lane `ws_pong_timeout_ms` 10000 → 30000（可选加固）

- 位置：`proxy.ts` L440 缺省值（我们的包，直接改）；settings 键保留可覆盖。
- 网关心跳放宽后上游→客户端每 ~10s 有控制帧，lane 泵的空闲注入很少武装；此改动只覆盖"网关事件循环停顿 >10s"的病态场景（README 同一段的告诫）。默认值直接改，无需设置。

### B3【壳·三平台】握手 401 → 自动续 cookie 再试一次

- 现状：lane WS 握手被 401（会话 cookie 过期）时，三平台中继都直接关页面 socket → 页面重连 → 再 401 → 循环。
- 改动：握手被拒（非 101）时，调壳内已有的 pairing renew（deviceId 已持久化，`pairing.ts` L260；三平台各自已有 `PairingService`/`LanePairingClient`）换新 cookie，更新 `host.sessionCookie`，重试一次握手；仍失败才放弃交回官方退避。
- 效果：长会话 cookie 过期从"重连循环"变为"无感续期"。

### B4【壳·Android/iOS】permessage-deflate 透传（对齐 HarmonyOS）

- 现状：Android/iOS 中继的握手不透传 `Sec-WebSocket-Extensions` → 页面与网关两端都无压缩；mux 的 JSON 帧 ≥1024 字符本可压缩（网关 L329，`compression && text.length >= 1024`）。弱网高时延下白耗带宽。
- 改动：把两平台中继的握手顺序调整为"先连 lane 拿到扩展协商，再回页面 101"（HarmonyOS 已是此顺序），并把页面请求的 extensions 带给 lane、lane 同意的那份回给页面。中间字节依旧零改写（两端各自压缩/解压）。

### B5【壳·平台后台策略】

- **HarmonyOS**：连续任务 `MULTI_DEVICE_CONNECTION` + 权限 + `backgroundModes`（已落地，保留）；P1 删除 PONG 守护后，后台短暂冻结不再被壳误杀；叠加 B1 的 20s 判死窗，**数十秒级后台挂起也不断线**。
- **Android**：当前壳无前台服务，后台 WebView 网络可能被冻结。二期可加 `connectedDevice` 类型前台服务（需通知栏常驻，**是否要做等用户单独拍板**，不阻塞本方案）。
- **iOS**：系统会在后台挂起进程，socket 必死——诚实边界，不做伪保活。iOS 的目标是**回前台秒恢复**：页面不重载（`ShellController` 已有 `pageLoaded`/`switching` 条件，保留）+ 官方恢复链路（见 B6）+ B3 续期。实测形态：回前台 → 侧边栏短暂「重新连接中」→ 自动恢复，页面状态完整。

### B6【官方已就位，壳零改动】断线后的自动恢复

- 页面 `online` 事件 → `setNetworkAvailable(true)` → `attempt=0` → 最小退避立即重连（1.5）。
- 409 窗口（旧 Peer 未释放）由官方退避覆盖，通常一次重试即成功；不发明延迟。
- 可选二期（lane 侧，我们的包）：新 mux 升级到达且同设备旧 socket 仍在时，lane 主动断旧——把非正常死亡后的 409 窗口压到 0。不做也不影响需求达成，列为备选。

**弱网 UX 的诚实描述**：≤20s 的抖动/切换 → 完全无感（连接不断）；>20s 的真实断网 → 侧边栏短暂「重新连接中」→ 网络恢复后 ≤ 数秒自动恢复、页面不重载。这与桌面浏览器在同一网络下的表现完全一致——这就是"与浏览器等价"的含义。

---

## 五、明确不做的事

- 不在中继里发明任何心跳/守护/嗅探/延迟/冷却（浏览器没有的一律不加）。
- 不改官方退避参数、不绕过 generation 机制。
- 不做 MPTCP/连接迁移（平台 socket API 不支持，不做虚假承诺）。
- 不禁用/绕过任何插件、不改配对门禁语义。
- 不动桌面链路功能语义（B1/B2 只放宽判死窗，桌面行为不变）。

---

## 六、改动面清单（批准后执行）

| # | 文件 | 平台/归属 | 动作 | 方案项 |
|---|------|-----------|------|--------|
| 1 | `mobile/harmony/.../relay/WebSocketRelay.ets`（拆 3 文件） | HarmonyOS 壳 | 重写为透明管道，删五处自断点 | A |
| 2 | `scripts/plus/hooks/`（gateway 心跳默认值补丁） | 桌面 patch set | `DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS` 2000→10000 | B1 |
| 3 | `packages/plus/desktop-remote-access/src/host/proxy.ts` | plus 包 | `wsPongTimeoutMs` 缺省 10000→30000 | B2 |
| 4 | `mobile/harmony/.../relay/WebSocketRelay.ets` | HarmonyOS 壳 | 握手 401→renew→重试一次 | B3 |
| 5 | `mobile/android/.../relay/WebSocketRelay.kt` | Android 壳 | 握手重排（先 lane 后页面）+ 扩展透传 + 401→renew | B3/B4 |
| 6 | `mobile/ios/.../Shell/relay/WebSocketRelay.swift` | iOS 壳 | 同上 | B3/B4 |
| 7 | `mobile/NETWORK.md`、`CHANGELOG.md` | 文档 | 机制与变更记录 | — |
| 8 | （二期，待单独拍板）Android 前台服务；lane mux 顶替语义 | Android 壳 / plus 包 | 后台保活、409 窗口归零 | B5/B6 |

boot.js（三平台）、后台连续任务、回前台不重载：**已就位，不动**。

## 七、验收矩阵

| # | 场景 | 通过标准 |
|---|------|----------|
| 1 | 三平台进会话挂机 30 分钟（局域网） | 侧边栏零「重新连接中」；浏览器同环境对照零重连 |
| 2 | 持续流式输出中反复切后台/回前台 ×20（HarmonyOS） | 无页面重载、无重连横幅、输出不丢 |
| 3 | 路由器限速 5% 丢包 + 200ms 时延 | 连接保持，流式不中断 |
| 4 | 断网 10s / 30s / 2min 后恢复（三平台） | 恢复后 ≤10s 自动重连，页面状态完整，无整页刷新 |
| 5 | Wi-Fi ↔ 蜂窝切换 | 切换 ≤20s 时连接不断；更长断网走 B6 恢复 |
| 6 | cookie 长会话过期 | 握手 401 → 自动续期 → 用户无感 |
| 7 | 桌面回归 | 浏览器/桌面 App 行为不变（B1/B2 仅放宽判死窗） |

## 八、风险与回滚

- A（中继重写）：行为收敛为标准 RFC 6455 字节透传，风险集中在"删多了"——以 Android/iOS 现行实现为行为基准对照验收（#1）。
- B1：官方 Config 语义内的默认值调整，随时可还原单行补丁。
- B2/B3/B4：均为增量小改，独立可回滚。
