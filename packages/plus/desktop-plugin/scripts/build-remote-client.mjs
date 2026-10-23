/**
 * 构建 @deepseek-ai/dsh-desktop-plus-remote-access 的 client bundle。
 * 迁移自 dsh-desktop-bun 的 desktop-plugin/scripts/build-remote-client.mjs（完整迁移，不改实现）。
 *
 * 入口：packages/plus/desktop-remote-access/client/client.source.jsx（裸 ES module 源码，含 JSX）
 * 产物：packages/plus/desktop-remote-access/client/client.js，包裹在
 * `window.__ModuleLoader__.load({ id, factory })` 中，与桌面插件/官方 client bundle 格式一致。
 * 入口必须是 .jsx —— esbuild 按扩展名走 jsx loader（automatic）；入口不能是已打包产物（否则双层包装 → duplicate factory registration）。
 * 没有 wrapper 的裸 CJS 会被 ModuleLoader 直接忽略（注册永不执行 → 远程访问 tab 不出现，2026-10-27 实测）。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop-plus-remote-access'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(scriptDir, '..')
const remoteRoot = join(pluginRoot, '..', 'desktop-remote-access')
const clientSrc = join(remoteRoot, 'client', 'client.source.jsx')
const clientOut = join(remoteRoot, 'client', 'client.js')

const result = await build({
  nodePaths: [join(pluginRoot, 'node_modules'), join(remoteRoot, 'node_modules')],
  entryPoints: [clientSrc],
  outfile: clientOut,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: [
    'react',
    'react/jsx-runtime',
  ],
  banner: {
    js: `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(PACKAGE_NAME)},\n  factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\n`,
  },
  footer: {
    js: 'return module.exports;\n  }\n});\n',
  },
  logLevel: 'info',
})

if (result.errors.length > 0) process.exit(1)

console.log(`✅ Built ${PACKAGE_NAME} client: ${clientOut}`)
