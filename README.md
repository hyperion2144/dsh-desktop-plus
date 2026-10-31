[中文](README.md) | [English](README.en.md)

# DSH Desktop Plus

官方 DeepSeek Harness 桌面壳之上的能力增强发行版：把 DSH Web GUI 封装成 macOS / Windows / Linux 桌面应用，并补齐官方没有的桌面集成——多 Profile、托盘常驻、系统通知、下载管理、日志诊断与远程接入。

官方桌面是一个锁死单 profile 的极简壳：开一个窗口、跑一个 DSH、更新靠整包替换。Plus 在不改官方产品行为的前提下，把这些桌面能力补上。

## 安装

从 [GitHub Releases](https://github.com/hyperion2144/dsh-desktop-plus/releases/latest) 下载对应平台的安装包：

| 平台 | 产物 |
| --- | --- |
| macOS（Apple Silicon） | `.dmg` / `.zip` |
| Windows（x64） | `.exe` 安装器 |
| Linux（x64） | `.AppImage` / `.tar.gz` |

当前发布为未签名构建：macOS 首次打开请右键点按 →「打开」；Windows 出现 SmartScreen 时选择「仍要运行」。

## 功能

### 多 Profile

- 同一安装开多个隔离 profile（独立数据目录），互不干扰。
- 新建 / 删除 / 启动 / 重启 / 退出全在托盘完成；退出前记住哪些开着，下次启动自动恢复。

### 托盘常驻

- 一级菜单即 Profile 管理：显示 / 聚焦、整树重启（splash 过渡）、退出、删除；另有应用级重启与退出。
- 单实例运行，需要时开隔离副本，多实例并存。

### 冷启动编排

- 托盘 → splash → 宿主 → 窗口，启动顺序可见。
- 启动失败停在 splash 显示原因，不再黑盒等待。

### 退出语义

- 四梯度退出：确认退出、跳过确认退出、收整宿主后无条件退出、计划性重启。
- desktop profile 退出为真退出语义：停进程树 + 销毁窗口，托盘状态即时同步。

### 通知与专注

- 任务完成、等待审批、会话错误、下载完成的系统通知，按场景开关。
- 免打扰时段、全屏静默；窗口聚焦时不重复打扰。
- 防休眠：有活动任务时阻止系统睡眠，结束自动释放。
- 自定义提示音（wav / mp3 / ogg，格式与大小校验）或系统默认音，设置页可试听。

### 下载管理

- 浏览器下载拦截进统一队列：进度 / 速度实时可见，暂停 / 继续 / 取消真实生效。
- 历史跨重启持久化，完成后一键直达文件或所在目录。

### 日志与诊断

- 模块化日志内核：多源写入、级别过滤、按天与按大小轮转、gzip 归档、保留清理。
- 一键导出诊断 tar.gz；「打开日志目录」直达文件管理器。
- profile 输出带名称前缀汇入统一日志；页面告警与渲染崩溃同落入册。

### 设置面板

- 两栏布局：Profile（新建 / 删除 / 端口）、通知、代理、防休眠、登录自启、开发者工具、隐私与遥测一键关闭。

### 运行时管理

- 列出内置与已下载的 DSH 运行时，支持下载、切换（重启生效）与卸载。

### 远程接入

- 把远端 DSH 的 lane 地址（形如 `http://<主机>:<端口>/pair?token=…`）添加到服务地址，即生成一个远程 profile：窗口直连远端，本机不再起 DSH host。
- 一次性 token 完成配对；配对状态持久化，远端或本机重启后依旧免 token 直连，配对凭据失效时自动续期。
- 远程 profile 可从托盘远程重启远端桌面：本地 splash 等待远端恢复后重建窗口。
- 远程窗口点「退出」只销毁自身并断开连接，不会退出远端桌面。
- lane 端口按 profile 固定分配，跨重启不变。

### 实验能力

- Computer Use（macOS）：官方实验组件默认列出，插件页直接启用，原生 helper 随包分发。
- NodeJS 诊断、会话数据诊断等官方实验组件可选启用。

### 品牌与本地化

- 侧边栏品牌显示 DSH Desktop Plus 与 plus 构建版本徽标。
- 安装器与应用内 8 语文案，托盘语言跟随系统。

### 版本与更新

- 版本号 `X.Y.Z[-pre].plus.N`（官方版本 + plus 序号），写入安装包、Info.plist 与关于页。
- 应用内更新检测指向本仓库 GitHub Releases，支持 latest 与 nightly 渠道。

---

## 面向维护者

### 仓库结构

```
dsh-desktop-plus/
├─ upstream/        官方 DeepSeek Harness 全量源码快照（唯一真相，不在别处复制）
├─ packages/plus/   本项目自己的能力包
├─ scripts/plus/    生成器与上游同步脚本
├─ .github/         检查流水线、打包与发版流水线
└─ pnpm-workspace.yaml   由 upstream/pnpm-workspace.yaml 生成，不要手改
```

plus 层由两块组成：`packages/plus/desktop-shell`（壳侧服务：壳内核、启动编排、托盘、下载、通知、日志、运行时、多 profile 与远程 profile）与 `packages/plus/desktop-plugin`（dsh 插件形态的桌面设置面板，经官方插件机制挂载，页面通过官方 `/api/shell.invoke` 路由调壳侧服务）。

### 为什么官方代码在 `upstream/`

`main` 是一条孤儿根历史：不含任何上游提交，上游代码以快照形式落在 `upstream/` 下，每个同步提交重放一次快照。提交历史干净，不背上游两万多条提交；补丁永远浮在最新上游之上，不会累积成跑偏的 fork。代价是根 `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`.gitignore` 这些「必须只有一个」的文件由本仓接管，同步时重新生成。

### 常用命令

```sh
pnpm install                 # 安装（根 pnpm-workspace.yaml 已生成好）
pnpm run gen:workspace:check # 校验生成物与上游一致
pnpm run typecheck           # 官方 typecheck 门禁
pnpm run typecheck:plus      # 本项目能力包 typecheck
pnpm run sync:upstream       # 跟进上游新提交
```

### 打包与发版

打包走 GitHub Actions 的 **Package Desktop** 流水线（手动触发），产物是三平台 unsigned 安装包，作为 workflow artifacts 下载；`linux-x64` 是上游没有的打包目标，由本仓补上。

```sh
gh workflow run package-desktop.yml --repo hyperion2144/dsh-desktop-plus --ref main
```

发版由 tag 触发：推 `v<X.Y.Z[-pre].plus.N>` tag，流水线校验版本号（由 `scripts/plus/version.mjs` 从 upstream 版本与 CHANGELOG 未发布段推导）、三平台打包并发布 GitHub Release，release notes 取自 CHANGELOG 的未发布段。不要用 `+plus.N` 的 build metadata 形式：`electron-updater` 会忽略它，比较版本时两版会被判为同一个。

### 改上游代码的规矩

能不改就不改。确实要改的地方按补丁存放在 `scripts/plus/hooks/`，改完必须能过 `pnpm run sync:upstream` 的重放校验——补丁一旦不能重放，同步就断了，这是这个仓库最容易出事的地方。没有进补丁的 `upstream/` 改动会在下一次同步时静默消失。
