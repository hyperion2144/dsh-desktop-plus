/**
 * 构建 dsh-desktop-plus 的 client bundle（== 参考项目 dsh-plugin-desktop 的 client 构建）。
 * 产物 lib/client.js 包裹在 `window.__ModuleLoader__.load({ id, factory })` 中，
 * React / cordis / dsh client 运行时走 loader 注入的 require（external），
 * 其余按需内联。浏览器端由 dsh web 以 /plugins/dsh-desktop-plus/client.js 加载；注册 id 必须与宿主挂载名一致
 * （plugin-staging.ts 的 DESKTOP_PLUGIN_PACKAGE），否则模块系统激活不到工厂、重复执行 bundle（#19）。
 */
// esbuild 是本包的 devDependency。仓库未装依赖时给一句可执行的提示，
// 而不是裸的 MODULE_NOT_FOUND 堆栈（esbuild 的构建脚本已由根 pnpm-workspace.yaml 的 allowBuilds 放行）。
let build
try {
  ({ build } = await import('esbuild'))
} catch {
  console.error(
    '[dsh-desktop-plus] 未找到 esbuild：请先在仓库根执行 `pnpm install`，再运行 `pnpm --filter dsh-desktop-plus build:client`。',
  )
  process.exit(1)
}
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// bundle 工厂 id = 宿主挂载名（profile 里 insert 的 name）：模块系统按 entries[].id 找工厂，
// 名字不一致时 bundle 会被再执行一次并报 duplicate factory registration（实测 2026-10-25）。
const PACKAGE_NAME = '@deepseek-ai/dsh-desktop-plus-plugin'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const result = await build({
  entryPoints: [join(root, 'src/client/index.ts')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-runtime/client',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-web-react',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  banner: {
    js: `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(PACKAGE_NAME)},\n  factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\n`,
  },
  footer: {
    js: 'return module.exports;\n  }\n});\n',
  },
})
if (result.errors.length > 0) process.exit(1)
