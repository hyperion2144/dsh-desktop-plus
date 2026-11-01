# scripts/plus — 本仓库的生成器、补丁机制与构建入口

这个目录是「官方树 + 我们的改动」的装配间。`upstream/` 保持官方逐字节副本，
我们对它的每一处改动都以补丁文件的形式存在这里，构建时再打上去。

## 补丁集（patch set）

| 集合 | 目录 | 谁消费 |
|---|---|---|
| desktop | `scripts/plus/hooks/` | 桌面构建（`patches:apply`） |
| mobile | `scripts/plus/hooks-mobile/` | 移动变体构建（`build:web:mobile`） |

集合名登记在 `scripts/plus/patch-set.mjs` 的 `PATCH_SETS` 里。两个集合物理分离：
一条补丁文件只属于一个集合，一次构建只应用一个集合。

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
pnpm run verify:patch-sets   # 两个补丁集归属的路径不相交，且都能干净重放
```

`patches:apply` / `patches:revert` / `patches:extract` 都接受 `--set <name>`
（`patches:extract` 还接受 `--adopt <patch>=<path,...>`）。

## 变体构建（variant build）

一个**变体**是「官方树 + 恰好一个补丁集」，用官方构建命令构建出来。

- 桌面构建消费 `official + desktop`；
- 移动变体消费 `official + mobile`。

变体在临时目录里物化，**从不写 `upstream/`**：官方树取自 `HEAD:upstream`
（提交进仓库的那棵官方树），所以变体与工作区当前状态无关；`upstream/` 因此
天然保持官方干净——构建失败也没有东西需要还原。变体与桌面构建唯一共享的是
pnpm store（内容寻址、并发安全），两者可以同时跑。

```sh
pnpm run build:web:mobile      # 移动变体 dist → dist/web-mobile/
pnpm run build:web:official    # 官方原版 dist → dist/web-official/
pnpm run verify:web:baseline   # 基线验证：空移动集时两个 dist 逐字节一致
```

`build:web:mobile` 在变体树里跑的是官方构建 `pnpm run build:artifacts`
（native → Host → Desktop → Client → Web）。Web 构建消费工作区包的编译产物，
所以变体要连它发布的那些包一起编，产物才来自变体自己的源码。

变体树不是 git 工作区，而官方构建会把源码提交号写进客户端产物，所以构建显式
传入 `DSH_CLIENT_COMMIT_HASH`（仓库 HEAD）。变体就是「仓库提交 + 一个补丁集」，
提交号在两种变体里都是仓库 HEAD。

### 基线验证

`verify:web:baseline` 构建两个变体（官方原版与被测集合），逐文件逐字节比较两个 dist：

- 补丁集为空时，两个 dist 必须完全一致；
- 比较同时给出「内容」差异，用来区分「构建变了」与「构建只改了文件名」
  （rollup 按内容哈希给 chunk 命名）；
- 验证结束还会检查 `upstream/` 与桌面补丁集没有任何改动。

`--reference <dir>` 复用一份已构建的官方 dist，`--expect-identical` 在补丁集
非空时也强制要求一致。

## 移动端发版（release/）

`scripts/plus/release/` 是**移动端发版管线**的 node 侧（票 #66）。桌面发版走
`release-desktop.yml`，移动端走 `release-mobile.yml`，两者同一个 tag 触发、并行。

```sh
# 生成移动端 channel 元数据（每平台一份）+ 流水线清单
node scripts/plus/release/mobile-release-metadata.mjs \
  --version 0.2.2-alpha.2.plus.2 \
  --out-dir dist/mobile-metadata \
  --artifact android=build/app-release.apk \
  --artifact ios=build/DshMobile.ipa

# 发布后校验：按壳的取法把元数据与产物拉回来，比对 sha512 与大小
node scripts/plus/release/verify-mobile-release.mjs \
  --feed https://github.com/hyperion2144/dsh-desktop-plus/releases/download/v0.2.2-alpha.2.plus.2/nightly-android.yml
```

分层：

| 模块 | 职责 |
|---|---|
| `../mobile-metadata.mjs` | **纯函数**：元数据的形状（字段、命名、渲染），不读文件不联网 |
| `release/artifact-digest.mjs` | 产物的 sha512（base64）与字节数 |
| `release/mobile-release-metadata.mjs` | CLI：读产物 → 算摘要 → 落盘 → 出清单 |
| `release/verify-mobile-release.mjs` | 发布后校验（**独立实现**的元数据解析器） |

两处刻意不合并：

- 元数据的**形状**只有一处定义（`mobile-metadata.mjs`），发版流水线与单测共用；
- 校验器用**另一份**解析实现：发布后校验要能发现「生成器写出来的形状」与
  「客户端读出来的形状」不一致，用生成器自己的解析器给自己打分没有意义。
