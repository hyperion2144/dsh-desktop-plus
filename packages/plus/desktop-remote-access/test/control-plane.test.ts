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

/** 截出某个 case 分支的源码（到下一个 case 分支为止）。 */
function caseBlock(name: string): string {
  const start = SOURCE.indexOf(`case '${name}':`)
  assert.notEqual(start, -1, `找不到分支 ${name}`)
  const end = SOURCE.indexOf("\n          case '", start + 10)
  return SOURCE.slice(start, end === -1 ? undefined : end)
}

test('写开关把关在远端创建（#153）；旧的推送与搬运由各自独立的开关挡住，不随写开关打开', () => {
  assert.match(SOURCE, /import \{ REMOTE_HANDOFF_ENABLED, REMOTE_IMPORT_ENABLED, REMOTE_PUSH_ENABLED, REMOTE_WRITES_ENABLED, remoteReadonlyRefusal \} from '\.\/remote-policy\.js'/)
  // 在 A 上登记工作区属于「在远端创建」（#153）：只读镜像模式（写开关关闭）下关在开关后面，否则添加远程工作区会被闸门拒掉。
  assert.match(caseBlock('remoteWorkspace.add'), /if \(REMOTE_WRITES_ENABLED\) \{/)
  // 新建会话在落到任何远端调用之前就拒绝，拒绝原因按「新建会话」措辞。
  assert.match(caseBlock('remoteSession.create'), /if \(!REMOTE_WRITES_ENABLED\) return errRpc\(remoteReadonlyRefusal\('session\/create'\)\)/)
  // 把本机会话推到 A（旧的分享流程）与单向搬运（#109）已被接管 / 回推取代：各有独立开关，写开关打开也不放行。
  assert.match(caseBlock('remoteSession.push'), /if \(!REMOTE_PUSH_ENABLED\)/)
  assert.match(caseBlock('remoteSessions.handoff'), /if \(!REMOTE_HANDOFF_ENABLED\)/)
  // 对端经数据面往本机会话存储写入同理。
  assert.match(SOURCE, /if \(!REMOTE_IMPORT_ENABLED\) \{ json\(403/)
})

test('移除远程工作区可以只给官方工作区 id：侧栏删除条目时客户端手里只有它', () => {
  assert.match(caseBlock('remoteWorkspace.remove'), /payload\?\.workspaceId/)
})

test('inject 覆盖代码里直接读取的 connection 子服务（#148 合入后漏声明，宿主半区整体不激活）', () => {
  const declared = /export const inject = \[([^\]]*)\]/.exec(SOURCE)?.[1] ?? ''
  const names = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1])
  const subs = new Set<string>()
  for (const m of SOURCE.matchAll(/\bconnection\??\.(authentication)\b/g)) subs.add(`connection.${m[1]}`)
  assert.ok(subs.size > 0, '找不到直接读取 connection 子服务的代码：若写法变了，本测试要跟着改')
  for (const sub of subs) {
    // Cordis 守卫对未声明的子服务属性直接抛错，apply 整个失败：lane 不启动、控制面不注册，且界面上一声不吭。
    assert.ok(names.includes(sub), `代码直接读取 ${sub}，但 inject 没有声明`)
  }
})

test('桌面接线（web-app bundle 条目）自己声明 connection.authentication：条目级 inject 按顶层键整体覆盖模块级声明', () => {
  // 装载器合并条目 inject 时是 Object.assign：条目里的 connection: {} 会把模块级的 connection: { authentication } 整个盖掉。
  // 所以这个子服务必须在桌面实际使用的那条接线里声明，模块级补了也不生效。
  const patch = readFileSync(new URL('../../../../scripts/plus/hooks/0008-telemetry-opt-out.patch', import.meta.url), 'utf8')
  const at = patch.indexOf("name: '@deepseek-ai/dsh-desktop-plus-remote-access'")
  assert.notEqual(at, -1, 'web-app bundle 的 patch 里找不到远程访问插件条目')
  const entry = patch.slice(at, patch.indexOf('- id:', at + 10) === -1 ? undefined : patch.indexOf('- id:', at + 10))
  assert.match(entry, /inject: \[[^\]]*connection\.authentication[^\]]*\]/)
})
