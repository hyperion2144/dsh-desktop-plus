# mobile/harmony-electron — 鸿蒙上的 Electron 宿主（路线 C）

> 相关票：地图 [#87](https://github.com/hyperion2144/dsh-desktop-plus/issues/87)、选型 [#96](https://github.com/hyperion2144/dsh-desktop-plus/issues/96)、
> 调研 [#99](https://github.com/hyperion2144/dsh-desktop-plus/issues/99)、实现 [#101](https://github.com/hyperion2144/dsh-desktop-plus/issues/101)。
> 同仓的 `mobile/harmony/` 是另一条路线（ArkWeb + 进程内 Node，即 B 路线），两者并存，互不依赖。

## 这个目录是什么

把 **DSH 桌面应用原样搬进鸿蒙**的一条通道：鸿蒙上的 Electron 由 OpenHarmony SIG 移植
（Electron 25/34/37/40 四个分支），社区模板 `ohosvscode/ohos_electron_hap` 提供了
「ArkTS 外壳 + Electron 运行时 SO + Chromium 资源 + resources/app」这一整套宿主。

**模板不是我们的代码，所以不入库**。这里只放三样东西：

| 东西 | 路径 | 作用 |
|---|---|---|
| 模板钉版 | `template.json` | 模板仓库、commit、产物落点 |
| 覆盖层 | `overlay/` | 我们改的那几个文件（bundle 名、应用名、字符串） |
| 应用 | `app/` | 塞进 `resources/app` 的 Electron 应用（当前是最小骨架） |

构建脚本 `scripts/plus/build-harmony-electron.mjs` 负责把它们拼起来：

```text
下载钉版模板（.plus/tmp/harmony-electron/downloads/）
  → 解包到 cache/<ref>/
  → 复制成 build/（复用，ref 变了才重建）
  → 叠 overlay/
  → 用 app/ 整目录替换 web_engine/src/main/resources/resfile/resources/app/
  → 可选注入 signingConfigs
  → hvigorw assembleHap
  → 产物收进 dist/harmony-electron/
```

## 前置条件

| 需要 | 说明 |
|---|---|
| DevEco Studio + SDK | 默认读 `/Applications/DevEco-Studio.app/Contents/sdk`；可用 `--devec-sdk` 覆盖 |
| Node ≥ 22 | 脚本本身用 ESM，无第三方依赖 |
| `curl` / `tar` | 下载与解包模板（macOS 自带） |
| 设备（可选） | `~/Library/OpenHarmony/Sdk/<ver>/toolchains/hdc`；没有设备也能构建出 HAP |

磁盘：模板解包后约 284 MiB（其中 `libelectron.so` 160 MiB），落在 `.plus/tmp/`（已 gitignore）。

## 命令

```sh
pnpm run build:harmony-electron            # 构建，未签名
pnpm run verify:harmony-electron           # 只校验覆盖层还能命中钉版模板（模板漂移就报错）
node scripts/plus/build-harmony-electron.mjs --dry               # 只打印计划
node scripts/plus/build-harmony-electron.mjs --skip-download     # 只用已缓存的模板
node scripts/plus/build-harmony-electron.mjs --app <dir>         # 换真实 app 产物目录
node scripts/plus/build-harmony-electron.mjs --signing sign.json # 带签名材料构建
node scripts/plus/build-harmony-electron.mjs --bundle <name>    # 覆盖 bundleName（用来对着现成 profile 验签名）
```

产物：`dist/harmony-electron/electron-default[-unsigned].hap`，脚本会打印大小、sha256、签名状态。

## 签名怎么接

hvigor 认的签名材料是一个 `material` 对象（字段：`certpath` / `keyAlias` / `keyPassword` /
`profile` / `signAlg` / `storeFile` / `storePassword`）。把它写成一个 JSON 文件：

```json
{
  "certpath": "/Users/you/.ohos/config/default_harmony_xxx.cer",
  "keyAlias": "debugKey",
  "keyPassword": "……",
  "profile": "/Users/you/.ohos/config/default_harmony_xxx.p7b",
  "signAlg": "SHA256withECDSA",
  "storeFile": "/Users/you/.ohos/config/default_harmony_xxx.p12",
  "storePassword": "……"
}
```

再 `--signing <该文件>`。脚本把它注入到 `build-profile.json5` 的 `signingConfigs`（注入点是
`"app": {` 之后；模板若自己带 `signingConfigs`，脚本直接报错而不是硬塞第二份）。

**签名材料不入库**，原因是一手的：本机那些 debug profile 认的是 `bundle-name` 与设备 UDID
（例如 `io.github.hyperion2144.dsh.plusm` + 2 台设备，有效期 2026-11-01→2027-11-01）。
本工程默认 bundle 是 `io.github.hyperion2144.dsh.plus.hos`，**和已有 profile 不匹配**，
所以要装真机得先给这个 bundle 生成一份 debug 签名（DevEco → Project Structure →
Signing Configs → 自动签名），再 `--signing` 喂进来。

想立刻验签名链路、又不想等新 profile 时，可以用 `--bundle` 把构建目录里的 bundleName 改成
已有 profile 认的那个（例如 `--bundle io.github.hyperion2144.dsh.plusm`）：这样能产出**已签名**的 HAP。
代价是同名应用会顶掉设备上那个包，所以只适合本地验链路，不适合当发布形态。

## 装到设备

```sh
~/Library/OpenHarmony/Sdk/<ver>/toolchains/hdc list targets        # 先看有没有设备
~/Library/OpenHarmony/Sdk/<ver>/toolchains/hdc install -r dist/harmony-electron/<name>.hap
```

当前状态：`hdc list targets` 是 `[Empty]`（本机没连设备），所以**真机验证还没做**。

## 已经实测过的事实（2026-11-04）

| 检查 | 结果 |
|---|---|
| 钉版模板原样构建 | ✅ `BUILD SUCCESSFUL`（本机 DevEco SDK + hvigor），产物 `electron-default-unsigned.hap` |
| 模板是否带真实运行时 | ✅ 带：`libelectron.so` 160 MiB、`libadapter.so`、`libextractor.so`、`libffmpeg.so`、`libc++_shared.so`，加 Chromium 资源（`icudtl.dat`、`resources.pak`、`locales/`、`vulkan/`） |
| 模板自带 app | 有示例 app（`main.js` 开窗加载 cn.bing.com）；本工程用 `app/` 整体替换 |
| 无签名构建 | ✅ 出包，日志 `Will skip sign 'hos_hap'`，文件名带 `-unsigned` |
| 签名与 bundle 的关系 | profile 的 `bundle-info.bundle-name` 必须等于工程 bundle；不一致时 hvigor 直接失败：`00303074 Configuration Error: The bundleName in app.json5/hvigorfile.ts does not match the bundleName in the generated SigningConfigs` |
| 带签名构建 | ✅ 用本机既有 profile + `--bundle` 对齐 bundle 名后出签名包 `electron-default-signed.hap`（179.3 MiB）：注入 signingConfigs → hvigor 签名 → 收产物，整条链可用 |

## 还没做的（重要，别把这份骨架当成"鸿蒙已就跑起来"）

1. **真实 app 产物没接进来**：`app/` 现在是占位应用（开窗 + 显示 UA）。接真货要先有
   ohos 侧的 app 打包管线（把 `packages/plus/desktop-shell` + 上游 `apps/desktop` 的产物
   做成 `resources/app` 目录形态），这是另一张票。
2. **真机没验**：没有设备，也没有为本 bundle 签好的 profile。
3. **平台能力缺口**（调研 #99 已列）：托盘要 ArkTS 桥、系统通知两先例都没做成、
   自动更新只能走 AppGallery 提示、开机自启只有只读查询、PTY/命令执行要换常驻 sh 方案、
   `sharp` 需替换、JIT 权限决定只能上 2in1/平板。
4. **Electron 版本账**：鸿蒙移植最高 40（Node 24.15，`node:sqlite` 与 FTS5 实测可用），
   我们上游锁 44（Node 24.19）。降级已在 `scripts/plus/gen-workspace.mjs --target harmony` 落地（票 #100）。

## 为什么不用模板自带的示例 app 直接跑

示例 app 只是个 Electron 最小示例。我们的目标是「DSH 桌面 UI 原样跑」，所以 `app/` 一旦换成
真实产物，这个目录就从"能开窗的骨架"升级成"能用的应用"，其余部分（模板、覆盖层、构建脚本）都不用再动。
