# scripts/plus/hooks-mobile — 移动补丁集


> **当前为空集**：主机切换已改为各壳原生浮层实现（叠加在 WebView 上的原生 UI），
> 页面内注入的切换器补丁已废除——upstream 不再接受注入的移动 UI。空集时
> `build:web:mobile` 产物与官方 dist 逐字节一致（`verify:web:baseline` 断言）。
> 集合保留目录与说明：未来确有必须改 upstream 的移动端页面需求时，按下方约定落补丁。
这是**移动补丁集**：移动变体构建（`pnpm run build:web:mobile`）唯一的 upstream 改动来源。

桌面补丁集在 `scripts/plus/hooks/`，两者物理分离：一条补丁文件只属于一个集合，
一次构建只应用一个集合。桌面构建永远不应用移动补丁，移动构建永远不应用桌面补丁。

## 放置约定

| 约定 | 说明 |
|---|---|
| 目录 | `scripts/plus/hooks-mobile/`，只放 `*.patch` 与本说明 |
| 命名 | `NNNN-<slug>.patch`，四位序号 + 短横线 + 英文短描述，按文件名升序应用 |
| 路径 | 补丁里的路径是仓库相对路径，一律以 `upstream/` 开头 |
| 归属 | 一个路径只属于一个补丁文件；一个路径只属于一个补丁集（桌面或移动，二选一） |
| 粒度 | 一个补丁表达一件事（一个移动端 UI 改动）；跨文件的同一件事放一个补丁里 |

## 写一条移动补丁

补丁记录的是 `upstream/` 里的改动，而 `upstream/` 必须保持官方逐字节副本。
所以写补丁的流程是：从官方干净树出发 → 在 `upstream/` 里改 → 抽回补丁 → 还原官方树。

```sh
# 1. upstream/ 必须是官方干净树（桌面补丁集不要打上来）
pnpm run patches:revert

# 2. 在 upstream/ 里改出移动端改动（例如下一票的浮层切换器）

# 3. 把改动抽回移动补丁集，随后 upstream/ 自动还原为官方树
pnpm run patches:extract -- --set mobile
```

`patches:extract --set mobile` 会重写 `scripts/plus/hooks-mobile/` 里已有的补丁文件
（每个补丁保留它已有的路径），并把官方树放回去。新补丁文件用 `--adopt` 指定归属：

```sh
pnpm run patches:extract -- --set mobile --adopt "0001-mobile-overlay-switcher=upstream/apps/web/src/mobile/switcher.ts"
```

没有补丁认领的改动路径会被拒绝（会丢改动），所以 `--adopt` 是必须的，不是可选的。

## 构建

```sh
pnpm run build:web:mobile
```

构建把「官方树 + 移动补丁集」装进一个临时目录，在那里跑官方构建，
把 `apps/web/dist` 发布到 `dist/web-mobile/`。`upstream/` 全程不被写入，
桌面构建工作流不受影响。

细节见 [scripts/plus/README.md](../README.md)。
