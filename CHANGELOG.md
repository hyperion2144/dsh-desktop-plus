# Changelog

本文件记录 dsh-desktop-plus 的变更。发布时把「未发布」段整体挪到「已发布」并按版本归档。

## 未发布

### 仓库与上游

- 官方 DeepSeek Harness 桌面整体迁入 `upstream/`，`main` 为不含上游提交的孤儿根历史。
- 根 pnpm 配置改为从 `upstream/pnpm-workspace.yaml` 生成，安装、typecheck、补丁全部沿用官方设定。
- 新增 `sync:upstream` 同步脚本，按「取新树 → 重放补丁 → 重新生成 → 校验」流程跟进上游。
- 上游补丁统一存放在 `scripts/plus/hooks/`，同步时按文件名顺序重放。
- 新增 `README.md`，说明仓库结构、上游拓扑与打包流程。

### 构建与发布

- 新增根目录 CI：安装、生成物校验、官方 typecheck、plus typecheck。
- 新增三平台打包流水线，产出 macOS、Windows、Linux 桌面产物。

## 已发布

（暂无）
