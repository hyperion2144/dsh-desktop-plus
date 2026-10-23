# Changelog

## 未发布
- 打包产物上传修正：unsigned 构建落在 unsigned-artifacts/，产物上传路径随之补齐（此前只上传了几十 KB 的打包记录）。
- Linux 打包修复（票 #24 后续）：打包器同步清理主运行时树里平台不可用的 LibreOffice 原生引擎目录，冒烟检查不再误报 incomplete。
- CI 加 plus 单测门禁；发布流水线（票 #29）：tag 触发的三平台发布 workflow，版本号由脚本生成并校验 tag。
- 远程地址即 profile（票 #26）：mobile-remotes.json 原子存储 + 窗口直连远端 origin + 尽力而为的远端重启代理。
- 移动接入插件收编与 lane 稳定端口（票 #26）：dsh-mobile-access 适配为 @deepseek-ai/dsh-desktop-plus-mobile-access（同源反代+配对+隧道，lane 端口 3091 跨重启稳定），壳自动安装并投递，dsh web 端口经文件发现。
- 桌面设置/通知/profile/更新四组 RPC 命令与壳内组装（票 #27）：settings 存储原子写、更新桥官方协调器、profile 端口注册面。
- 设置组命令扩展（票 #27）：profiles 与 updates 组 RPC handlers（端口映射/启动询问/依赖任务如实回执；更新状态桥官方 coordinator 的壳侧持久化偏好）。
- 桌面设置存储与设置组 RPC（票 #27 进行中）：$DSH_HOME/desktop-settings.json 原子写 + settings/notifications 命令组 handlers（contracts 中性行对齐）。
- 运行时候选提醒记账（票 #23 进行中）：忽略/拉黑 ledger 与独立通知呈现，指纹变化重新提醒（remote 候选源接线待续）。
- 运行时安装/卸载编排（票 #28）：staging→校验→原子落位，失败不留半截目录，当前运行时拒绝卸载，进度与取消贯通。
- 下载队列 UI 收敛进桌面插件（/__shell__/rpc），壳侧内联 HTML 下载窗口退役，会话拦截与失败上报保留。
- 打包投递 plus 插件包进应用 resources（`plus-plugin`），供启动挂载步骤使用。
- 插件挂载走官方机制：启动时经 `dsh plugin add` 把 desktop-plugin 幂等装进 dsh profile，cordis bundle patch 自动挂载，client 半区由 host webRuntime 注入；缺插件不阻断桌面启动。
- 桌面插件半区：bun desktop-plugin 适配进 packages/plus/desktop-plugin（dsh 插件形态：cordis bundle 挂载 + React 页面半区），传输收敛为单通道同源 /__shell__/rpc。
- 壳侧 RPC 服务端：protocol.handle 分流 POST /__shell__/rpc，下载队列与日志/诊断命令已接入（registry 分派 + 处理器组）。

本文件记录 dsh-desktop-plus 的变更。发布时把「未发布」段整体挪到「已发布」并按版本归档。

## 未发布

### 仓库与上游

- 官方 DeepSeek Harness 桌面整体迁入 `upstream/`，`main` 为不含上游提交的孤儿根历史。
- 根 pnpm 配置改为从 `upstream/pnpm-workspace.yaml` 生成，安装、typecheck、补丁全部沿用官方设定。
- 新增 `sync:upstream` 同步脚本，按「取新树 → 重放补丁 → 重新生成 → 校验」流程跟进上游。
- 上游补丁统一存放在 `scripts/plus/hooks/`，同步时按文件名顺序重放。
- 新增 `README.md`，说明仓库结构、上游拓扑与打包流程。

### 构建与发布

- 新增多 profile 支持（票 #21）：同一安装可开多个隔离 profile（独立会话分区与数据目录，关窗即隐藏、退出前记住、下次启动恢复），默认 profile 行为不变。
- 新增运行时发现与切换（票 #22）：扫描已安装的 DSH 运行时并按版本列出，选中项持久化且重启后仍生效；启动与切换前都做完整性校验，损坏的选择自动回退内建运行时并给出原因，切换失败在改状态前拒绝。
- 新增重启与退出控制（票 #25）：四梯度退出——确认退出、跳过确认退出、收整宿主后无条件退出、计划性重启；重启后自动拾取已持久化的运行时选择，无需传参。
- 新增托盘 profile 管理（票 #24）：三平台菜单栏托盘，一级菜单即 profile 列表，每个 profile 支持显示/聚焦、整树重启（窗口经 splash 重建）与退出；应用级支持不退主进程的原地重启与四梯度退出。
- 修复 Linux 打包产物残留不可用的原生 LibreOfficeKit 目录导致运行时校验拒绝回退 WASM 的问题，并将打包期 tar 的盘符参数限定在 Windows。
- 修复 Windows 打包读取 npm 包清单时 tar 把盘符当远程主机的问题（--force-local）。
- 新增根目录 CI：安装、生成物校验、官方 typecheck、plus typecheck。
- 新增三平台打包流水线，产出 macOS、Windows、Linux 桌面产物。
- 修复三平台打包：Linux 按 Electron 发行包选对二进制路径，未签名 Windows 改用平台无关的本地预设，Linux 构建配置去重并补齐图标、可执行名与 tar.gz 产物。
- 修复 Linux 打包 prepare:dsh 阶段找不到 Electron 二进制的问题，运行时探测路径统一按平台解析。
- 新增 plus 壳内核（票 #12）：托盘先于 DSH 出现且 host 失败仍在，单实例可隔离（DSH_DESKTOP_NO_SINGLETON），官方代码经补丁 0002 挂接。
- 修复打包流水线缺失桌面壳构建步的问题，产物现在包含编译后的主进程。
- 打包构建步改用 8192MB 堆直接跑命令链，官方脚本的 4096MB 上限在 CI 冷编译下会 OOM。
- plus 壳改为构建期内联：desktop 不再声明 plus-shell 依赖，官方 package.json 与 lockfile 保持原样，由 tsdown alias 直指 plus lib 产物。
- 新增运行时判定层（票 #14）：纯函数去重、semver 降序（预发布浮于同版本正式版之前）、四类处置，零 IO 表驱动测试。
- 新增 `test:plus`，一次跑全部 plus 包测试。
- 新增宿主监督器（票 #15）：五态状态机（stopped/starting/running/failed/blocked）、崩溃退避重启且超上限后停并通知、整树收割与启动前孤儿清扫，退避与上限均可配置。
- 新增冷启动编排与 splash（票 #16）：托盘 → splash → 宿主 → 窗口顺序可见，阶段推送在页面就绪后才注入，启动失败停在 splash 显示原因且应用不退出。
- 新增通知门面（票 #18）：场景开关、免打扰与全屏静默即时丢弃不积压、窗口聚焦不重复弹、防休眠引用计数不泄漏、音效白名单与大小/时长上限、Windows AUMID。
- 新增日志面（票 #19）：按天与按大小轮转并 gzip 归档、超期清理，一键导出含诊断信息的 .tar.gz，页面 warn/error 进同一份日志，启动时记录运行时诊断行。
- 新增登录启动与打包态开发者工具（票 #20）：`DSH_DESKTOP_SET_LOGIN_ITEM` 控制开机自启且失败不阻断启动，打包态 F12/Alt+Cmd+I 开关独立窗口式开发者工具，关闭无残留。
- 新增下载管理器（票 #17）：拦截 will-download 进自己的队列，进度/速度实时可见，暂停/继续/取消真实生效，历史跨重启持久化，失败带可读原因，完成后可打开文件或所在目录。
- 修复 Linux 打包冒烟步按 mac 路径找产物的问题，并给无显示的 CI 冒烟接上 xvfb。
- 修复 Windows 打包步在 PowerShell 里跑 bash 条件导致的解析错误，统一用 bash 执行；Linux 打包的 Office 引擎固定走 WASM（该平台无原生 kit 分发）。

## 已发布

（暂无）
