# mobile/harmony — DSH Desktop Plus 移动端 · 鸿蒙壳

> 实施票：[#65 鸿蒙壳（T10）](https://github.com/hyperion2144/dsh-desktop-plus/issues/65)
> 规格：[#55 spec: DSH Desktop Plus 移动客户端（三平台壳 + lane 增强 + 补丁纪律）](https://github.com/hyperion2144/dsh-desktop-plus/issues/55)
> 蓝图：Android 壳 `mobile/android/`（同构实现）；UI 原型 `prototype/ui-mock/index.html`（wayfinder #54 定稿）

## 这个壳是什么

一个**鸿蒙原生薄壳**（ArkTS 手写，不引入 Capacitor）：页面是壳内自带的移动变体 web 产物（本地加载），数据面全部走当前桌面主机的 lane。

```
┌─ 鸿蒙壳 ────────────────────────────────────────────────────────┐
│  页面 origin: http://127.0.0.1:<临时端口>（壳内回环 HTTP 服务）    │
│    ├─ 文档      rawfile/dist（移动变体 web 产物，构建产物）          │
│    ├─ 引导      内联进 <head>：facade / __DSH_BOOT__ / bootstrap  │
│    │            combo / 其余主机注入 + 就绪信号                     │
│    ├─ 传输      __DSH_TRANSPORT__：streamBaseUrl =                         │
│    │            ws://<lane>/__dsh_ws/<令牌>/（页面直连 lane，壳不参与）  │
│    │            fetch → 同源壳回环服务 → 转发 lane（带 cookie）         │
│    └─ 壳桥      window.dshMobile：hosts / current / switchHost     │
│  数据面转发：/api/ /plugins/ /assets/ → 当前主机 lane（带凭证）      │
└──────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
mobile/harmony/
├── AppScope/                       应用级配置（app.json5、图标、名称）
├── entry/
│   ├── src/main/
│   │   ├── module.json5            模块配置（权限、页面、能力）
│   │   ├── ets/
│   │   │   ├── entryability/       EntryAbility（装配 + 装载主页面）
│   │   │   ├── pages/              Index / Management / Pairing / Lock
│   │   │   └── shell/              壳的分层实现
│   │   │       ├── ShellSettings   契约常量（origin / 路径前缀 / 桥名）
│   │   │       ├── ShellApp        装配点（进程级单例）
│   │   │       ├── store/          资产存储（凭证）+ preferences（元数据）
│   │   │       ├── theme/          外观（跟随系统 / 浅色 / 深色）+ 应用级色彩模式
│   │   │       ├── host/           主机模型与仓库
│   │   │       ├── pair/           配对链接解析、lane 控制面客户端、配对编排
│   │   │       ├── connect/        连接器（候选地址重试 + 降级链）+ 延迟探测
│   │   │       ├── boot/           引导载荷（注入行解析 + 传输配置）
│   │   │       ├── net/            壳侧 HTTP 客户端（到 lane）
│   │   │       ├── page/           壳内回环 HTTP 服务 + 资产源 + 请求解析
│   │   │       ├── bridge/         dshMobile 壳桥 + 原生请求桥
│   │   │       ├── lock/           生物锁状态机 + userAuth 门
│   │   │       ├── discover/       mDNS 发现
│   │   │       ├── update/         更新提醒（仅跳转形态）+ 版本号规则 + channel yml 解析
│   │   │       ├── ui/             视觉词汇（状态点 / 形态徽标）
│   │   │       └── util/           字节 / JSON / SHA-1 / Base64
│   │   └── resources/
│   │       ├── base/profile/       main_pages.json、network_config.json
│   │       ├── base/element/       color.json（dsh token）、string.json（中文文案）
│   │       ├── dark/element/       color.json（深色模式下的语义色覆盖）
│   │       └── rawfile/            shell/boot.js（引导脚本）、dist/（构建产物）
└── tools/
    ├── sync-web-dist.sh            同步移动变体 dist（构建产物，不入库）
    ├── mock-lane.py                本地假 lane（无桌面主机时自测）
    ├── make-icon.py                生成应用图标（可复现）
    └── parity-check.mjs            跨实现对拍（跑壳的真实 ArkTS 源码，读共享测试向量）
```

## 工具链与构建

本机已验证的组合：

| 组件 | 版本 / 位置 |
|---|---|
| DevEco Studio | `/Applications/DevEco-Studio.app`（HarmonyOS SDK 26.0.0 / API 26） |
| hvigor | 6.26.1（`Contents/tools/hvigor/bin/hvigorw`） |
| Node（hvigor 用） | `Contents/tools/node` |
| SDK | `Contents/sdk/default`（`openharmony` + `hms`） |
| hdc | `Contents/sdk/default/openharmony/toolchains/hdc`（3.2.0e） |

```sh
cd mobile/harmony

# 1) 同步壳内的移动变体产物（构建产物，不入库）
./tools/sync-web-dist.sh                 # 默认取仓库根的 dist/web-mobile
#    产物来源：仓库根执行 pnpm run build:web:mobile

# 2) 构建（命令行）
export NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node
export DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk
export PATH="$NODE_HOME/bin:$PATH"
/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
  --mode module -p product=default -p module=entry@default -p buildMode=debug \
  assembleHap --no-daemon
```

产物：`entry/build/default/outputs/default/entry-default-unsigned.hap`。

**用 DevEco Studio 打开**（用户自建直装真机的路径）：`File → Open` 选 `mobile/harmony`，
等同步完 `oh-package.json5` 后点 **Run**，DevEco 会用本机 SDK 构建并装到设备。
签名在 DevEco 的 `Project Structure → Signing Configs` 里配（用户自己的证书）。

## 运行

正式路径是**配对**：桌面端「远程访问」面板签发一次性配对链接（10 分钟有效），手机上两个入口：

- 扫描二维码（ScanKit `scanBarcode.startScanForResult`）；
- 粘贴配对链接。

链接形态：`http://<主机>:<lane 端口>/pair?token=…`（桌面端二维码）或
`dsh-mobile://pair?token=…&base=候选1,候选2`（地址候选多时）。
**没有任何令牌手输入口。**

配对成功后，设备 ID 与会话 cookie 进**鸿蒙资产存储**（HUKS 加密），页面永远拿不到。

**accept 之前先探测**：壳对链接里的地址先做一次**不带任何凭证**的 TCP 连接；
连不上的候选直接跳过（一次性令牌不发给不可达目标），全都不通时报「目标不可达，请检查地址或网络」。

没有桌面主机时可先跑本地假 lane 自测：

```sh
python3 mobile/harmony/tools/mock-lane.py 8091
# 然后在配对页粘贴：http://127.0.0.1:8091/pair?token=mock
```

## 五面 UI（对齐原型定稿）

| 面 | 位置 | 说明 |
|---|---|---|
| ① 管理页 | `pages/Management.ets` | 变体 A：当前主机大卡 + 主机卡片列表 + 偏好分组（更新提醒总开关**默认开**、生物锁、**外观**：跟随系统 / 浅色 / 深色）+ 右下 FAB 进配对；长按主机移除（先过生物锁） |
| ② 配对流程 | `pages/Pairing.ets` | 四态：入口（扫码 / 粘贴 / mDNS 发现列表）→ 验证中 → 成功 / 失败（文案区分链接过期与设备被移除） |
| ③ 浮层切换器 | `pages/Index.ets` 内 | 变体 A：右下**胶囊按钮**（⇄ 切换；高 46 / 圆角 23 / 品牌蓝底白字）→ 底部抽屉；切换 = 壳改代理目标 + 页面重载 |
| ④ 生物锁 | `pages/Lock.ets` | 冷启动 / 后台超 1 分钟回前台 / 敏感操作三触发；userAuth（面容 / 指纹 / PIN） |
| ⑤ 更新提醒 | `shell/update/UpdateNoticeService.ets` | **仅跳转形态**：鸿蒙没有系统安装器，提醒只给版本号与「前往下载页」（应用市场测试渠道） |

主界面（`pages/Index.ets`）= 顶栏（状态 + 主机入口）+ ArkWeb 页面 + 浮层切换器。

视觉 token 分浅深两套：`resources/base/element/color.json` 是**浅色**（默认，取 upstream dsh light body），
`resources/dark/element/color.json` 是**深色**（系统深色模式下自动择一）；品牌色与状态色两套共用，全程**禁 emoji**（图标一律文字或 CSS 图形）。

## 外观（深浅色）

- **浅色是默认**：`resources/base/element/color.json` 放浅色语义色（bg / label / border 九个），
  `resources/dark/element/color.json` 只放会变的这九个（系统深色模式下资源合并自动择一）；
  品牌色、状态色、`dsh_chip`、启动窗底色等静态色两套共用。
- **手动可切**：偏好键 `pref.appearance`（`system` / `light` / `dark`，与 iOS 壳同键）。
  启动时 `ShellApp.initialize` 读偏好并 `setColorMode`（早于页面装载，冷启动不闪错主题）；
  管理页「偏好 → 外观」行三选一，选中即落盘 + 立即生效。
- `setColorMode` 是 API 18 接口，本工程 `compatibleSdkVersion` 为 5.0.0(12)，
  编译器只报一条 API 版本警告（不改兼容级别）。

## 平台约束与对策

三处鸿蒙侧的硬约束（票 #65 照 Android 实测结论逐条设计）：

1. **ArkWeb 的请求拦截拿不到 POST body**，而 dsh 的一元 RPC 是 `POST` + JSON body。
   → 一元 RPC 走**壳内原生请求桥**：页面侧 `__DSH_TRANSPORT__.fetch` → `window.__dshShell.request(...)`
   → 壳的 HTTP 客户端（带凭证）→ lane。桥注册成 ArkWeb JavaScriptProxy 的**异步**方法，
   页面侧拿到 Promise（同步方法会堵住 ArkWeb 的 JS 线程）。
2. **lane 的会话 cookie 是 `SameSite=Lax`**，页面 origin（壳回环）到 lane 是**跳站**，
   WS 握手不会带 cookie；改 `SameSite=None` 又必须 `Secure`（lane 是明文），且 ArkWeb 没有
   逐请求改写 WS 握手头的钩子。
   → 凭证改走路径：壳用 cookie 向 lane 换一枚**直连令牌**
   （`POST /__dsh-mobile/api/pair/ws-token`），把 `socketBaseUrl` 写成
   `ws(s)://<lane>/__dsh_ws/<令牌>/`，页面自行直连 lane；lane 验签后还原会话值。
3. **lane 的「回环改写」补丁**会把 `ws://127.0.0.1:<port>` 改写成 `<origin>/_loopback/<port>/…`，
   那套改写是为「页面由 lane 伺服」准备的，在壳里会**劫持直连 lane 的 WS 地址**。
   → 引导脚本在注入行生效后把直连 base 从改写里摘出来（`protectRelaySocket`，
   见 `rawfile/shell/boot.js`）；壳的回环服务另外把指向自己端口的 `/_loopback/<本机端口>/`
   前缀摘掉，两道保险。

另有两处鸿蒙侧的结构性选择：

- **壳内自带一个回环 HTTP 服务**，而不是用 ArkWeb 的请求拦截：
  拦截不拦主框架（主文档拿不到）、拿不到请求体、响应体必须完整备好（**流式响应无法透传**）。
  自带服务把三件事一次解决。它只负责页面与 HTTP（同源转发，带 cookie）；WS 不在它手里。
  路由：`/__dsh-mobile-shell/boot.json`（引导载荷）、`/api/` `/plugins/` `/assets/` `/__dsh-mobile/`
  `/_loopback/`（转发到 lane）、其余（壳内 dist）。
- **明文放行显式声明**：`entry/src/main/resources/base/profile/network_config.json`
  （`cleartextTrafficPermitted: true`，仅信任系统 CA）+ ArkWeb 组件配置
  （`javaScriptAccess` / `domStorageAccess` / `databaseAccess` / `fileAccess` / `mixedMode`）。

## 验收清单

已在本机完成的：

- [x] hvigor 构建通过（`assembleHap` 产出 unsigned HAP）
- [x] 五面 UI 全部实现（管理页 / 配对四态 / 浮层切换器 / 生物锁 / 更新提醒）
- [x] `network_config.json` 显式明文放行 + ArkWeb 组件配置声明
- [x] 凭证入鸿蒙资产存储，页面 JS 不可达；降级链全路径（renew → accept → 标记需重配）实现
- [x] `__DSH_TRANSPORT__`（ownsHost / streamBaseUrl）+ `dshMobile` 壳桥（hosts / current / switchHost）
- [x] 壳内 WebSocket 中继（含 lane 回环改写摘除）
- [x] mDNS 发现（`_dsh-lane._tcp`）+ 隧道地址条目与探测
- [x] 无 emoji；dsh token 对齐（每个色值注明出处）
- [x] SHA-1 与 Base64 实现与 Node `crypto` / `Buffer` 逐字节核对一致
- [x] 本地假 lane 自测脚本（`tools/mock-lane.py`）可跑通 HTTP 与配对端点

**模拟器已验证**（2026-11-01，DevEco 模拟器 + 运行中的桌面 lane）：

- [x] 新包名 `io.github.hyperion2144.dsh.plusm` 全链路：hvigor 构建 → 自动签名安装 → 启动 → 桌面图标与名称
- [x] 配对四态完整走通（入口 / 验证中 / 成功 / 失败文案区分），对运行中桌面 `POST /__dsh-mobile/api/pair/mint` 签发的一次性链接完成真配对
- [x] 管理页五面 UI：当前主机大卡（lan 徽标 / 已连接 / 设备已配对）、主机列表「当前」标记、偏好开关、右下 FAB；卡片边距 48
- [x] 主页连接状态「已连接：<主机名>」+ 壳内原生浮层切换器（角标 / 底部抽屉 / 主机行）
- [x] 页面装载到真 DSH 启动画面（HARNESS / Loading plugins...，注入行 19 条来自 lane）
- [x] 壳内自带 dist 资产本地优先（`/assets/` 未命中才转发主机），版本错位不再 404 白屏

**待真机验证**（本票未完成，需要 DevEco 自建直装真机）：

- [ ] 页面在真实设备上完整启动（模块加载 / 路由 / 渲染）
- [ ] 外观三选一（跟随系统 / 浅色 / 深色）在真机上的即时切换与冷启动保持
- [ ] 连真机桌面：对话 + 流式输出正常；回前台自动重连（ArkWeb 渲染进程回收场景）
- [ ] 扫码入口在真机上取到桌面二维码（ScanKit 需要 HMS 侧签名与扫码服务）
- [ ] mDNS 发现在真机局域网里列出桌面
- [ ] 隧道地址条目连通（公网 https lane 的 WS 走 TLS 中继）
- [ ] 生物锁在真机上的面容 / 指纹与 PIN 回退
- [ ] 更新提醒的跳转形态（应用市场测试渠道）
- [ ] DevEco Studio 自建直装真机验证通过

## 已知限制

- **更新提醒只给跳转**：鸿蒙没有系统安装器可拉起，真正的分发要走应用市场测试渠道
  （本壳不随发版，用户用 DevEco 自建直装）。版本信号取自同一条版本线的移动端 channel
  元数据（`nightly-android.yml`），不走 api.github.com 的额度池。
- **事件流的响应状态码是 200**：壳的流式转发用 `requestInStream`，其状态码在流结束时才到，
  所以响应头先按 200 发出。SSE 场景下 lane 恒返回 200，不影响使用。
- **应用内安装不存在**：与 iOS 壳同款，只有跳转形态。
- **扫码依赖 ScanKit**：设备没装扫码服务（或 HMS 签名缺失）时降级到「粘贴配对链接」，
  壳会明确提示而不是静默失败。
- **shell/util 的 SHA-1 与 Base64 是自足实现**：平台 `cryptoFramework` / `util.Base64Helper`
  在 ArkTS 的类型系统里是 `any`，无法在强类型代码里安全使用；两处实现都与 Node 逐字节核对过。
