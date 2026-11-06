// 镜像同步（#107）：把 A 上一条会话的事件按 seq 游标分页拉进本机。
// 两处落点：插件侧镜像缓存（远端原始 seq + 水位）与官方会话存储里的镜像会话（remote- 前缀 id，事件重编号）。
// 磁盘日志是本机镜像的唯一真相：界面打开时官方从磁盘载入活体，同步只保证磁盘完整、并在界面开着时让活体跟上。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMirrorCache } from '../src/host/remote-mirror-cache.js'
import { mirrorIdOf } from '../src/host/mirror-id.js'
import { SESSION_LOG_VERSION, type RemoteSessionEvent, type RemoteSessionHeader } from '../src/host/remote-sessions.js'
import type { MirrorPersistenceLike, MirrorStoreLike, MirrorSyncResult } from '../src/host/remote-session-sync.js'
import { syncRemoteMirror } from '../src/host/remote-session-sync.js'

const HOST_ID = 'dev-a@http://127.0.0.1:3091'
const LOCAL_ID = mirrorIdOf(HOST_ID, 's1')
const HEADER: RemoteSessionHeader = { id: 's1', cwd: '/Users/a/proj', createdAt: 1700000000000 }

function remoteEvent(seq: number): RemoteSessionEvent {
  return { type: 'assistant/message', seq, time: 5000 + seq, data: { text: `m${String(seq)}` }, surfaceOp: 'append' }
}

/** 官方恢复会话时在活体末尾补的那条标记。 */
function endSeed(seq: number): RemoteSessionEvent {
  return { type: 'session/end-seed', seq, time: 9000 + seq, data: {} }
}

/** 一台假的 A：按 afterSeq / limit 切页，并记录每次请求的游标。 */
function fakeRemote(initial: RemoteSessionEvent[]) {
  const state = { events: [...initial], gone: false, fail: false, cursors: [] as number[] }
  const server = http.createServer((req, res) => {
    let text = ''
    req.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
    req.on('end', () => {
      const body = JSON.parse(text) as { sessionId: string, afterSeq: number, limit: number }
      state.cursors.push(body.afterSeq)
      if (state.gone) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not-found"}'); return }
      if (state.fail) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"read-failed"}'); return }
      const ordered = [...state.events].sort((left, right) => left.seq - right.seq)
      const start = ordered.findIndex((event) => event.seq > body.afterSeq)
      const slice = start === -1 ? [] : ordered.slice(start, start + body.limit)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ header: HEADER, events: slice, watermark: ordered.at(-1)?.seq ?? -1, hasMore: start !== -1 && start + slice.length < ordered.length }))
    })
  })
  return { state, server }
}

/** 官方会话持久化的替身：追加事件的 seq 必须接着已有条数往下排（官方就是这么拒的）。 */
function fakePersistence() {
  // 官方恢复 agent 时会打开写句柄；这期间别的写者只会得到「已被占用」。claimWrite 模拟这一点。
  let owned = false
  const logs = new Map<string, { header: Record<string, unknown>, events: RemoteSessionEvent[] }>()
  const appendTo = async (id: string, events: readonly unknown[]): Promise<void> => {
    const entry = logs.get(id)
    if (entry === undefined) throw new Error(`no log for "${id}"`)
    const batch = events as RemoteSessionEvent[]
    const first = batch[0]
    if (first !== undefined && first.seq !== entry.events.length) {
      throw new Error(`append seq mismatch: expected ${String(entry.events.length)}, got ${String(first.seq)}`)
    }
    entry.events.push(...batch)
  }
  const api: MirrorPersistenceLike & { logs: typeof logs, claimWrite: () => void } = {
    logs,
    claimWrite: () => { owned = true },
    async stat(id) { return logs.has(id) ? { header: logs.get(id)?.header } : undefined },
    async create(header) {
      if (logs.has(header.id)) throw new Error(`a log already exists on disk for "${header.id}"`)
      logs.set(header.id, { header: header as unknown as Record<string, unknown>, events: [] })
      let open = true
      return {
        append: async (events) => { if (!open) throw new Error('handle closed'); await appendTo(header.id, events) },
        flush: async () => { },
        close: async () => { open = false },
      }
    },
    async open(id, access) {
      const entry = logs.get(id)
      // 与官方一致：打开不存在的会话是抛错，不是返回空。
      if (entry === undefined) {
        const error = new Error(`session "${id}" not found`) as Error & { name: 'SessionPersistenceNotFoundError' }
        error.name = 'SessionPersistenceNotFoundError'
        throw error
      }
      if (access === 'write' && owned) throw new Error(`session "${id}" is already owned by an active write handle`)
      let open = true
      return {
        append: async (events) => { if (!open || access !== 'write') throw new Error('not writable'); await appendTo(id, events) },
        flush: async () => { },
        read: async () => ({ events: [...entry.events] }),
        close: async () => { open = false },
      }
    },
  }
  return api
}

interface FakeLive {
  seq: number
  events: RemoteSessionEvent[]
  append: (type: string, data: unknown, options?: { surfaceOp?: unknown }) => void
  snapshotEvents: () => readonly RemoteSessionEvent[]
}

/** 官方活体会话存储的替身：只有界面打开过（或这里手工载入）的会话才在里面。 */
function fakeStore() {
  const live = new Map<string, FakeLive>()
  const store: MirrorStoreLike & { live: typeof live } = {
    live,
    get: (id) => live.get(id),
    create: (id, options) => {
      const entry: FakeLive = {
        seq: options.seed.length,
        events: [...options.seed],
        append: (type, data, options) => {
          entry.events.push({ type, seq: entry.seq, time: 0, data, ...(options?.surfaceOp === undefined ? {} : { surfaceOp: String(options.surfaceOp) }) })
          entry.seq += 1
        },
        snapshotEvents: () => entry.events,
      }
      live.set(id, entry)
      return { id }
    },
  }
  return store
}

describe('syncRemoteMirror', () => {
  const servers: http.Server[] = []
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => resolve()) })))
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  async function setup(events: RemoteSessionEvent[], pageSize = 3) {
    const remote = fakeRemote(events)
    await new Promise<void>((resolve) => { remote.server.listen(0, '127.0.0.1', () => resolve()) })
    servers.push(remote.server)
    const address = remote.server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-sync-'))
    dirs.push(dir)
    const persistence = fakePersistence()
    const store = fakeStore()
    const cache = createMirrorCache(dir)
    let last: MirrorSyncResult | undefined
    const run = (overrides: Partial<Parameters<typeof syncRemoteMirror>[0]> = {}): Promise<MirrorSyncResult> => {
      const promise = syncRemoteMirror({
        host: { hostId: HOST_ID, origin: `http://127.0.0.1:${String(port)}`, deviceId: 'dev-a', cookie: 'c', name: '', pairedAt: 0, lastSeen: 0 },
        remoteSessionId: 's1',
        cwd: HEADER.cwd ?? '',
        store,
        persistence,
        cache,
        // 重启后桥接从登记表恢复进度；这里直接沿用上一次的结果。
        materialized: last?.materialized,
        pageSize,
        ...overrides,
      })
      void promise.then((result) => { last = result }, () => undefined)
      return promise
    }
    return { remote, persistence, store, cache, run }
  }

  it('首次同步：按游标逐页拉完，镜像 id 带 remote- 前缀，事件顺序与 A 一致', async () => {
    const events = Array.from({ length: 7 }, (_, seq) => remoteEvent(seq))
    const { remote, persistence, cache, run } = await setup(events)
    expect(await run()).toEqual({ localId: LOCAL_ID, appended: 7, fetched: 7, watermark: 6, materialized: 7, caughtUp: true, durable: true, folded: false })
    // 游标依次衔接：从头、第 3 条之后、第 6 条之后。
    expect(remote.state.cursors).toEqual([-1, 2, 5])
    const stored = persistence.logs.get(LOCAL_ID)
    expect(stored?.header).toMatchObject({ version: SESSION_LOG_VERSION, id: LOCAL_ID, cwd: '/Users/a/proj', createdAt: 1700000000000, isSeeded: false, delegationDepth: 0 })
    // 本机事件从 0 重编号，内容与 A 一一对应；磁盘上只有远端事件，同步不往里掺标记。
    expect(stored?.events.map((event) => [event.seq, (event.data as { text: string }).text])).toEqual(
      events.map((event, index) => [index, `m${String(index)}`]),
    )
    // 缓存保存远端原始 seq 与水位。
    const snapshot = cache.read(HOST_ID, 's1')
    expect(snapshot?.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(snapshot?.meta).toEqual({ hostId: HOST_ID, sessionId: 's1', cwd: '/Users/a/proj', createdAt: 1700000000000 })
  })

  it('投递标记里的会话 id 换成镜像 id：官方校验要求它指向日志头里的会话，否则整条镜像被判定为日志损坏', async () => {
    const { persistence, run } = await setup([
      remoteEvent(0),
      { type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 0, data: { sessionId: 's1', sessionFormatVersion: 4, throughSeq: 0 } },
      remoteEvent(2),
    ])
    await run()
    const events = persistence.logs.get(LOCAL_ID)?.events ?? []
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2])
    expect(events[1]?.data).toEqual({ sessionId: LOCAL_ID, sessionFormatVersion: 4, throughSeq: 0 })
  })
  it('登记表进度落后、磁盘其实不落后（上一轮同步刚写完盘还没记进度）：不把缓存里的事件再写一遍', async () => {
    const { persistence, cache, run } = await setup([remoteEvent(0), remoteEvent(1), remoteEvent(2), remoteEvent(3)])
    // 磁盘与缓存都已有 4 条，只有进度还停在 0。
    cache.append({ hostId: HOST_ID, sessionId: 's1', cwd: '/Users/a/proj', createdAt: HEADER.createdAt as number }, Array.from({ length: 4 }, (_, seq) => remoteEvent(seq)))
    persistence.logs.set(LOCAL_ID, { header: {}, events: Array.from({ length: 4 }, (_, seq) => remoteEvent(seq)) })
    expect(await run({ materialized: 0 })).toMatchObject({ appended: 0, fetched: 0, watermark: 3, materialized: 4 })
    expect(persistence.logs.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0, 1, 2, 3])
  })

  it('镜像不在内存里：有新增就把完整日志折一遍官方投影（侧栏的标题、列表元数据从投影缓存读）；没有新增不折', async () => {
    const { remote, store, run } = await setup([remoteEvent(0), remoteEvent(1)])
    const folded: Array<{ id: string, events: number[] }> = []
    const projectionCache = {
      coldSnapshot(meta: { id: string }, _inherited: number, events: readonly RemoteSessionEvent[]) { folded.push({ id: meta.id, events: events.map((event) => event.seq) }) },
    }
    expect(store.live.has(LOCAL_ID)).toBe(false)
    expect(await run({ projectionCache })).toMatchObject({ folded: true })
    expect(folded).toEqual([{ id: LOCAL_ID, events: [0, 1] }])
    folded.length = 0
    await run({ projectionCache })
    expect(folded).toEqual([])
    remote.state.events.push(remoteEvent(2))
    expect(await run({ projectionCache })).toMatchObject({ appended: 1, folded: true })
    expect(folded).toEqual([{ id: LOCAL_ID, events: [0, 1, 2] }])
  })

  it('镜像正开着（在内存里）：不手动折投影，官方沿 session/event 自己写缓存', async () => {
    const { store, run } = await setup([remoteEvent(0)])
    store.create(LOCAL_ID, { seed: [], meta: { cwd: '/Users/a/proj' } })
    const folded: number[] = []
    expect(await run({ projectionCache: { coldSnapshot: () => { folded.push(1) } } })).toMatchObject({ folded: false })
    expect(folded).toEqual([])
    expect(store.live.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0])
  })

  it('A 新增事件后再同步：只请求水位之后的页，磁盘只追加新事件并接着排号', async () => {
    const { remote, persistence, run } = await setup([remoteEvent(0), remoteEvent(1)])
    await run()
    remote.state.events.push(remoteEvent(2), remoteEvent(3), remoteEvent(4))
    expect(await run()).toMatchObject({ appended: 3, fetched: 3, watermark: 4, materialized: 5, caughtUp: true })
    expect(remote.state.cursors).toEqual([-1, 1])
    expect(persistence.logs.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
  })

  it('重启后从缓存水位续传：不重拉历史', async () => {
    const events = Array.from({ length: 9 }, (_, seq) => remoteEvent(seq))
    const { remote, persistence, cache, run } = await setup(events)
    await run()
    remote.state.cursors.length = 0
    remote.state.events.push(remoteEvent(9), remoteEvent(10))
    expect(await run()).toMatchObject({ appended: 2, fetched: 2, watermark: 10 })
    expect(remote.state.cursors).toEqual([8])
    expect(cache.watermark(HOST_ID, 's1')).toBe(10)
    expect(persistence.logs.get(LOCAL_ID)?.events).toHaveLength(11)
  })

  it('一次最多拉 maxPages 页：没拉完时如实报告未追平，下次接着拉', async () => {
    const events = Array.from({ length: 12 }, (_, seq) => remoteEvent(seq))
    const { remote, run } = await setup(events, 2)
    expect(await run({ maxPages: 2 })).toMatchObject({ appended: 4, watermark: 3, caughtUp: false })
    expect(await run({ maxPages: 2 })).toMatchObject({ appended: 4, watermark: 7, caughtUp: false })
    expect(await run({ maxPages: 2 })).toMatchObject({ appended: 4, watermark: 11, caughtUp: true })
    expect(remote.state.cursors).toEqual([-1, 1, 3, 5, 7, 9])
  })

  it('缓存先落盘、磁盘没跟上（进程崩溃）：不联网，直接把缓存里缺的尾巴补进磁盘', async () => {
    const events = Array.from({ length: 4 }, (_, seq) => remoteEvent(seq))
    const { remote, persistence, cache, run } = await setup(events)
    cache.append({ hostId: HOST_ID, sessionId: 's1', cwd: '/Users/a/proj', createdAt: 1700000000000 }, events)
    expect(await run({ materialized: 0 })).toMatchObject({ appended: 4, fetched: 0, watermark: 3, materialized: 4 })
    expect(remote.state.cursors).toEqual([3])
    expect(persistence.logs.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0, 1, 2, 3])
  })

  it('缓存文件丢了但磁盘还在：从头拉，已经落盘的那部分不再写一遍', async () => {
    const events = Array.from({ length: 4 }, (_, seq) => remoteEvent(seq))
    const { remote, persistence, cache, run } = await setup(events)
    await run()
    cache.remove(HOST_ID, 's1')
    remote.state.cursors.length = 0
    remote.state.events.push(remoteEvent(4), remoteEvent(5))
    // 进度来自登记表：磁盘里已有 4 条。
    expect(await run({ materialized: 4 })).toMatchObject({ appended: 2, fetched: 6, watermark: 5, materialized: 6 })
    expect(remote.state.cursors).toEqual([-1, 2])
    expect(persistence.logs.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5])
    expect(cache.read(HOST_ID, 's1')?.events).toHaveLength(6)
  })

  it('界面开着这条会话（官方已为它恢复 agent、持有唯一的写句柄）：新事件只写给活体，不碰磁盘——官方替它落盘', async () => {
    const { remote, persistence, store, run } = await setup([remoteEvent(0), remoteEvent(1)])
    await run()
    // 界面打开：官方按磁盘日志载入活体，末尾补一条 end-seed（seq 2），并持有写句柄。
    store.create(LOCAL_ID, { seed: [...(persistence.logs.get(LOCAL_ID)?.events ?? []), endSeed(2)], meta: { cwd: '/Users/a/proj' } })
    persistence.claimWrite()
    remote.state.events.push(remoteEvent(2))
    expect(await run()).toMatchObject({ appended: 1, materialized: 3, folded: false })
    // 磁盘没被我们动过；新事件接在活体的标记之后，序号连续。
    expect(persistence.logs.get(LOCAL_ID)?.events.map((event) => [event.seq, event.type])).toEqual([[0, 'assistant/message'], [1, 'assistant/message']])
    expect(store.live.get(LOCAL_ID)?.events.map((event) => [event.seq, event.type]))
      .toEqual([[0, 'assistant/message'], [1, 'assistant/message'], [2, 'session/end-seed'], [3, 'assistant/message']])
  })


  it('界面开着、但活体只是观察流以只读句柄载入的（镜像会话上没有本机 agent）：新事件必须落盘，再补给活体只为显示——只写给活体会丢事件', async () => {
    const { remote, persistence, store, run } = await setup([remoteEvent(0), remoteEvent(1)])
    await run()
    // 界面打开：官方按磁盘日志载入活体、末尾补一条 end-seed；没有人持有写句柄。
    store.create(LOCAL_ID, { seed: [...(persistence.logs.get(LOCAL_ID)?.events ?? []), endSeed(2)], meta: { cwd: '/Users/a/proj' } })
    remote.state.events.push(remoteEvent(2))
    expect(await run()).toMatchObject({ appended: 1, materialized: 3 })
    // 磁盘是唯一真相：新事件排在已有条数之后，活体里那份只是显示用的副本（接在它自己补的标记之后）。
    expect(persistence.logs.get(LOCAL_ID)?.events.map((event) => [event.seq, event.type])).toEqual([[0, 'assistant/message'], [1, 'assistant/message'], [2, 'assistant/message']])
    expect(store.live.get(LOCAL_ID)?.events.map((event) => [event.seq, event.type]))
      .toEqual([[0, 'assistant/message'], [1, 'assistant/message'], [2, 'session/end-seed'], [3, 'assistant/message']])
    // 界面关掉再打开：官方从磁盘载入，事件一条不少。
    store.live.delete(LOCAL_ID)
    remote.state.events.push(remoteEvent(3))
    expect(await run()).toMatchObject({ appended: 1, materialized: 4 })
    expect(persistence.logs.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0, 1, 2, 3])
  })

  it('界面开着、活体落后于磁盘（对不上序号）：只写磁盘，不硬追加给活体——磁盘是真相，界面重新打开后自然一致', async () => {
    const { remote, persistence, store, run } = await setup([remoteEvent(0), remoteEvent(1), remoteEvent(2), remoteEvent(3)])
    await run()
    // 界面在第 2 条之后载入，又没有补标记：活体停在 0、1，磁盘已经到 3。
    store.create(LOCAL_ID, { seed: [remoteEvent(0), remoteEvent(1)], meta: { cwd: '/Users/a/proj' } })
    remote.state.events.push(remoteEvent(4))
    expect(await run()).toMatchObject({ appended: 1, materialized: 5 })
    expect(persistence.logs.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
    expect(store.live.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0, 1])
  })

  it('远端已经没有这条会话：如实报告，磁盘与缓存都不动', async () => {
    const { remote, persistence, run } = await setup([])
    remote.state.gone = true
    expect(await run()).toEqual({ localId: LOCAL_ID, appended: 0, fetched: 0, watermark: -1, materialized: 0, caughtUp: true, durable: true, folded: false, missing: true })
    expect(persistence.logs.has(LOCAL_ID)).toBe(false)
  })

  it('远端日志的游标回退（A 上的日志被重写）：抛错且什么都不写，不把重复事件追加进镜像', async () => {
    const { remote, persistence, cache, run } = await setup([remoteEvent(0), remoteEvent(1), remoteEvent(2)])
    await run()
    // A 上的日志被换成了另一份：对「水位 2 之后」返回的竟然是 seq 0。
    remote.server.removeAllListeners('request')
    remote.server.on('request', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ header: HEADER, events: [remoteEvent(0)], watermark: 1, hasMore: true }))
    })
    await expect(run()).rejects.toThrow(/游标回退/)
    expect(persistence.logs.get(LOCAL_ID)?.events).toHaveLength(3)
    expect(cache.watermark(HOST_ID, 's1')).toBe(2)
  })

  it('A 读不出来（500）：抛错，缓存与磁盘都不前进', async () => {
    const { remote, persistence, cache, run } = await setup([remoteEvent(0)])
    remote.state.fail = true
    await expect(run()).rejects.toThrow(/远端事件分页失败/)
    expect(persistence.logs.has(LOCAL_ID)).toBe(false)
    expect(cache.watermark(HOST_ID, 's1')).toBe(-1)
  })

  it('没有持久化服务：退化成纯内存镜像，事件全部进活体会话', async () => {
    const events = Array.from({ length: 5 }, (_, seq) => remoteEvent(seq))
    const { remote, store, run } = await setup(events)
    expect(await run({ persistence: undefined })).toMatchObject({ appended: 5, fetched: 5, watermark: 4, materialized: 5, caughtUp: true, durable: false, folded: false })
    expect(store.live.get(LOCAL_ID)?.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
    remote.state.events.push(remoteEvent(5))
    expect(await run({ persistence: undefined })).toMatchObject({ appended: 1, watermark: 5 })
    expect(store.live.get(LOCAL_ID)?.events).toHaveLength(6)
  })
})
