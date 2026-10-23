# dsh-desktop-plus

DeepSeek Harness 桌面壳的**桌面半区插件**（DSH plugin）：随宿主挂载后给 dsh 页面注入桌面 chrome——桌面设置面板、通知设置、下载管理、浏览器 guest 桥、快捷键桥、控制台镜像等；并注册「DSH 桌面壳」技能与桌面设置的 settings 命名空间。

- 移植自 [`dsh-desktop-bun`](https://github.com/hyperion2144/dsh-desktop-bun) 的 `desktop-plugin/`：原壳是 Electrobun/Tauri，本仓换成**官方 deepseek-ai/dsh Electron 桌面壳（`upstream/apps/desktop`）的 plus fork**（`packages/plus/desktop-shell/`）。
- 壳半区（窗口、托盘、服务面、运行时管理、通知、下载、日志）在 `packages/plus/desktop-shell/`；本包只负责**页面半区 + 宿主侧技能/schema/事件桥**。
- 页面侧与壳侧的唯一通道是**同源 HTTP `/__shell__/rpc`**（见下）。

## 结构

```
index.js           插件入口：技能注册（SKILL.md 正文内联）+ 桌面设置 schema + 宿主事件桥（session/event → 壳 /notify）
cordis.patch.yml   bundle 层：安装时自动挂载插件行（insert id/name = dsh-desktop-plus）
src/client/        浏览器半区 TypeScript（桌面 chrome 各模块）
contracts/         壳 ↔ 页 命令契约（75 条命令的唯一事实源；壳与页各自 import，互不 import）
types/             外部模块的 ambient 声明（@deepseek-ai/dsh-client-ui-primitives 等）
scripts/           build-client.mjs（esbuild 打包 src/client → lib/client.js）
tsconfig.json      页面半区 strict typecheck 配置
```

`package.json` 的 `dsh` 段声明两件事：`dsh.client`（`platform: web` + inject 列表：theme / connection / sidebar-right / conversation）与 `dsh.bundle.patch`（指向 `cordis.patch.yml`）。

## RPC 通道约定

- 传输：**同源 HTTP POST `/__shell__/rpc`**（相对路径；壳必须与页面同源，否则 404）。
- 请求体：`{ "method": "<命令名>", "params": { ... } }`；回执：`{ "value": ... }` 或 `{ "error": "原因" }`。
- 失败可见：HTTP 非 2xx → `shell rpc http <status>`；回执带 error → `Error(error)`；超时 → `shell rpc timeout after <ms>ms: <method>`；端点不存在 → `shell rpc unavailable`。
- **命令名与参数/回执形状不因换壳而变**：仍用 `contracts/` 里的 75 个命令名（`get_desktop_client_environment`、`get_desktop_settings_data`、`save_desktop_settings`、`browser_guest_*`、`list_downloads`、`list_log_files`、`get_update_state` …）。壳侧实现同名同形状即可，页面侧零改动。
- 壳在场判定：`globalThis.dshDesktop`（官方 preload 契约，`protocolVersion === 1`）或任意一次 RPC 成功；两者皆无 = 普通浏览器，桌面 chrome 整体不激活。
- 旧壳（dsh-desktop-bun / tauriapp）的 Electrobun Typed RPC 通道与 mobile-access 中继通道**已删除**；远程/访客 profile 的转发由壳自己负责，命令名不变。

## 客户端能力一览

- **shell-rpc 统一传输层**：单通道同源 HTTP，请求级失败可见（无静默降级）。
- **桌面设置面板**（`desktop-settings/`）：dsh 运行时管理、profile 与端口、代理、通知、防休眠、开发者工具、手机访问、更新提醒、日志与诊断等卡片。
- **桌面 chrome**：标题栏三键与拖拽带（平台条件化）、右键菜单、下载拦截与管理 Tab、通知设置与音效导入、快捷键桥、console 镜像攒批上报。
- **浏览器 guest 桥**（`bridge/desktop-browser-bridge.ts`）：侧边栏内嵌页的租约 / 导航 / 前进后退 / 尺寸同步 / 可见性；同源 HTTP 没有推送通道，guest 状态改为轮询 `browser_guest_state`。
- **宿主事件桥**（`index.js`）：`session/event` → 壳 `/notify`（任务完成、审批请求、错误、忙状态心跳）；端口与令牌由壳用环境变量注入（`DSH_DESKTOP_NOTIFY_PORT` / `DSH_DESKTOP_NOTIFY_TOKEN`）。

## 挂载方式

本包通过 `cordis.patch.yml` 在 bundle 层挂载（安装即生效，无需改用户 profile）：

```yaml
- id: connection
  inject: [webRuntime, webServer]
- insert:
    - id: dsh-desktop-plus
      name: dsh-desktop-plus
```

`connection` 补丁是必需的：没有 `webRuntime` / `webServer` 注入，`rpc.handle` 注册的通道挂不上 HTTP 路由（页面侧表现为 transport failure）。插入行的 `id` 必须与 `scripts/build-client.mjs` 里的 `PACKAGE_NAME` 一致，否则模块系统激活不到 bundle 工厂。

## 构建

```bash
pnpm install                                    # 仓库根安装（esbuild 在本包 devDependencies 里）
pnpm --filter dsh-desktop-plus build:client     # esbuild 打包 src/client → lib/client.js
pnpm --filter dsh-desktop-plus typecheck        # tsc --noEmit（strict）
pnpm run typecheck:plus                         # 仓库级 plus 类型检查
```

页面半区用独立的 strict tsconfig，**不继承** `upstream/tsconfig.base.json`：那份带 `types: ["node"]`、`noUnusedLocals`、`composite` 等服务端约束，浏览器半区不适用。

## 已知限制

- 本仓当前**没有安装** esbuild（`require.resolve('esbuild')` 失败），`pnpm install` 之前无法打包；构建脚本会给出可执行的提示而不是裸堆栈。esbuild 的构建脚本已由根 `pnpm-workspace.yaml` 的 `allowBuilds: esbuild: true` 放行。
- React 类型只存在于 `upstream/node_modules/@types/react`，本包 tsconfig 用 `paths` 指过去（装齐依赖后可改回本包自己的 devDependency）。
- 普通浏览器里没有壳：桌面设置面板、下载/通知 tab、guest 桥都不激活。

## 许可

MIT（见 [LICENSE](LICENSE)）。DeepSeek 鲸鱼为官方商标，本项目是非官方客户端。
