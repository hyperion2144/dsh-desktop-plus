// #103 回归：控制面命令表与 switch 分支必须一一对应。
// 漏登记的命令不会被 switch 接住，而是被 /api 路由直接回 404（字面 `not found`），
// 现象是「有的命令能用、有的不能用」，排查时极容易被误判成业务逻辑错误——
// #107/#109 的会话读写与流转就曾因此整段不可达，而落盘与内存镜像其实都成功了。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8')

/** 抽出控制面命令表（`const commands = [...]`）里的命令名。 */
function commandTable(): string[] {
  const match = /const commands = \[([^\]]*)\]/.exec(SOURCE)
  assert.notEqual(match, null, '找不到控制面命令表 `const commands = [...]`')
  return [...match![1].matchAll(/'([^']+)'/g)].map(m => m[1])
}

/** 抽出 dispatch switch 里实现过分支的命令名。 */
function dispatchedCases(): string[] {
  return [...SOURCE.matchAll(/^\s*case '([^']+)':/gm)].map(m => m[1])
}

test('命令表与 switch 分支一一对应', () => {
  const registered = commandTable()
  const dispatched = dispatchedCases()
  assert.deepEqual(
    [...registered].sort(),
    [...dispatched].sort(),
    '命令表与 switch 分支必须完全一致：只登记不实现会 404，只实现不登记同样 404',
  )
})

test('远端会话的列出、读取与流转命令都已登记', () => {
  const registered = new Set(commandTable())
  for (const cmd of ['remoteSessions.sync', 'remoteSessions.list', 'remoteSessions.read', 'remoteSessions.handoff']) {
    assert.ok(registered.has(cmd), `控制面缺少 ${cmd}`)
  }
})
