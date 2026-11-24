/**
 * 访问日志的 profile 作用域（#145 评论 bug 2）。
 *
 * `access.log` 的路径必须**惰性求值**：`setProfileScope()` 在插件 `apply()` 里才调用，
 * 而 `proxy.ts` 在那之前就已加载。写成模块级常量会把日志固定到 `profiles/default/`，
 * 与配对库、设置落到的 profile 目录不一致。
 *
 * 这里用行为锁死：先设 profile，再起反代写一条日志，断言文件落在该 profile 目录下。
 */
import { test, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRewriteProxy } from '../src/host/proxy.js'
import { profileStoragePath, setProfileScope } from '../src/host/profile-scope.js'

let home: string
const originalHome = process.env.DSH_HOME

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-access-log-'))
  process.env.DSH_HOME = home
  setProfileScope(null)
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  setProfileScope(null)
  fs.rmSync(home, { recursive: true, force: true })
})

/** 起一个最小上游，返回端口。 */
async function startUpstream(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok') })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return { server, port: (server.address() as { port: number }).port }
}

/** 发一个请求触发访问日志。 */
function hit(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/probe`, { headers: { Connection: 'close' } }, (res) => {
      res.resume()
      res.on('end', () => resolve())
    }).on('error', reject)
  })
}

test('访问日志：落在当前 profile 目录，不是 default', async () => {
  // 先设 profile（模拟 apply() 里的 setProfileScope），再起反代——这正是实机顺序。
  setProfileScope('web')
  const up = await startUpstream()
  const proxy = createRewriteProxy({ upstreamHost: '127.0.0.1', upstreamPort: up.port, inject: [] })
  const lp = await new Promise<number>((r) => proxy.server.listen(0, '127.0.0.1', () => r((proxy.server.address() as { port: number }).port)))
  try {
    await hit(lp)
    // 日志写入是异步的：给它一点时间落盘。
    await new Promise((r) => setTimeout(r, 120))
    const expected = profileStoragePath('access.log')
    assert.ok(fs.existsSync(expected), `日志应落在 ${expected}`)
    assert.ok(expected.includes(path.join('profiles', 'web')), '路径应含 profiles/web')
    const legacy = path.join(home, 'storages', 'remote-access', 'profiles', 'default', 'access.log')
    assert.ok(!fs.existsSync(legacy), '不得写到 profiles/default/')
  } finally {
    proxy.server.closeAllConnections?.()
    proxy.server.close()
    up.server.closeAllConnections?.()
    up.server.close()
  }
})
