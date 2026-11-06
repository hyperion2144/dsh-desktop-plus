// P0 只读（spec #103 重写版）：A 侧 lane 的会话写入路由必须拒绝。
// 远程会话是只读镜像，已配对设备不该往本机的会话存储里写；旧的「推送会话」走的就是这条路由。
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createRemoteAccessService } from '../src/host/index.js'
import { createMemoryStorage } from '../src/host/pairing.js'

test('session.import 在 P0 被拒（403），本机会话存储一次都没被写', async () => {
  let writes = 0
  const svc = createRemoteAccessService({
    storage: createMemoryStorage(),
    upstreamPort: 3080,
    sessions: {
      listHeaders: async () => [],
      readLog: async () => undefined,
      writeLog: async () => { writes += 1; return 0 },
    },
  })
  const port = await svc.listen()
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/__dsh-mobile/api/remote/session.import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ log: { header: { id: 's1' }, events: [] }, cwd: '/Users/a/proj' }),
    })
    assert.equal(response.status, 403)
    const body = await response.json() as { error?: string, message?: string }
    assert.equal(body.error, 'remote-readonly')
    assert.match(body.message ?? '', /只读镜像/)
    assert.equal(writes, 0, '被拒的请求不能触达会话存储')
  } finally {
    await svc.close()
  }
})

test('只读路由不受闸门影响：会话列表照常返回', async () => {
  const svc = createRemoteAccessService({
    storage: createMemoryStorage(),
    upstreamPort: 3080,
    sessions: { listHeaders: async () => [{ id: 's1', cwd: '/Users/a/proj' }], readLog: async () => undefined },
  })
  const port = await svc.listen()
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/__dsh-mobile/api/remote/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/Users/a/proj' }),
    })
    assert.equal(response.status, 200)
    const body = await response.json() as { sessions?: Array<{ id: string }> }
    assert.deepEqual(body.sessions?.map((session) => session.id), ['s1'])
  } finally {
    await svc.close()
  }
})
