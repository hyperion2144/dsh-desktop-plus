[中文](README.md) | [English](README.en.md)

# DSH Desktop Plus

把 DeepSeek Harness 装成桌面应用，并让手机直接连上它。

官方 Harness 只有浏览器界面。Plus 补三件事：**桌面壳**（常驻、多开、通知、下载、日志）、**手机壳**（鸿蒙 / Android / iOS 原生客户端）、以及把两边接起来的**远程访问**。

## 安装

一个 Release 同时放桌面与手机：

| 平台 | 产物 |
| --- | --- |
| macOS（Apple Silicon） | `.dmg` / `.zip` |
| Windows（x64） | `.exe` 安装器 |
| Linux（x64） | `.AppImage` / `.tar.gz` |
| Android | `.apk`（固定签名，可覆盖升级） |
| iOS | `.ipa`（未签名，侧载工具重签） |

鸿蒙 HAP 不打进 Release，仓库内 `mobile/harmony` 自签构建（见其 README）。

当前为未签名构建：macOS 首次打开右键 →「打开」；Windows 遇到 SmartScreen 选「仍要运行」。

## 手机连上你的电脑

打开桌面端的「远程访问」面板，出地址和二维码；手机扫码，配对一次，之后免 token。

- 局域网直连；也可以挂 cloudflared / cpolar 隧道从外网进。
- 手机与桌面之间就是一条连接：页面带着签名令牌直接连回桌面，传输压缩在桌面侧解开——手机壳不转发字节，也不做二次握手，和浏览器访问同一台机器是同一种形态。
- 远端的设置页、插件页、主题与桌面一致；桌面其它本地端口上的插件资源自动映射过去，不用额外放行。
- 断线自动恢复；同一台设备重连会顶替旧连接，不会撞上「第二条连接被拒」。

## 桌面

- **多 Profile**：同一份安装开多个隔离实例，各自的 data 目录、端口与托盘项；退出前记住，下次启动恢复。
- **托盘即管理**：显示 / 聚焦、整树重启、退出、删除，另有应用级重启与退出；单实例运行，需要时开隔离副本。
- **启动编排**：托盘 → splash → 宿主 → 窗口，顺序可见；失败停在 splash 说明原因。
- **通知与专注**：任务完成 / 等待审批 / 会话错误 / 下载完成的通知按场景开关，支持免打扰时段、全屏静默、有任务时阻止休眠、自定义提示音。
- **下载管理**：浏览器下载进统一队列，进度与速度可见，暂停 / 继续 / 取消真实生效，历史跨重启保留。
- **日志与诊断**：多源日志、级别过滤、按天与按大小轮转、gzip 归档；一键导出诊断包，或直达日志目录。
- **设置面板**：Profile、通知、代理、防休眠、登录自启、开发者工具、隐私与遥测开关。
- **实验能力**：Computer Use（macOS）等官方实验组件在插件页直接启用，原生 helper 随包分发。
- 安装器与应用内 8 语文案；侧边栏显示 Plus 与 build 版本号。

## 手机

鸿蒙 / Android / iOS 三端同一套能力，各自原生实现：

- 本地加载官方页面产物，不依赖在线页面。
- 主机管理：mDNS 自动发现、扫码配对、手输地址、多主机切换。
- 连接降级：候选地址依次重试 → 会话过期静默续期 → 设备被移除才提示重新配对。
- 生物识别解锁，失败回退系统 PIN；凭证只存在各平台安全存储里，页面拿不到。
- 跟随系统深浅色；窄屏下设置页是全屏 + 横向导航，输入框按触屏规则放大到可读字号。
- 更新提醒：读发布 channel 元数据，有新版本可直达下载。

## 版本与更新

版本号是 `X.Y.Z[-pre].plus.N`（官方版本 + plus 序号），写进安装包与关于页。更新检测指向本仓库的 GitHub Releases，桌面与手机各自读对应的 channel 元数据。

## 面向维护者

### 仓库结构

```
dsh-desktop-plus/
├─ upstream/         官方 DeepSeek Harness 全量源码快照（逐字节一致，唯一真相）
├─ packages/plus/    本项目的能力包
│  ├─ desktop-shell/          壳侧服务：壳内核、托盘、通知、下载、日志、运行时
│  ├─ desktop-plugin/         插件形态的桌面设置面板（页面 → 壳走官方 shell.invoke）
│  └─ desktop-remote-access/  远程访问 host：lane 反代、配对、直连令牌与压缩终止
├─ mobile/           鸿蒙 / Android / iOS 三端原生壳
├─ scripts/plus/     生成器、补丁集、上游同步与发版脚本
└─ .github/          校验、打包与发版流水线
```

`main` 是孤儿根历史：上游代码以快照落在 `upstream/`，每个同步提交重放一次快照，提交历史不背上游两万多条提交。我们对上游的改动全部以补丁形式存在 `scripts/plus/hooks/`（桌面）与 `hooks-mobile/`（移动），构建时重放。代价是根 `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`.gitignore` 由本仓接管并在同步时重新生成。

### 常用命令

```sh
pnpm run patches:apply        # 把桌面补丁集打到 upstream/（构建前必须先跑）
pnpm install                  # 安装
pnpm run typecheck:plus       # 本项目能力包 typecheck
pnpm run test:plus            # 能力包单测
pnpm run build:web:mobile     # 移动变体页面产物（官方树 + 移动补丁集）
pnpm run verify:patches       # upstream/ 与官方树一致 + 补丁集可重放
pnpm run sync:upstream        # 跟进上游新版本
```

### 打包与发版

- **Package Desktop**（手动触发）出三平台 unsigned 安装包，作为 workflow artifact；`linux-x64` 是上游没有的目标，由本仓补上。
- **发版** = 推 tag `v<X.Y.Z[-pre].plus.N>`：`Release Desktop` 建 Release 并上传桌面资产，`Release Mobile` 在同一个 Release 追加 apk / ipa 与 channel 元数据。版本号由 `scripts/plus/version.mjs` 从上游版本与 CHANGELOG 推导并校验，不要用 `+plus.N` 的 build metadata（`electron-updater` 会忽略它）。
- **重发**（同一个 tag 重打一次）：流水线会覆盖资产与发布说明，并强制把 Release 置为已发布，不需要先删。
- 发布说明取自 `CHANGELOG.md`：未发布段或该版本已发布段，二选一。

### 改上游代码的规矩

能不改就不改。确实要改的按补丁放进 `scripts/plus/hooks/`，改完必须能过 `pnpm run verify:patches`——补丁一旦不能重放，同步就断了。没有进补丁的 `upstream/` 改动会在下一次同步时静默消失。
