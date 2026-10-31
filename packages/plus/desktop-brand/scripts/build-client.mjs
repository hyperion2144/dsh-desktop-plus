/**
 * 构建 dsh-desktop-plus-brand 的 client bundle（结构与 dsh-desktop-plus-plugin 的 build-client 同款）：
 * 产物 lib/client.js 包裹在 window.__ModuleLoader__.load({ id, factory }) 中，
 * React 与 dsh client UI 运行时走 loader 注入的 require（external），FishLogo 所在的
 * ui-primitives 也由宿主模块表供应。DSH_CLIENT_VERSION 构建期注入（打包链写 plus 版本），
 * 品牌组件经 process.env 读取该字面量。
 */
let build
try {
  ({ build } = await import('esbuild'))
} catch {
  console.error(
    '[dsh-desktop-plus] 未找到 esbuild：请先在仓库根执行 `pnpm install`，再运行 `pnpm --filter @deepseek-ai/dsh-desktop-plus-brand run build:client`。',
  )
  process.exit(1)
}
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// bundle 工厂 id = profile 里 insert 的 name（cordis.patch.yml），模块系统按 id 激活工厂。
const PACKAGE_NAME = '@deepseek-ai/dsh-desktop-plus-brand'
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
  define: {
    '__PLUS_BUILD_VERSION__': JSON.stringify(process.env.DSH_CLIENT_VERSION ?? ''),
    '__PLUS_BUILD_PROFILE__': JSON.stringify(process.env.DSH_CLIENT_BUILD_PROFILE ?? ''),
  },
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    '@deepseek-ai/cordis',
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
