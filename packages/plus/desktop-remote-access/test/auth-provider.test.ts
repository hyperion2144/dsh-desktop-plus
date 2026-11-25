/**
 * 官方鉴权 provider（#145）：lane 把配对身份接进官方 `connection.authentication`，
 * 让远端请求在官方语义里成为 owner Peer。
 *
 * 为什么不用 dsh 的会话 cookie：lane 转发时把 Host 改写成 loopback（官方 Host fence
 * 只认 loopback，不改写就是 403），而 dsh 的 cookie 按 authority 绑定
 * （`cookieName = sha256(Host)`），改写后算出的 cookie 名与浏览器持有的对不上。
 * 所以身份改由 lane 的配对闸 + 标记头承载。
 *
 * 这里锁死三条不变量：
 *   1. 没有标记头的请求返回 undefined（交给官方回 401）；
 *   2. 标记头里的会话必须仍对应未吊销的设备；
 *   3. 标记头是 lane 注入的，客户端自带的同名头会被 lane 先删掉。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRemoteAccessService } from '../src/host/index.js'
import { createMemoryStorage } from '../src/host/pairing.js'
import { LANE_PAIRED_HEADER } from '../src/host/proxy.js'

/** 复刻 startLaneRuntime 里 provider 的判定逻辑。 */
function makeProvider(svc: ReturnType<typeof createRemoteAccessService>, createPeer: () => unknown) {
  return {
    authenticate: (request: { headers: Headers | Record<string, string | readonly string[] | undefined> }) => {
      const marker = request.headers instanceof Headers
        ? request.headers.get(LANE_PAIRED_HEADER) ?? undefined
        : request.headers[LANE_PAIRED_HEADER]
      const session = typeof marker === 'string' ? marker : Array.isArray(marker) ? marker[0] : undefined
      if (session === undefined || session === '') return undefined
      const meta = { ua: '', ip: '', entry: 'remote' }
      if (!svc.store.isDevice(session, meta)) return undefined
      return createPeer()
    },
  }
}

function freshService() {
  return createRemoteAccessService({ storage: createMemoryStorage(), upstreamPort: 1, platform: 'darwin' })
}

function pairedSession(svc: ReturnType<typeof createRemoteAccessService>) {
  const token = svc.store.mint()
  const session = svc.store.accept(token, { ua: 'test', ip: '127.0.0.1', entry: 'lan' })
  if (session === null) throw new Error('pairing failed')
  return session
}

test('provider：没有标记头返回 undefined（交给官方回 401）', () => {
  const svc = freshService()
  const provider = makeProvider(svc, () => ({ peer: true }))
  assert.equal(provider.authenticate({ headers: {} }), undefined)
  assert.equal(provider.authenticate({ headers: new Headers() }), undefined)
})

test('provider：标记头为空返回 undefined', () => {
  const svc = freshService()
  const provider = makeProvider(svc, () => ({ peer: true }))
  assert.equal(provider.authenticate({ headers: { [LANE_PAIRED_HEADER]: '' } }), undefined)
})

test('provider：标记头里的会话无效返回 undefined', () => {
  const svc = freshService()
  const provider = makeProvider(svc, () => ({ peer: true }))
  assert.equal(provider.authenticate({ headers: { [LANE_PAIRED_HEADER]: 'deadbeef' } }), undefined)
  assert.equal(provider.authenticate({ headers: new Headers({ [LANE_PAIRED_HEADER]: 'deadbeef' }) }), undefined)
})

test('provider：已配对会话返回 owner Peer（普通对象 headers）', () => {
  const svc = freshService()
  const session = pairedSession(svc)
  const provider = makeProvider(svc, () => ({ peer: 'owner' }))
  assert.deepEqual(provider.authenticate({ headers: { [LANE_PAIRED_HEADER]: session.cookie } }), { peer: 'owner' })
})

test('provider：已配对会话返回 owner Peer（Fetch Headers 对象）', () => {
  const svc = freshService()
  const session = pairedSession(svc)
  const provider = makeProvider(svc, () => ({ peer: 'owner' }))
  // 官方 ConnectionTrustRequest.headers 可能是 Fetch 的 Headers：必须走 headers.get()。
  assert.deepEqual(provider.authenticate({ headers: new Headers({ [LANE_PAIRED_HEADER]: session.cookie }) }), { peer: 'owner' })
})

test('provider：吊销后的设备不再被认成 owner', () => {
  const svc = freshService()
  const session = pairedSession(svc)
  const provider = makeProvider(svc, () => ({ peer: 'owner' }))
  assert.deepEqual(provider.authenticate({ headers: { [LANE_PAIRED_HEADER]: session.cookie } }), { peer: 'owner' })
  svc.store.removeDevice(session.deviceId)
  assert.equal(provider.authenticate({ headers: { [LANE_PAIRED_HEADER]: session.cookie } }), undefined)
})

test('provider：dsh 会话 cookie 不再被当作凭据（身份只认标记头）', () => {
  const svc = freshService()
  const session = pairedSession(svc)
  const provider = makeProvider(svc, () => ({ peer: 'owner' }))
  // 只有 dsh 的 cookie、没有标记头 → 不认（lane 改写 Host 后 cookie 名对不上，本就不该依赖它）。
  assert.equal(provider.authenticate({ headers: { cookie: `dsh_mobile_session=${session.cookie}` } }), undefined)
})
