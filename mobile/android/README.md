# mobile/android — DSH Desktop Plus 移动端 · Android 壳

> 实施票：[#60 Android 生产壳核心：骨架 + 本地页面 + lane 数据面](https://github.com/hyperion2144/dsh-desktop-plus/issues/60)
> 规格：[#55 spec: DSH Desktop Plus 移动客户端（三平台壳 + lane 增强 + 补丁纪律）](https://github.com/hyperion2144/dsh-desktop-plus/issues/55)
> 决策依据：wayfinder 地图 #44、docs/agents/research/ 三份研究笔记、原型票 #50。

## 这个壳是什么

一个**原生薄壳**：页面是壳内自带的 upstream web 产物（本地加载），数据面全部走当前桌面主机的 lane。

```
┌─ Android 壳 ───────────────────────────────────────────────┐
│  页面 origin: https://appassets.androidplatform.net          │
│    ├─ 文档      assets/dist（upstream web 产物，构建产物）     │
│    ├─ 引导      document-start 注入：facade / __DSH_BOOT__ /   │
│    │            bootstrap combo / 其余主机注入 + 就绪信号       │
│    ├─ 传输      __DSH_TRANSPORT__：streamBaseUrl（直连 lane）  │
│    │            createWebSocket → 页面带令牌直连 lane          │
│    └─ 壳桥      window.dshMobile：hosts / current / switchHost │
│  数据面转发：/api/ /plugins/ /assets/ → 当前主机 lane（带凭证）  │
│  WebSocket：页面带签名令牌直连 lane（壳不再中继）                │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
mobile/android/
├── app/src/main/
│   ├── assets/
│   │   ├── dist/                  ← upstream web 产物（构建产物，不入库）
│   │   └── shell/boot.js          ← 壳内引导脚本（document-start 注入）
│   ├── java/com/plus/mobile/android/
│   │   ├── MobileApp.kt           ← 装配点：进程级单例（仓库 / 偏好 / 配对 / 锁）
│   │   ├── MainActivity.kt        ← 主界面：顶栏（状态 + 主机入口）+ WebView
│   │   └── shell/
│   │       ├── ShellSettings.kt   ← 契约常量（origin / 路径前缀 / 端点）
│   │       ├── store/             ← 平台加密存储（Keystore）+ 主机记录编解码
│   │       ├── host/              ← 主机模型（形态 / 状态）与主机仓库
│   │       ├── pair/              ← 配对链接解析、lane 控制面客户端、配对编排
│   │       ├── connect/           ← 连接器（候选地址重试 + 失效降级链）+ 直连 WS base + 延迟探测
│   │       ├── lock/              ← 生物锁状态机 + BiometricPrompt 封装
│   │       ├── boot/              ← 引导载荷（解析 lane 页面 → 注入行 → 载荷）
│   │       ├── net/               ← 壳侧 HTTP 客户端
│   │       ├── page/              ← 资产处理器 / 转发器 / 路由 / document-start
│   │       ├── bridge/            ← dshMobile 壳桥 + 原生请求桥
│   │       ├── discovery/         ← mDNS 发现（NsdManager 扫 _dsh-lane._tcp）
│   │       ├── update/            ← 版本推导 / 更新元数据 / 提醒与下载 / 系统安装器
│   │       └── ui/                ← 原生管理页 / 配对屏 / 生物锁屏 + 视觉词汇
│   └── res/                       ← 中文文案 / dsh 视觉 token / 主题 / 网络安全配置
└── tools/
    ├── sync-web-dist.sh           ← 同步 upstream web 产物
    ├── mock-lane.py               ← 本地假 lane（无桌面主机时自测）
    └── selftest.py                ← 假 lane 自检（起假 lane + 断言请求面）
```

## 构建

工具链（本机已验证的组合）：

| 组件 | 版本 |
|---|---|
| JDK | 17（`~/tools/jdk-17.0.21+9`） |
| Gradle | 8.10.2（`~/tools/gradle-8.10.2`，工程未带 wrapper） |
| Android SDK | platform 36 + build-tools 36.0.0 |
| AGP / Kotlin | 8.7.3 / 2.0.21 |

```sh
cd mobile/android

# 1) 同步壳内的移动变体 web 产物（构建产物，不入库）
./tools/sync-web-dist.sh                        # 默认取仓库根 dist/web-mobile
./tools/sync-web-dist.sh <dist 目录>            # 显式指定

# 2) 构建
JAVA_HOME=~/tools/jdk-17.0.21+9/Contents/Home \
ANDROID_HOME=~/Library/Android/sdk \
~/tools/gradle-8.10.2/bin/gradle assembleDebug
```

产物：`app/build/outputs/apk/debug/app-debug.apk`。

> `assembleDebug` 用的是 AGP 的 debug 签名（**每台机器一把不同的**）：本地调试随便用，
> 但它**不能拿去发版**——下一版换一把签名，用户就盖不上旧版。发版用下面的
> `assembleRelease`。

### 发版构建（签名 apk）

发版流水线（`.github/workflows/release-mobile.yml`）跑的是 `assembleRelease`，签名材料固定：
CI secrets 优先，回退仓库里那把专用 upload keystore。**风险与更换流程见
[keystore/README.md](keystore/README.md)。

```sh
cd mobile/android
./tools/sync-web-dist.sh <移动变体产物目录>     # 壳内页面（发版用移动变体）

JAVA_HOME=~/tools/jdk-17.0.21+9/Contents/Home \
ANDROID_HOME=~/Library/Android/sdk \
~/tools/gradle-8.10.2/bin/gradle assembleRelease -PplusVersion=0.2.2-alpha.2.plus.2
```

产物：`app/build/outputs/apk/release/app-release.apk`（**已签名**）。

想换签名材料（本地试）：

```sh
gradle assembleRelease \
  -PplusKeystorePath=/path/to/upload.keystore \
  -PplusKeystorePassword=<store 口令> \
  -PplusKeyAlias=plus-upload \
  -PplusKeyPassword=<key 口令>
```

同名环境变量也认（CI 用环境变量传 secrets，不进命令行参数）：
`ANDROID_KEYSTORE_PATH` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` /
`ANDROID_KEY_PASSWORD`。

### 版本号与构建期覆盖

`versionName` 跟随桌面 plus 版本（`X.Y.Z[-pre].plus.N`），`versionCode` 由它**确定性推导**
（公式与 node 侧事实源 `scripts/plus/mobile-version.mjs`、运行时端口
`shell/update/MobileVersion.kt` 同一套；三处不一致时单测会红）。

```sh
# 换 plus 版本（安装版本号随之推导）
gradle assembleDebug -PplusVersion=0.2.2-alpha.2.plus.2

# 直接指定安装版本号
gradle assembleDebug -PplusVersionCode=20200202

# 换更新源（本地验证：把 feed 指到本机 http 服务）
gradle assembleDebug -PupdateFeedUrl=http://10.0.2.2:8765/nightly-android.yml
```

## 运行

正式路径是**配对**：桌面端「远程访问」面板签发一次性配对链接（10 分钟有效），手机上两个入口：

- 扫描二维码（zxing-android-embedded，相机权限运行时申请）；
- 粘贴配对链接。

链接形态：`http://<主机>:<lane 端口>/pair?token=…`（桌面端二维码）或
`dsh-mobile://pair?token=…&base=候选1,候选2`（地址候选多时）。
**没有任何令牌手输入口。**

配对成功后，设备 ID 与会话 cookie 进 Keystore 加密存储，页面永远拿不到。

**accept 之前先探测**：壳对链接里的地址先做一次**不带任何凭证**的 TCP 连接；
连不上的候选直接跳过（一次性令牌不发给不可达目标），全都不通时报「目标不可达，请检查地址或网络」。

调试 / 联调时仍可用启动参数直接注入一台主机：

```sh
adb shell am start -n io.github.hyperion2144.dsh.plusm/com.plus.mobile.android.MainActivity \
  --es lane_origin http://<主机>:<lane 端口> \
  --es host_label "桌面主机" \
  --es host_cookie "dsh_mobile_session=<会话 cookie>"
```

- `lane_origin`：桌面 lane 地址（http://192.168.x.x:3093 这类）。
- `host_cookie`：lane 的会话 cookie（**整对** `名字=值`；只存 `值` 会被门禁拒）。**只存在壳内**，页面 JS 拿不到。
- 省略启动参数时，App 用加密存储里已有的主机；一台都没有时顶栏显示「未配置主机」。

### 本地假 lane 联调（没有桌面主机时）

`tools/mock-lane.py` 是安卓壳在**没有桌面主机**时的联调对象：按 lane 契约回页面骨架
（壳从中解析注入行）、回显 `/api/` 与 `/plugins/` 请求、回 WS 帧。
`tools/selftest.py` 起假 lane 并把请求面钉成断言（票 #67）：

```sh
# 1) 假 lane 自检（自带起停，不留后台进程）
python3 mobile/android/tools/selftest.py 8091

# 2) 手动起假 lane，配合壳联调
python3 mobile/android/tools/mock-lane.py 8091

# 3) 壳注入一台指向假 lane 的主机
adb shell am start -n io.github.hyperion2144.dsh.plusm/com.plus.mobile.android.MainActivity \
  --es lane_origin http://10.0.2.2:8091 \
  --es host_label "假 lane" \
  --es host_cookie "dsh_mobile_session=mock-session-token"
```

- 模拟器用 `10.0.2.2` 访问宿主机的回环；真机改成本机局域网 IP。
- 假 lane 不校验会话 cookie（只把 `cookie` 头回显出来），所以 `host_cookie` 随便给也能走通数据面；
  它也会给一个固定的直连令牌（`mock-ws-token`），页面因此能按 `/__dsh_ws/<令牌>/` 直连假 lane。
顶栏右侧「主机」进**原生管理页**（原型定稿变体 A）：当前主机大卡 + 主机卡片列表 + 偏好分组 +
右下 FAB 进配对。点主机行即切换（壳改代理目标 + 重载页面），长按可移除主机（敏感操作，要过生物锁）。
页面内也可以用 `window.dshMobile.switchHost(id)` 触发同样的切换。

页面内还有**浮层切换器**（原型定稿变体 A）：右下角标（当前主机首字母）→ 底部抽屉
（主机列表：状态点 / 名字 / 形态徽标 / 候选地址 +「当前」标记）→ 选中后壳切代理目标并重载页面，
切换过程遮罩 + 完成 toast。它由**移动补丁集**注入页面（`scripts/plus/hooks-mobile/`），
只在壳桥存在时激活，因此桌面构建与官方变体里没有这段代码。


## 局域网发现（mDNS）

管理页的「发现」分组：点「扫描局域网」扫 `_dsh-lane._tcp`（桌面 lane 广播的服务类型，票 #57），
列表里是发现的桌面（名称 + 候选地址）。**发现不带授权**——广播记录里只有「在哪」类事实
（主机名、端口、配对入口路径），mDNS 是明文组播，令牌一律不进广播。

选中一台 → 弹窗引导「去配对」→ 进配对屏（带上这台桌子的地址作提示），
仍需扫码或粘贴桌面端签发的**一次性配对链接**才能完成授权（全程无令牌手输）。

地址以 **NsdManager 解析出的 IP** 为准：Android 对 `.local` 的普通解析不可靠，
广播里的主机名只作展示。

```sh
# 本机广播一条同类型的记录（验证用；真实广播来自桌面 lane）
dns-sd -R "DSH Desktop Plus - mac-mini" _dsh-lane._tcp local 3093 host=mutou-mbp.local path=/pair
```

## 更新提醒（Android 形态）

启动与回前台检查（默认 6 小时一次）：

```
拉移动端 channel 元数据（默认 feed = GitHub Release 上的 nightly-android.yml）
  → 解析（version / files[url,sha512,size] / path / sha512 / releaseDate）
  → 与本机版本比较（SemVer 优先级；安装版本号由 plus 版本确定性推导）
  → 提醒条（Snackbar 形态）：版本号 + 体积 +「下载安装」+「不再提示此版本」
  → 下载 apk（流式 + sha512 校验 + 进度）
  → FileProvider + ACTION_INSTALL_PACKAGE 拉起系统安装器（缺「安装未知来源应用」权限时先引导授权）
```

提醒语义（开关 / 拉黑版本 / 已提醒最高版本）复用桌面 update-notice 契约：

- **开关**：管理页偏好分组里的「更新提醒」，默认开（与桌面契约一致）；
- **拉黑版本**：「不再提示此版本」写入 `shell:<版本>` 键；
- **已提醒最高版本**：提醒过的最高版本记下，同一版本不重复提醒。

没网 / 元数据拉取失败 / 元数据不成形：**静默降级**（只记日志，不弹窗、不阻塞启动）。

本机验证（把 feed 指到本地 http 服务）：

```sh
# 1) 元数据与产物：用 T3 的生成器产出（node scripts/plus/mobile-metadata.mjs）
# 2) 本地伺服：python3 -m http.server 8765 --directory <目录>
# 3) 运行时改 feed（不用重新构建）：
adb shell am start -n io.github.hyperion2144.dsh.plusm/com.plus.mobile.android.MainActivity \
  --es update_feed http://10.0.2.2:8765/nightly-android.yml
```
## 数据面说明

| 面 | 承载 | 凭证 |
|---|---|---|
| 页面文档 | `WebViewAssetLoader`（真实 https origin） | 无 |
| `/api/`、`/plugins/`、`/assets/`、`/_loopback/` | 壳转发到当前主机 lane | 壳附加 cookie，页面不可见 |
| 带 body 的 POST（dsh 一元 RPC） | 壳原生请求桥（`window.__dshShell`） | 同上 |
| WebSocket（网关 mux 等） | 页面带签名令牌直连 lane（`ws(s)://<lane>/__dsh_ws/<令牌>/`） | 令牌由 lane 签发并验签，壳不经手 |

四处平台约束与对应处理（均为模拟器实测得出）：

1. **`shouldInterceptRequest` 拿不到请求体**（Android 平台限制），而 dsh 的一元 RPC 是 POST + JSON body
   → 带 body 的请求走原生请求桥，壳自己发起并附凭证。
2. **https 页面 → ws:// 明文 WS 属混合内容**，Chromium 默认直接拦掉（实测：`Mixed Content: … insecure WebSocket endpoint ws://…/api/remote.mux`）；
   壳把 WebView 的混合内容模式放开后降级为告警、连接照常发起。
3. **lane 的会话 cookie 是 `SameSite=Lax`**，跨站 WS 握手**不带** cookie → lane 门禁 `401 UNPAIRED`；
   WebSocket 又不能自定义请求头（改 `SameSite=None` 必须 `Secure`，lane 是明文），
   故壳用会话 cookie 向 lane 换一个**直连令牌**，页面把它放进 URL（`/__dsh_ws/<令牌>/`）直连 lane。
4. **回后台页面 WS 必断**（Doze / 进程挂起）→ 壳在 `onResume` 重载页面，重建连接。
## 验收清单

- [x] 本地页面在真实 https origin 加载并完整启动（模块加载 / 路由 / 渲染）
- [x] 连 lane：对话 + 流式输出正常；回前台自动重连
- [x] 文档相对请求全部经壳转发（含 WS）；页面 JS 无凭证可达
- [x] `dshMobile` 壳桥三方法可用（switchHost 触发壳切代理 + reload）
- [x] targetSdk ≤ 36；注入行四类全执行（facade / global / boot / READY）
- [x] `ownsHost: true` 注入，服务端设置面可用
- [x] 主机条目入 Keystore 加密存储；重启 App 后主机与凭证仍在（实测）
- [x] cookie 不进 WebView 的 CookieManager；出站由壳解密附加（转发器 / 原生请求桥）
- [x] 原生管理页定稿 A 落地（当前主机大卡 / 主机列表 / 偏好分组 / FAB），无 emoji、token 对齐 dsh
- [x] 配对四态：粘贴链接 → 验证中 → 成功；无效令牌 → 失败（链接无效或已过期）
- [x] 扫码入口拉起 ZXing 取景框（模拟器虚拟相机；真实二维码解码链路由单元测试锁死）
- [x] 降级链：门禁 unpaired → 静默续期成功 → 全败标记「需重新配对：此设备已被桌面端移除」
- [x] 生物锁：冷启动触发；无指纹时回退设备 PIN（模拟器实测）
- [x] 切换主机：壳切代理目标 + 页面重载（管理页点选，实时日志与页面均已验证）
- [x] 原生浮层切换器定稿 A（右下角标 → 底部抽屉 → 主机列表（状态点 / 名字 / 形态徽标 /「当前」）→ 选中切换）：叠加在 WebView 之上的壳内原生 UI（不再依赖页面注入补丁），切换过程遮罩 + 完成 toast，无 emoji、token 对齐 dsh
- [x] mDNS 发现：扫描 `_dsh-lane._tcp` 并在管理页列出发现的桌面（名称 + 候选地址）
- [x] 发现项选中后引导去扫码 / 粘贴配对链接（发现不带授权，全程无令牌手输）
- [x] 更新提醒端到端：元数据 → 比对 → 提醒条 → 下载进度 → 系统安装器（模拟器实测安装成功）
- [x] 更新提醒语义：开关 / 拉黑版本（`shell:<版本>`）/ 已提醒最高版本（单测锁定 + 设备实测）
- [x] 无网络时更新检查静默降级（只记日志，不阻塞启动）
- [x] Kotlin 版本推导与 node 侧测试向量逐条对拍一致（跨实现测试向量）
- [x] 假 lane 请求面自检通过（`python3 tools/selftest.py`）：页面骨架 / 插件 bundle / GET+POST 回显 / 404 / keep-alive 多请求 / WS 握手
模拟器（AVD `dsh-android`，Android 15 / API 35，WebView 124）实测记录见提交说明。

浮层切换器的页面侧代码由**移动补丁集**注入（`scripts/plus/hooks-mobile/`），只在壳桥存在时激活；
桌面构建与官方变体的 dist 里没有这段代码（对照验证：`pnpm run verify:web:baseline`）。

## 已知限制（留给后续票）

- 扫码真机验证未做：模拟器的虚拟相机拍不出真二维码（二维码 → 文本 → 解析这一段由 JVM 单元测试覆盖）。
- `networkSecurityConfig` 的 base-config 放开明文：Android 的域名匹配只支持精确 IP，
  构建期无法枚举运行时的局域网地址（依据 docs/agents/research/webview-shell-constraints.md）。
- WebView 混合内容模式放开（ALWAYS_ALLOW）：https 页面要连明文 ws:// 的 lane，Chromium 默认拦掉。
- 浮层切换器只覆盖「选主机并切换」；主机的新增 / 删除 / 配对仍在原生管理页。
- mDNS 发现与更新提醒已交付（票 #62）；窄屏页面适配仍不在本票。
- mDNS 发现**未能在模拟器上跑通真实局域网广播**：Android 模拟器的虚拟网络（10.0.2.0/24）不转发
  宿主机的组播，模拟器扫不到宿主机 `dns-sd -R` 注册的 `_dsh-lane._tcp` 记录。扫描链路本身在设备上
  跑通（开始 / 停止 / 无权限报错均正常），广播记录 → 发现项的装配由 JVM 单测锁定；真机验证待补。
- 更新提醒的完整链路（拉元数据 → 比对 → 提醒 → 下载 → 系统安装器 → 安装成功）已在模拟器实测；
  真机侧载安装与「安装未知来源应用」授权页交互仍需真机复验。
