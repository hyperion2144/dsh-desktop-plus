# mobile/ios — DSH Desktop Plus 移动端 · iOS 壳

> 实施票：[#64 iOS 壳（T9）](https://github.com/hyperion2144/dsh-desktop-plus/issues/64)
> 规格：[#55 spec: DSH Desktop Plus 移动客户端（三平台壳 + lane 增强 + 补丁纪律）](https://github.com/hyperion2144/dsh-desktop-plus/issues/55)
> 决策依据：票面「Android 实测平台差异」三条、wayfinder 地图 #44、`docs/agents/research/` 三份研究笔记、原型票 #50。

## 这个壳是什么

一个**原生薄壳**：页面是壳内自带的 upstream web 产物（本地加载），数据面全部走当前桌面主机的 lane。
功能面与 Android 壳同构（管理页 / 配对四态 / 生物锁 / 更新跳转），机制按 iOS 平台的硬约束重做。

```
┌─ iOS 壳 ─────────────────────────────────────────────────────────┐
│  页面 origin: dsh-shell://app.dsh.local（自定义 scheme，壳自己当源站）│
│    ├─ 文档      Resources/dist（移动变体产物，构建产物，不入库）      │
│    ├─ 引导      document-start 注入：facade / __DSH_BOOT__ /         │
│    │            bootstrap combo / 其余主机注入 + 就绪信号             │
│    ├─ 传输      __DSH_TRANSPORT__：streamBaseUrl（直连 lane）/        │
│    │            createWebSocket → 页面直连 lane（URL 带令牌）/        │
│    │            ownsHost: true / fetch → 原生请求桥                  │
│    └─ 壳桥      window.dshMobile：hosts / current / switchHost      │
│  数据面转发：/api/ /plugins/ /assets/ /__dsh-mobile/ /_loopback/    │
│              → 当前主机 lane（带凭证）                                │
│  页面直连 lane：ws://<lane>/__dsh_ws/<令牌>/<原路径>（令牌在 URL 里） │
└────────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
mobile/ios/
├── DshMobile/
│   ├── Resources/
│   │   ├── Info.plist              ← 本地网络豁免 / 用途说明 / 相机 / Face ID
│   │   ├── shell/boot.js           ← 壳内引导脚本（document-start 注入）
│   │   ├── dist/                   ← 移动变体产物（构建产物，不入库）
│   │   └── Assets.xcassets/
│   ├── Sources/
│   │   ├── App/                    ← 装配点（AppEnvironment）+ 状态机（ShellController）
│   │   ├── UI/                     ← 管理页 / 配对四态 / 生物锁屏 / 扫码 / 浮层主机切换器 / 页面容器 + 视觉词汇
│   │   └── Shell/
│   │       ├── ShellSettings.swift ← 契约常量（origin / 路径前缀 / 端点 / lane WS 前缀）
│   │       ├── store/              ← Keychain 承载的键值存储 + 主机记录编解码
│   │       ├── host/               ← 主机模型（形态 / 状态）与主机仓库
│   │       ├── pair/               ← 配对链接解析、lane 控制面客户端、配对编排
│   │       ├── connect/            ← 连接器（候选地址重试 + 失效降级链）+ 延迟探测
│   │       ├── lock/               ← 生物锁状态机 + LAContext 封装（PIN 回退）
│   │       ├── boot/               ← 引导载荷（解析 lane 页面 → 注入行 → 载荷）
│   │       ├── net/                ← 壳侧 HTTP 客户端（发请求 + 流式通道）
│   │       ├── page/               ← 资产处理器 / 请求转发器 / scheme 路由
│   │       ├── bridge/             ← dshMobile 壳桥 + 原生请求桥
│   │       ├── discover/           ← mDNS 发现（NWBrowser）
│   │       └── update/             ← 更新提醒（跳转形态）+ 版本号解析（与 node/Kotlin 同规则）
├── DshMobile.xcodeproj/            ← xcodegen 产物（工程入库，生成器在 project.yml）
├── project.yml                     ← 工程描述（xcodegen）
└── tools/
    ├── sync-web-dist.sh            ← 同步移动变体产物到壳内
    ├── build-ios.sh                ← 同步产物 → 推导版本号 → xcodebuild
    ├── mock-lane.py                ← 本地假 lane（无桌面主机时自测）
    ├── selftest.sh                 ← 数据面自检（编译壳的真实源码跑数据面）
    ├── selftest/main.swift         ← 自检用例
    ├── version-check.sh            ← 版本号跨实现对拍（跑壳的真实 ShellVersion 源码）
    └── version-check/main.swift    ← 对拍用例（读共享测试向量）
```

## 构建

工具链（本机已验证的组合）：

| 组件 | 版本 |
|---|---|
| Xcode | 27.2（build 27B52） |
| iOS SDK | 27.2（部署目标 iOS 17.0） |
| xcodegen | 2.46.0（工程文件由它生成；未安装时用仓库里已生成的工程） |
| Swift | 5 语言模式（`SWIFT_STRICT_CONCURRENCY=minimal`） |

```sh
cd mobile/ios

# 1) 同步壳内的移动变体产物（构建产物，不入库）
./tools/sync-web-dist.sh                  # 默认取 ../../dist/web-mobile
./tools/sync-web-dist.sh <dist 目录>      # 显式指定

# 2) 构建（模拟器 / 归档出 ipa）
./tools/build-ios.sh                                     # 模拟器
./tools/build-ios.sh 'platform=iOS Simulator,name=iPhone 17 Pro'
./tools/build-ios.sh --archive                           # 出 ipa（侧载用，见下）
```

产物里的移动变体来自仓库根的 `pnpm run build:web:mobile`（官方树 + 移动补丁集），
默认写到 `dist/web-mobile/`；`build-ios.sh` 会自动同步它。

## 运行

正式路径是**配对**：桌面端「远程访问」面板签发一次性配对链接（10 分钟有效），手机上两个入口：

- 扫描二维码（AVFoundation 元数据输出读二维码）；
- 粘贴配对链接。

链接形态：`http://<主机>:<lane 端口>/pair?token=…`（桌面端二维码）或
`dsh-mobile://pair?token=…&base=候选1,候选2`（地址候选多时）。
**没有任何令牌手输入口。**

配对成功后，设备 ID 与会话 cookie 进 Keychain，页面永远拿不到。

**accept 之前先探测**：壳对链接里的地址先做一次**不带任何凭证**的 TCP 连接；
连不上的候选直接跳过（一次性令牌不发给不可达目标），全都不通时报「目标不可达，请检查地址或网络」。

顶栏进**原生管理页**（原型定稿变体 A）：当前主机大卡 + 主机卡片列表 + 偏好分组（更新提醒总开关**默认开**，与桌面契约同款）。
点主机行即切换（壳改代理目标 + 重载页面），移除主机是敏感操作（要过生物锁）。
页面右下角是**壳内原生浮层主机切换器**（原型定稿变体 A）：角标（当前主机名首字母）→ 点击弹底部抽屉 → 主机行列表（状态点 / 名字 / 副行 / 形态徽标 /「当前」）→ 选中即切换。
这一层完全由壳渲染（叠在 WKWebView 之上），不依赖页面里注入的任何 UI；切换 = 壳改代理目标 + 页面重载。
页面内也可以用 `window.dshMobile.switchHost(id)` 触发同样的切换。

## 数据面说明

| 面 | 承载 | 凭证 |
|---|---|---|
| 页面文档 | `WKURLSchemeHandler`（自定义 scheme 当源站） | 无 |
| `/api/`、`/plugins/`、`/assets/`、`/__dsh-mobile/`、`/_loopback/` | 壳转发到当前主机 lane | 壳附加 cookie，页面不可见 |
| 带 body 的 POST（dsh 一元 RPC） | 壳原生请求桥（`webkit.messageHandlers.dshNative`） | 同上 |
| WebSocket（网关 mux 等） | 页面直连 lane：`ws://<lane>/__dsh_ws/<令牌>/<原路径>` | 令牌在 URL 里（壳不中继、不转交 cookie） |

四处平台约束与对应处理（票面「Android 实测平台差异」三条 + iOS 侧一条）：

1. **`WKURLSchemeHandler` 拿不到请求体**（WebKit 不把 body 交给 scheme handler），
   而 dsh 的一元 RPC 是 `POST` + JSON body → 带 body 的请求走**原生请求桥**：
   页面 `transport.fetch` → `WKScriptMessageHandler` → 壳用 URLSession 原生发起（附凭证）→ 回包给页面。
2. **lane 的会话 cookie 是 `SameSite=Lax`**，跨站 WS 握手**不带** cookie → lane 门禁 `401 UNPAIRED`；
   且 iOS 没有「逐请求改写 WS 握手头」的公开钩子 → 壳**换一条凭证通道**：
   先用会话 cookie 向 lane 换一个**签名令牌**（`POST /__dsh-mobile/api/pair/ws-token`），
   再把令牌放进 URL 路径交给页面（`ws://<lane>/__dsh_ws/<令牌>/`），页面自己直连 lane。
   令牌只用于建立数据面连接：lane 验签后还原会话值，不具备 RPC 权限，随会话轮换失效。
3. **lane 的「回环改写」补丁会把 `ws://127.0.0.1:*` 改写成 `/_loopback/*`**——那套改写是为「页面由 lane 伺服」准备的，
   在壳里会劫持直连 lane 的 WS base → 引导脚本在注入行生效后把这个 base **从改写里摘出来**（`protectLaneSocket`）。
4. **iOS 17 起 ATS 不再默认放行裸 IP**（必须逐条列进 `NSExceptionDomains`），
   而 `.local` 主机名在 iOS 10~17 全版本都被 `NSAllowsLocalNetworking` 覆盖
   → 出站地址一律用 `.local` 候选（配对链接里的候选按「`.local` 优先」排序），
   Info.plist 一条本地网络豁免 + 一条本地网络用途说明，**不逐条列 IP**。
5. **回后台页面 WS 必断**（iOS 挂起进程）→ 壳在回前台重载页面，重建连接。

## 验收清单

### 本机已实测（构建 + 数据面自检）

- [x] 编译通过：`xcodebuild build -destination 'generic/platform=iOS Simulator'`（arm64 + x86_64），**零警告**；
      工程文件由 `xcodegen` 生成且与 `project.yml` 一致。
- [x] App bundle 内含移动变体产物（`Resources/dist/`）与壳内引导脚本（`Resources/shell/boot.js`）。
- [x] 引导载荷：注入行解析（facade / `__DSH_BOOT__` / bootstrap）、`ownsHost: true`、
      `streamBaseUrl` 指向直连 lane（`ws://<lane>/__dsh_ws/<令牌>/`，末尾斜杠）、
      `pageOrigin` 为 `dsh-shell://app.dsh.local`。
- [x] 配对门禁：无凭证 → `401 {"error":"unpaired"}` → 判定为「需重新配对」。
- [x] lane 控制面：`accept` 换到设备 ID + 会话 cookie；无效令牌 → `invalid-token`；
      `renew` 取回新 cookie；未知设备 → `unknown-device`（=「此设备已被移除」）；
      `ws-token` 用会话 cookie 换到直连令牌，未配对 → 门禁（401）。
- [x] 降级链全路径：unpaired → 静默续期成功 → 连上；续期与接受都失败 → 标记「需重新配对」并区分原因。
- [x] 数据面直连 lane：WS base 带令牌段与末尾斜杠（`ws://<lane>/__dsh_ws/<令牌>/`），
      壳内的 WebSocket 升级请求一律回 `501`（壳不再中继）。
- [x] 真实 lane（127.0.0.1:3093）：门禁判定为 gated、续期未知设备 → 「此设备已被移除」。
- [x] Keychain：凭证写入后读回、删除后读不到、**跨实例可读**（确实落盘，不是内存兜底）。
- [x] 配对链接解析：移动端形态 / http 形态 / 缺令牌 / 非链接；`.local` 候选排在前面（iOS 出站择优）。
- [x] 视觉 token 与上游逐条对齐（`design-platform.css` dark body + `base.css` 圆角），**无 emoji**。

自检跑法（编译的是壳的真实源码，不是复制品）：

```sh
cd mobile/ios
./tools/selftest.sh            # 假 lane + 本机 3093 的真实 lane（若在跑）
./tools/selftest.sh 8092 0     # 只测假 lane
```

### 待真机验证（本机没有 iOS 模拟器运行时，也没有真机）

> 这台构建机**没有安装任何 iOS 模拟器运行时**
> （`/Library/Developer/CoreSimulator/Profiles/Runtimes` 为空，CoreSimulator 报
> "Simulator device support disabled"），`xcrun simctl list devices` 也会挂住。
> 因此「模拟器安装启动 → 连真实 lane → 看页面/对话/流式」这条路径**在本机跑不起来**，
> 下面的项目如实留作待验证，不伪造：

- [ ] 模拟器安装启动 + 页面完整渲染（模块加载 / 路由 / 对话 / 流式输出）
- [ ] iOS 17 真机 `.local` 出站 + 一条本地网络豁免（`NSAllowsLocalNetworking`）的组合
- [ ] 真机 mDNS 发现（`NWBrowser` + `NSBonjourServices` 的本地网络授权弹窗）
- [ ] 真机生物锁（Face ID）与 PIN 回退（模拟器只有「设备密码已设置」的近似环境）
- [ ] 真机扫码（AVFoundation 取景框 + 真二维码解码）
- [ ] 回前台自动重连（真机挂起进程后回前台）
- [ ] 侧载安装（ipa）+ 7 天重签流程

## 侧载（ipa）

iOS 不支持应用内安装，更新提醒**只跳转**（引导用户用 SideStore 重新导入）。

```sh
cd mobile/ios
./tools/build-ios.sh --archive      # 产出 build/ipa/DshMobile.app 与 build/DshMobile.ipa（未签名）
```

未签名的包不能直接装：需要用你自己的证书（Apple ID 或开发者证书）重签后，
再通过 SideStore / AltStore / TrollStore 等方式侧载。**个人 Apple ID 签名的有效期 7 天**，
过期后需要重新签名并重新导入（更新提醒会引导到下载页；重新导入后凭证仍在 Keychain 里）。
真机侧载的完整流程需要一台真机 + 一个 Apple ID，属待真机验证项。

### 发版（ipa 直发 GitHub Releases）

发版流水线（`.github/workflows/release-mobile.yml`）在 macos runner 上跑同一条命令，
把 `build/DshMobile.ipa`（**未签名**）与 `nightly-ios.yml` 一起传到同一个 tag 的 Release 上。
未签名是**故意的**：侧载工具会用自己的证书重签；流水线里不碰任何签名凭据。

本地复现（与 CI 同一条命令）：

```sh
cd mobile/ios
PLUS_VERSION=0.2.2-alpha.2.plus.2 ./tools/build-ios.sh --archive
```

`PLUS_VERSION` 决定壳内的 `CFBundleVersion`（由 plus 版本确定性推导）。
发版时它来自 tag（`vX.Y.Z.plus.N` → `X.Y.Z.plus.N`），不用本机的版本推断。

## 已知限制（留给后续票）

- 更新提醒读的是移动端 channel 元数据（`nightly-ios.yml`）：该文件要由发版流水线额外产出，
  本票只做「检查 + 跳转」。
- `Sec-WebSocket-Accept` 用 CryptoKit 的 `Insecure.SHA1`（RFC 6455 规定的握手摘要，非安全用途）。
- 壳的 Keychain 条目在 App 被删除后仍会保留（iOS 平台行为）：重新安装时会读回上次的主机条目。
