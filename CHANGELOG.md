# Changelog

## 未发布

### 移动端连接稳定性

- 三平台：数据面改为**页面直连 lane**，壳内 WS 中继整体删除（不再有「两次握手 + 字节搬运」）：页面把 lane 签发的直连令牌放进 WS 路径 `/__dsh_ws/<令牌>/…`，建连不再依赖跨站 cookie。
- lane：直连令牌——由会话 cookie 换取（`POST /__dsh-mobile/api/pair/ws-token`，HMAC 签名 / 24h），WS 走路径令牌、HTTP 走 `Authorization: Bearer`；验签后还原会话值，沿用既有设备判定。
- lane：permessage-deflate 在 lane 终止——页面压缩帧解压成明文给 dsh，dsh 明文压缩后回页面（`client/server_no_context_takeover`，逐消息独立）；dsh 侧不再是压缩连接。
- lane：修复保活泵在帧跳 TCP 段时**丢字节**（帧长度解析不校验载荷是否到齐，把半帧当整帧消费 → 后续字节错位）——这是 App 独有的秒级重连与「历史加载失败」的根因。
- lane：WS pong 判死超时 10s→30s；同设备新 mux 升级主动断旧连接（顶替语义，消除异常断线后的 409 重连窗口）。
- 桌面：gateway 心跳默认 2s→10s（判死窗 4s→20s，网络抖动不再触发重连；0009 号补丁）。
- 三平台：回前台不再重载页面，页面状态保全交给官方 generation 重连机制。
- Android：新增连接保活前台服务（connectedDevice 类型），后台期间 WebView 长连接不被冻结。

### 包名统一变更

- 三平台应用标识换成自有反向域名：桌面 `io.github.hyperion2144.dsh.plus`，移动端统一 `io.github.hyperion2144.dsh.plusm`（Android applicationId / iOS bundle id / 鸿蒙 bundleName）；旧标识随本次发版废弃，无存量用户，版本仍以 `.1` 覆盖发布。
- Android namespace 与源码包不变（applicationId 与代码命名空间分离）；README 与壳内注释的调试命令改为全限定 component。

### 移动端品牌与模拟器联调

- 三平台启动图标统一复用桌面官方图标（鸿蒙 / iOS / Android 各密度与自适应前景；`mobile/tools/sync-icons.sh` 生成，程序生成的字母图标废除）；应用名与配对设备名统一为「DSH Desktop PlusM」。
- Android 补齐此前缺失的应用图标（自适应 `mipmap-anydpi-v26` + 各密度）；应用名、管理页与锁屏文案里的旧名一并清除。
- 鸿蒙：修复全部页面字符串渲染为 `[object Object]`（`$r().toString()` 误用 ×60，改 `resourceManager.getStringSync`）；未连接时不再空载加载页面，改壳内占位屏（引导载荷仅在连接后可用）；页面载体与浮层切换器合并叠放，页面恢复全屏；带参状态文案替换占位符。
- 鸿蒙：资产读取异步化 + 内存缓存（修复真工作台加载期主线程阻塞 appfreeze）；壳内 dist 资产本地优先（`/assets/` 未命中才转发主机，版本错位不再 404 白屏）；管理页卡片边距对齐 24。
- 模拟器全链路联调结论入 `mobile/harmony/README.md`（配对四态、真桌面 lane 配对、页面装载、图标与应用名）；完整工作台持续运行与生物锁等留真机验收。
- 主机切换改壳内原生浮层实现（叠加在 WebView 上的原生 UI）：鸿蒙已原生，Android / iOS 补齐；页面内注入的切换器补丁废除，移动补丁集清空——upstream 不再接受注入的移动 UI，切换器数据走各壳既有注册表与重载机制。
- Android：模拟器全链路联调通过（配对 → 管理页 → 完整工作台 → 原生切换浮层单 FAB）；壳内 dist 曾混入已废除的注入切换器旧产物，移动变体重建同步后清除，`sync-web-dist.sh` 注释与 README 默认路径同步改准。
- iOS：模拟器全链路联调通过（生物锁冷启动与敏感操作两态、系统 PIN 回退、配对、完整工作台、原生切换抽屉）；修复 scheme 转发丢结尾斜杠（Foundation url.path 把 /plugins/ 变 /plugins，插件 combo 404 页面起不来）；修复切换角标被外层容器居中（ZStack 按内容收缩，frame 补 bottomTrailing 对齐）。


### 移动端原生 UI 与真机修复

- 三平台应用图标重做：按各平台规范生成圆角与安全区（Android 自适应前景 + 旧式圆角、iOS 1024 内容 72%、鸿蒙 512 圆角），图标不再显示为直角方块；生成脚本从 sips 等比缩放改为 Pillow（`mobile/tools/sync-icons.sh` 入口 + `mobile/tools/sync_icons.py`），并自带产物自检。
- 三平台主题支持跟随系统与手动切换（跟随系统 / 浅色 / 深色），选择落盘、冷启动恢复；鸿蒙浅色为默认资源、深色走 dark 资源目录。
- 三平台页面边距加倍：内容 gutter 统一 32，卡片不再贴屏幕边缘；鸿蒙修掉「卡片水平 margin + width('100%') 叠加溢出」与 Scroll 默认居中导致的配对页顶部空白。
- 鸿蒙：修复真机进入 DSH 界面点击即崩溃（appfreeze）——lane 请求与 base64 大解码移入 TaskPool 子线程，主线程不再阻塞。
- 鸿蒙：配对完成后「进入」直接回到工作台。
- 鸿蒙：壳内 dist 重新同步最新移动变体，修复工作台出现两个切换按钮。
- 鸿蒙：修复工作台 WS 反复重连直到主线程拖死（appfreeze）——中继消费 lane 的 101 应答头（不再当帧转给页面）、透传 permessage-deflate 压缩协商、开 TCP keepalive；SSE 转发改二进制拼帧、转发日志瘦身。
- 三平台：修复已配对主机进去却要求重新配对——一次性令牌不再持久化（存量升级即清理），降级链区分「网络不通（换地址重试）」与「设备被移除（才要求重新配对）」，凭证恢复对齐桌面远程 profile 模式；鸿蒙资产存储改写探针探测并带出错误码。
- 鸿蒙：修复 app 启动卡死在图标页——这套系统对「条目不存在」的资产查询抛错而非返回空，恢复主机时炸穿初始化；读取时按 not-found 归一为空，探测加 3 秒超时兜底。
- 鸿蒙：WS 中继的关闭改为协议级干净关闭（先发 CLOSE 帧再延迟断 TCP）——gateway 按 Peer 清理逻辑流，TCP 硬断的异步清理来不及，页面 500ms 级重连会撞 duplicate open 被立刻关闭，形成无限重连；同时转发失败立即整体作废、保活 PING 加 3 秒 PONG 守护、回前台不再重载页面、`/_loopback/<port>/` 前缀剥除修复插件数据面 502。
- 三平台：主机支持重命名与移除——鸿蒙长按/行尾菜单（移除二次确认 + 生物锁验证回来后执行，修掉过锁意图丢失的「闪一下」），Android 长按菜单，iOS 长按菜单 + 重命名弹窗。
- 三平台：取消页面内悬浮主机切换按钮（会遮挡 DSH 内容），切主机从顶栏进管理页。

### 移动端构建机制

- 移动变体构建入口 `pnpm run build:web:mobile`：以「官方树 + 移动补丁集」构建 apps/web dist 的移动变体，产物落在 `dist/web-mobile/`。
- 变体在临时目录里物化并自带依赖安装，构建全程不写 `upstream/`：官方树保持逐字节不变，桌面构建工作流不受影响，失败路径也没有东西需要还原。
- 移动补丁集目录 `scripts/plus/hooks-mobile/` 与放置约定（命名、路径归属、抽取流程）成文。
- 基线验证 `pnpm run verify:web:baseline`：空移动集时，移动变体 dist 与官方原版 dist 逐字节一致。
- 补丁集分离门禁 `pnpm run verify:patch-sets`：两个集合归属的路径不相交，且都能在官方树上干净重放（CI 门禁）。

### 移动端 Android 壳

- Android 生产壳（Kotlin）：壳内自带 upstream web 产物，在真实 https origin 本地加载；文档相对请求（api / plugins / assets）经壳转发到桌面主机 lane，凭证只在壳内、页面拿不到。
- 注入行从 lane 拉取并 document-start 注入（模块加载 facade、启动图、插件 combo、其余主机注入），页面完整启动。
- 壳桥 `dshMobile`：hosts / current / switchHost（切主机＝壳改代理目标 + 重载页面）。
- 壳内 WebSocket 中继：页面的 WS 经本机回环端口转给 lane 并在握手时附上会话 cookie（Android WebView 没有注入 cookie 的钩子）。
- targetSdk 锁 36（规避 Android 17 局域网强制门禁）；回前台自动重载重连。
- 主机凭证进平台加密存储（Keystore + EncryptedSharedPreferences）：主机条目含 origin、形态、地址候选、deviceId、会话 cookie、显示名；cookie 不常驻系统 CookieManager，出站时由壳解密附加。
- 原生管理页（原型定稿变体 A）：当前主机大卡（状态点 / 名字 / origin / 形态徽标 / 延迟）+ 主机卡片列表 + 偏好分组（更新提醒、生物锁）+ 右下 FAB 进配对；视觉 token 全量对齐 dsh，全程禁 emoji。
- 配对四态：扫描二维码 / 粘贴配对链接 → 验证中 → 成功（设备 ID 与会话 cookie 入加密存储）/ 失败（文案区分链接过期与设备被移除）；无任何令牌手输环节。
- 失效降级链：门禁 unpaired → 有 deviceId 静默续期 → 首次接受 → 全败标记「需重新配对」并给出原因文案。
- 生物锁：冷启动、后台超 1 分钟回前台、配对与删主机等敏感操作三触发；默认开可关，生物识别不可用时回退设备 PIN / 凭据。
- 局域网发现：管理页扫 `_dsh-lane._tcp` 列出附近的桌面（名称 + 候选地址）；发现不带授权，选中后引导扫码 / 粘贴桌面签发的一次性配对链接。
- 更新提醒（Android 形态）：启动 / 回前台拉移动端 channel 元数据 → 与本机版本比对 → 提醒条「下载安装」（带进度）→ 下载 apk（sha512 校验）→ FileProvider 拉起系统安装器；提醒语义（开关 / 拉黑版本 / 已提醒最高版本）复用桌面 update-notice 契约；没网时静默降级。
- 移动端安装版本号（versionCode）由 plus 版本确定性推导，构建期与运行时两侧同一套公式（跨实现测试向量对拍）。
- 假 lane（`tools/mock-lane.py`）请求处理修复：原先覆写 `handle_one_request` 时直接读 `self.headers`，每请求抛 AttributeError；改为自解析请求头 + keep-alive 每轮读新请求行。配套 `tools/selftest.py` 起假 lane 并断言请求面。

### 移动端 iOS 壳

- iOS 原生薄壳（Swift）：WKWebView 以自定义 scheme（等价特权 origin）加载壳内自带的移动变体产物；文档相对请求经壳转发到桌面主机 lane，凭证只在壳内。
- 原生请求桥：页面 `transport.fetch` → WKScriptMessageHandler → URLSession 原生请求（一元 RPC 的 POST body 拿不到拦截器转发）。
- 壳内 WebSocket 中继：页面的 WS 经本机回环临时端口转给 lane 并在握手时附上会话 cookie；中继端点从 lane 的回环改写里摘出。
- 壳桥 `dshMobile`（hosts / current / switchHost）与 `__DSH_TRANSPORT__`（ownsHost / streamBaseUrl）。
- 主机凭证进 Keychain（页面 JS 不可达），出站时由壳解密附加；失效降级链（unpaired → 静默续期 → 接受 → 需重配）全路径走通。
- 原生管理页 + 配对四态（扫码 / 粘贴链接）+ App 级生物锁（Face ID，回退设备 PIN）+ mDNS 发现 + 更新提醒只跳转；视觉 token 对齐 dsh，全程禁 emoji。
- 壳内原生浮层主机切换器（右下角标 → 底部抽屉 → 主机行列表 → 选中切换）：叠在 WKWebView 之上，切换走壳既有注册表与重载机制，不再依赖页面注入 UI。
- 出站用 `.local` 候选：Info.plist 一条本地网络豁免 + 一条本地网络用途说明，不逐条列 IP。
- 分发：ipa 直发 GitHub Releases，用户自行侧载（个人证书 7 天有效）。

### 移动端鸿蒙壳

- 鸿蒙生产壳（ArkTS）：壳内自带移动变体 web 产物，在**壳内回环 HTTP 服务**（`http://127.0.0.1:<临时端口>`）上本地加载；文档相对请求（api / plugins / assets）经壳转发到桌面主机 lane，凭证只在壳内、页面拿不到。
- 注入行从 lane 拉取并内联进页面 `<head>`（模块加载 facade、启动图、插件 combo、其余主机注入）+ 就绪信号，页面完整启动。
- 一元 RPC 走**壳内原生请求桥**（ArkWeb 拿不到 POST body）：页面侧 `__DSH_TRANSPORT__.fetch` → `window.__dshShell.request` → 壳的 HTTP 客户端（带凭证）→ lane。
- 壳内 WebSocket 中继：页面与中继同源（回环），中继把握手转给 lane 并在握手时附上会话 cookie，随后按字节转发；中继端点从 lane 的回环改写里摘出（两道保险）。
- 凭证入**鸿蒙资产存储**（HUKS 加密），展示元数据在 preferences；页面 JS 不可达。降级链：门禁 unpaired → 静默续期 → 首次接受 → 全败标记「需重新配对」。
- 五面 UI 对齐原型定稿：管理页（变体 A）、配对四态（扫码 / 粘贴 / mDNS 发现）、浮层切换器（变体 A）、生物锁（userAuth，PIN 回退）、更新提醒（仅跳转形态）；视觉 token 全量对齐 dsh，全程禁 emoji。
- 明文放行显式声明（`network_config.json`）+ ArkWeb 组件配置；mDNS 发现（`_dsh-lane._tcp`）；SHA-1 / Base64 自足实现并与 Node 逐字节核对。

### 移动端页面内浮层切换器

- 页面内浮层切换器（原型定稿变体 A）：右下角标（当前主机首字母）→ 底部抽屉（状态点 / 名字 / 形态徽标 / 候选地址 +「当前」标记）→ 选中后壳切代理目标并重载页面，切换过程遮罩 + 完成 toast。
- 切换器由移动补丁集注入页面（`scripts/plus/hooks-mobile/`）：只在壳桥存在时激活，桌面构建与官方变体里没有这段代码。
- 壳桥 `dshMobile` 的主机载荷补齐形态 / 展示地址 / 地址候选 / 状态，供页面渲染主机行（凭证仍不出壳）。
- 安卓壳默认同步移动变体产物 `dist/web-mobile/`；CI 新增「移动变体」job（构建变体 + 基线验证）。

### 移动端发版

- 移动端 channel 元数据生成：给定 plus 版本与平台产物清单，按平台各生成一份与桌面 channel yml 同形的更新元数据（纯函数、不联网）。
- 移动端安装版本号（Android versionCode / iOS CFBundleVersion）确定性推导公式：从 plus 版本单调可推导，补单元测试锁定。
- 移动端发版管线（`.github/workflows/release-mobile.yml`）：同一个 `v*.plus.*` tag 与桌面发版并行触发，产出 Android 签名 apk + iOS 未签名 ipa + 两份移动端 channel 元数据，一并传到同一个 Release。
- Android 发版签名固定：仓库内一把专用 upload keystore（CI secrets 优先），保证新版能覆盖安装旧版；风险与更换流程见 `mobile/android/keystore/README.md`。
- iOS 归档直接产出未签名 ipa（Payload 布局），侧载工具重签即可安装。
- 移动端发版元数据 CLI（`scripts/plus/release/`）与发布后校验：按壳的取法把元数据与产物拉回来比对 sha512 与大小。

### 移动端 code-review 修复

- iOS 壳版本号规则对齐事实源：含 `+` 的版本串不再静默剥掉而是拒绝，数字段拒绝前导零，字段上限与 Kotlin 同款；新增 `tools/version-check.sh` 对拍脚本（跑壳的真实源码，读共享测试向量）。
- 鸿蒙更新提醒接线：启动与回前台检查，更新源换成同一条版本线的移动端 channel 元数据（不走 api.github.com），版本比较改用与 Android 同规则的 SemVer；提醒卡片（标题 / 正文 / 前往下载页 / 不再提示此版本）接通，开关与拉黑版本、已提醒最高版本从偏好读出生效。
- 发现与拉黑交互补全：iOS 发现列表行可点选并引导扫码或粘贴该桌面的配对链接，鸿蒙发现行点击从 toast 升级为带地址的引导，iOS 更新卡片补「不再提示此版本」。
- 配对链接候选保留：Android 与鸿蒙的 http/https 形态链接解析 `base` 候选列表（逗号分隔）并入主机条目候选，与 iOS 对齐。
- 新增共享测试向量 `scripts/plus/test/mobile-version.vectors.json` 与 `pair-link.vectors.json`：node / Kotlin / Swift / ArkTS 四端跑同一份。
### 远程访问（lane）

- host 半区源码化：手写 ESM（`lib/*.mjs`）迁为 TypeScript（`src/host/*.ts`）；`lib/` 从此只是 tsc 构建产物，不再入库。
- 包脚本对齐桌面壳：`build` = tsc 直出 `lib/`，`test` = vitest；`main` 与 `exports` 指向构建产物。

### 移动端 code-review 修复（第二轮）

- 更新提醒总开关默认开：iOS 与鸿蒙壳的 `ShellPreferences` 默认值改为开（对齐桌面 update-notice 契约与 Android 壳）；只改默认值，已存过的用户值原样保留。
- 配对前无凭证可达性预检：三壳在 accept 之前先对目标做一次**不带任何凭证**的 TCP 连接；不通的候选直接剔除（不发送 accept、不发送一次性令牌），全都不通时报「目标不可达，请检查地址或网络」。Android / iOS / 鸿蒙同一套语义。
- 鸿蒙配对流程拆出纯逻辑层 `shell/pair/PairFlow.ets` 与 `shell/pair/PairOutcome.ets`（不碰平台 API），跨实现对拍脚本因此能直接跑「不可达 → 不发 accept」用例。

- mDNS 服务广播：lane 启动即广播 `_dsh-lane._tcp` 服务记录、关闭即停（广播内容不含任何授权令牌）。
- 配对链接地址候选新增 `<主机名>.local`，与多网卡局域网 IP 并存；无候选时回退行为不变。
- 文档勘误：lane 设备会话实际已持久化（`$DSH_HOME` 下 0600 文件，重启恢复）。

- upstream 恢复为官方基线的逐字节副本，plus 改动全部收进桌面补丁集；构建时应用补丁，桌面产物零回归。
## 已发布

### 0.2.2-alpha.2.plus.1

DSH Desktop Plus 首个公开版本：把 DeepSeek Harness Web GUI 封装成三平台桌面应用，并在官方能力之上补齐桌面集成。

### 桌面应用

- 三平台安装包（macOS / Windows / Linux），基于官方 Electron 壳与 DSH v0.2.2-alpha.2 内核。
- 托盘常驻：一级菜单即 Profile 管理，每个 profile 支持显示/聚焦、整树重启（splash 过渡）、退出与删除；另有应用级重启与退出。
- 多 Profile：同一安装开多个隔离 profile（独立数据目录），新建/删除/启动/重启/退出齐备，退出前记住、下次启动恢复。
- 冷启动编排：托盘 → splash → 宿主 → 窗口顺序可见，启动失败停在 splash 显示原因。
- 退出四梯度：确认退出、跳过确认退出、收整宿主后无条件退出、计划性重启；desktop profile 退出为真退出语义（停进程树 + 销毁窗口），托盘状态即时同步。
- 单实例运行，支持开隔离副本（多实例并存）。
- 登录自启可选；打包态开发者工具独立窗口开关。

### 通知与专注

- 任务完成、等待审批、会话错误、下载完成的系统通知，按场景开关。
- 免打扰时段与全屏静默；窗口聚焦时不重复打扰。
- 防休眠：有活动任务时阻止系统睡眠，结束自动释放。
- 自定义提示音（wav/mp3/ogg，格式与大小校验）或系统默认音，三平台真实发声，设置页可试听。

### 下载管理

- 浏览器下载拦截进统一队列：进度/速度实时可见，暂停/继续/取消真实生效，历史跨重启持久化，完成后可直达文件或所在目录。

### 日志与诊断

- 模块化日志内核：多源写入、级别过滤、按天与按大小轮转、gzip 归档、保留清理。
- 一键导出诊断 tar.gz；「打开日志目录」直达文件管理器。
- profile 输出带名称前缀进统一日志；页面告警与渲染崩溃同落入册。

### 设置面板

- 两栏设置面板：Profile（新建/删除/端口）、通知、代理、防休眠、登录自启、开发者工具、隐私与遥测一键关闭。

### 远程访问

- 远程 profile 直连远端 origin，远程地址即 profile，支持远程重启代理。
- lane 稳定端口按 profile 固定，跨重启不变。

### 实验能力

- Computer Use（macOS）：官方实验组件默认列出，可在插件页直接启用，原生 helper 随包分发。
- NodeJS 诊断、会话数据诊断等官方实验组件可选启用。

### 品牌与本地化

- 侧边栏品牌显示 DSH Desktop Plus 与 plus 构建版本徽标。
- 安装器与应用内 8 语文案，托盘语言跟随系统。

### 版本与更新

- 应用版本 0.2.2-alpha.2.plus.1（官方版本 + .plus.N），写入安装包、Info.plist 与关于页。
- 更新检测指向本仓库 GitHub Releases，支持 latest 与 nightly 渠道。

---

## 面向维护者

- 上游 vendored 目录 + 补丁重放机制：`upstream/` 保持官方树逐字节一致（tree id 校验），plus 改动只以补丁形式存在，构建时应用；`sync:upstream` 三路合并跟进官方。
- CI：上游官方树校验、官方与 plus 双 typecheck、plus 单测门禁、asar 依赖闭包门禁、三平台打包流水线。
- 发版：tag 触发三平台发布流水线，版本号由脚本推导并校验。

---

本文件记录 dsh-desktop-plus 的变更。后续版本按发布归档于此。
