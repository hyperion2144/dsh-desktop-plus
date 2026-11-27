// 客户端插件的接线检查（#151 回归）：入口从本包各客户端模块导入的每个名字都必须真的导出。
// 漏一个不会在构建期报错——打包是纯拼接——而是页面第一次开流时抛「未定义」，连接源打不开，
// 整个界面陷入「连接丢失、重试」。两台实例的页面曾因此一起失联，所以在这里锁死。
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../client/client.source.jsx', import.meta.url), 'utf8')

/** 入口里全部「从本包客户端模块按名导入」的语句：模块路径 → 导入的名字。 */
function namedImports(): Array<{ module: string, names: string[] }> {
  return [...SOURCE.matchAll(/import \{([^}]+)\} from "\.\/([a-zA-Z0-9_-]+\.js)";/g)].map((match) => ({
    module: match[2] ?? '',
    names: (match[1] ?? '').split(',').map((name) => name.trim()).filter((name) => name !== ''),
  }))
}

test('客户端入口导入的每个名字都被对应模块真的导出', async () => {
  const imports = namedImports()
  expect(imports.length).toBeGreaterThan(0)
  for (const entry of imports) {
    const module = await import(`../client/${entry.module}`) as Record<string, unknown>
    for (const name of entry.names) {
      expect(Object.hasOwn(module, name), `${entry.module} 没有导出 ${name}`).toBe(true)
    }
  }
})

test('入口里直接用到的闸门常量都已导入（视图端点集合决定哪些流留在本机）', () => {
  for (const name of ['LOCAL_VIEW_ENDPOINTS', 'REMOTE_STREAMS_ENABLED', 'SESSION_SHARE_MENU_ENABLED']) {
    expect(SOURCE, `入口用到了 ${name} 却没有导入`).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "\\./remote-gate\\.js"`))
  }
})

test('视图端点集合只收读本机镜像的那几条，不含任何会转发到 A 的端点', async () => {
  const gate = await import('../client/remote-gate.js') as { LOCAL_VIEW_ENDPOINTS: Set<string> }
  expect([...gate.LOCAL_VIEW_ENDPOINTS].sort()).toEqual([
    'session/events', 'session/follow', 'session/observeEvent', 'session/observeProjections', 'session/observeState',
    'session/page', 'session/projections', 'session/state', 'session/wait',
  ])
})
