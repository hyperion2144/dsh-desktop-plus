# dsh-desktop-plus

官方 DeepSeek Harness 桌面壳（`upstream/`）之上的能力增强发行版。

官方桌面是一个锁死单 profile 的极简壳：开一个窗口、跑一个 DSH、更新靠整包替换。这个项目在不改官方产品行为的前提下，把多 profile、托盘管理、运行时切换、远程接入这些能力补上去。

## 仓库结构

```
dsh-desktop-plus/
├─ upstream/        官方 DeepSeek Harness 全量源码快照（唯一真相，不在别处复制）
├─ packages/plus/   本项目自己的能力包
├─ scripts/plus/    生成器与上游同步脚本
├─ .github/         检查流水线与手动打包流水线
└─ pnpm-workspace.yaml   由 upstream/pnpm-workspace.yaml 生成，不要手改
```

### 为什么官方代码在 `upstream/`

`main` 是一条**孤儿根**历史：不含任何上游提交，上游代码以快照形式落在 `upstream/` 下，每个同步提交重放一次快照。这样两条诉求同时成立：

- 本项目的提交历史干净，不背 22000 条上游提交；
- 补丁永远浮在最新上游之上，不会累积成一份跑偏的 fork。

代价写在明处：根 `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`.gitignore` 这些"必须只有一个"的文件由我们接管，同步时重新生成。

### 根脚本的三条线

| 文件 | 作用 |
| --- | --- |
| `scripts/plus/sync-upstream.mjs` | 取新上游树 → 重放补丁 → 重新生成 → 校验 |
| `scripts/plus/gen-workspace.mjs` | 从 `upstream/pnpm-workspace.yaml` 生成根 workspace 配置 |
| `scripts/plus/hooks/` | 对官方代码的改动，以补丁存放，同步时按序重放 |

## 常用命令

全仓安装、检查、打包都沿用官方工具链：

```sh
pnpm install                 # 安装（根 pnpm-workspace.yaml 已生成好）
pnpm run gen:workspace:check # 校验生成物与上游一致
pnpm run typecheck           # 官方 typecheck 门禁
pnpm run typecheck:plus      # 本项目能力包 typecheck
pnpm run sync:upstream       # 跟进上游新提交
```

打包一律走 GitHub Actions 的 **Package Desktop** 流水线，手动触发：

```sh
gh workflow run package-desktop.yml --repo hyperion2144/dsh-desktop-plus --ref main
```

产物是 macOS（arm64）、Windows（x64）、Linux（x64）三份 unsigned 安装包，作为 workflow artifacts 下载。`linux-x64` 是上游没有的打包目标，由本仓补上。

## 发版

版本号形如 `X.Y.Z[-pre].plus.N`。

不要用 `+plus.N` 的 build metadata 形式：`electron-updater` 会忽略它，比较版本时两版会被判为同一个。

## 改上游代码的规矩

能不改就不改。确实要改的地方按补丁存放，改完必须能过 `pnpm run sync:upstream` 的重放校验——补丁一旦不能重放，同步就断了，这是这个仓库最容易出事的地方。

补丁用 `git diff` 导出，覆盖 `upstream/` 下的全部改动：

```sh
git diff <上游快照提交> HEAD -- upstream/ > scripts/plus/hooks/0001-desktop-linux-target.patch
```

导出后在纯上游树上验证一次能干净应用（`git apply --check`），再提交。没有进补丁的 `upstream/` 改动会在下一次同步时静默消失。
