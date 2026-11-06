# scripts/plus — 本仓库的生成器、补丁机制与构建入口

这个目录是「官方树 + 我们的改动」的装配间。`upstream/` 保持官方逐字节副本，
我们对它的每一处改动都以补丁文件的形式存在这里，构建时再打上去。

## 补丁集（patch set）

| 集合 | 目录 | 谁消费 |
|---|---|---|
| desktop | `scripts/plus/hooks/` | 桌面构建（`patches:apply`） |

集合名登记在 `scripts/plus/patch-set.mjs` 的 `PATCH_SETS` 里。当前只有 `desktop` 一个集合：
一个路径只属于其中一条补丁，`patches:extract` 据此决定改动归哪条补丁。

补丁机制的原语在 `scripts/plus/patch-set.mjs`：

- `materializeTree` 把一个 git tree 物化成目录；
- `applyPatches` 把补丁集重放到任意目录（不要求那目录是 git 仓库）；
- `treeIdOfDirectory` / `diffTrees` 做逐字节比较（tree id 覆盖内容、文件模式、符号链接目标）。

命令：

```sh
pnpm run patches:apply       # 把桌面补丁集打到 upstream/
pnpm run patches:revert      # 把 upstream/ 还原成官方树
pnpm run patches:extract     # 把 upstream/ 当前的改动抽回桌面补丁集，再还原官方树
pnpm run verify:patches      # upstream/ 是官方树，且补丁集能干净重放
pnpm run verify:separation   # 补丁化之后的树与分离前的树逐字节一致
pnpm run verify:patch-sets   # 一个路径只属于一个补丁，且补丁集能干净重放
```

`patches:apply` / `patches:revert` / `patches:extract` 都接受 `--set <name>`
（`patches:extract` 还接受 `--adopt <patch>=<path,...>`）。
