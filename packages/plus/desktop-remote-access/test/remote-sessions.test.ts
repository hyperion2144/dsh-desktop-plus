// 远端会话：事件重编号、引用翻译、物化幂等、A 侧按目录筛选。
import { describe, expect, it } from 'vitest'
import {
  buildRemoteSessionSource,
  listSessionsUnderPath,
  materializeSession,
  normalizeCreatedAt,
  sameCwd,
  SESSION_LOG_VERSION,
  translateSessionEvents,
  type PersistedSessionHeader,
  type RemoteSessionEvent,
  type SessionPersistenceLike,
  type SessionStoreLike,
} from '../src/host/remote-sessions.js'

describe('translateSessionEvents', () => {
  it('按 seq 排序后重编号为 0..n-1', () => {
    const events: RemoteSessionEvent[] = [
      { type: 'b', seq: 7, time: 2, data: {} },
      { type: 'a', seq: 3, time: 1, data: {} },
    ]
    const translated = translateSessionEvents(events)
    expect(translated.map((e) => [e.type, e.seq])).toEqual([['a', 0], ['b', 1]])
  })

  it('sourceEventSeqs 从远端 seq 翻成本地 seq', () => {
    const events: RemoteSessionEvent[] = [
      { type: 'a', seq: 10, time: 1, data: {} },
      { type: 'b', seq: 20, time: 2, data: {}, surfaceOp: 'append', sourceEventSeqs: [10] },
    ]
    const translated = translateSessionEvents(events)
    expect(translated[1]?.sourceEventSeqs).toEqual([0])
    expect(translated[1]?.surfaceOp).toBe('append')
  })

  it('指向自身或未知 seq 的引用被丢弃（官方只接受更早的本地 seq）', () => {
    const events: RemoteSessionEvent[] = [
      { type: 'a', seq: 1, time: 1, data: {}, sourceEventSeqs: [1, 99] },
    ]
    expect(translateSessionEvents(events)[0]?.sourceEventSeqs).toBeUndefined()
  })
})

describe('sameCwd', () => {
  it('忽略尾斜杠', () => {
    expect(sameCwd('/Users/a/proj/', '/Users/a/proj')).toBe(true)
    expect(sameCwd('/Users/a/proj', '/Users/a/other')).toBe(false)
  })
})

describe('listSessionsUnderPath', () => {
  it('只保留 cwd 命中的会话', async () => {
    const headers = await listSessionsUnderPath({
      listHeaders: async () => [
        { id: 's1', cwd: '/Users/a/proj' },
        { id: 's2', cwd: '/Users/a/proj/' },
        { id: 's3', cwd: '/Users/a/other' },
      ],
    }, '/Users/a/proj')
    expect(headers.map((h) => h.id)).toEqual(['s1', 's2'])
  })
})

describe('materializeSession', () => {
  function store(): SessionStoreLike & { created: Array<{ id: string, seed: RemoteSessionEvent[], cwd: string }> } {
    const created: Array<{ id: string, seed: RemoteSessionEvent[], cwd: string }> = []
    const known = new Map<string, unknown>()
    return {
      created,
      get: (id) => known.get(id),
      create: (id, options) => {
        created.push({ id, seed: options.seed, cwd: options.meta.cwd })
        const handle = { id }
        known.set(id, handle)
        return handle
      },
    }
  }

  function persistence(options?: { stored?: boolean, noStat?: boolean, appendThrows?: boolean }) {
    const calls: string[] = []
    const seeds: RemoteSessionEvent[][] = []
    const headers: PersistedSessionHeader[] = []
    const service: SessionPersistenceLike = {
      ...(options?.noStat === true ? {} : {
        stat: async (id: string) => (options?.stored === true ? { header: { id } } : undefined),
      }),
      create: async (header) => {
        calls.push('create')
        headers.push(header)
        return {
          append: async (events) => {
            calls.push('append')
            seeds.push([...events])
            if (options?.appendThrows === true) throw new Error('append failed')
          },
          flush: async () => { calls.push('flush') },
          close: async () => { calls.push('close') },
        }
      },
    }
    return { service, calls, seeds, headers }
  }

  const log = {
    header: { id: 's1', cwd: '/Users/a/proj', createdAt: 1700000000000 },
    events: [
      { type: 'a', seq: 0, time: 1, data: {} },
      { type: 'b', seq: 1, time: 2, data: {} },
    ],
  }

  it('首次物化：create → append → flush → close 全走，并登记活体镜像', async () => {
    const sessions = store()
    const durable = persistence()
    const result = await materializeSession(sessions, log, '/Users/a/proj', durable.service)
    expect(result).toEqual({ id: 's1', eventCount: 2, durable: true })
    expect(durable.calls).toEqual(['create', 'append', 'flush', 'close'])
    expect(durable.headers[0]).toEqual({
      version: SESSION_LOG_VERSION,
      id: 's1',
      createdAt: 1700000000000,
      cwd: '/Users/a/proj',
      isSeeded: false,
      delegationDepth: 0,
    })
    expect(durable.seeds[0]?.map((e) => e.seq)).toEqual([0, 1])
    expect(sessions.created[0]?.cwd).toBe('/Users/a/proj')
    expect(sessions.created[0]?.seed.map((e) => e.seq)).toEqual([0, 1])
  })

  it('存储里已有该会话：不再写盘，事件数为 0，仍登记活体镜像', async () => {
    const sessions = store()
    const durable = persistence({ stored: true })
    const result = await materializeSession(sessions, log, '/Users/a/proj', durable.service)
    expect(result).toEqual({ id: 's1', eventCount: 0, durable: true })
    expect(durable.calls).toEqual([])
    expect(sessions.created).toHaveLength(1)
  })

  it('没有持久化后端时退化成纯内存镜像，并如实报告未落盘', async () => {
    const sessions = store()
    const result = await materializeSession(sessions, log, '/p')
    expect(result).toEqual({ id: 's1', eventCount: 2, durable: false })
    expect(sessions.created).toHaveLength(1)
  })

  it('活体会话已存在时幂等跳过', async () => {
    const sessions = store()
    const durable = persistence()
    await materializeSession(sessions, log, '/p', durable.service)
    expect(await materializeSession(sessions, log, '/p', durable.service)).toEqual({ id: 's1', eventCount: 0, durable: true })
    expect(sessions.created).toHaveLength(1)
    expect(durable.calls).toEqual(['create', 'append', 'flush', 'close'])
  })

  it('append 失败时抛出，close 仍然执行（不谎报落盘）', async () => {
    const sessions = store()
    const durable = persistence({ appendThrows: true })
    await expect(materializeSession(sessions, log, '/p', durable.service)).rejects.toThrow('append failed')
    expect(durable.calls).toEqual(['create', 'append', 'close'])
    expect(sessions.created).toHaveLength(0)
  })

  it('不支持 stat 的后端按未落盘处理（仍会尝试写）', async () => {
    const sessions = store()
    const durable = persistence({ noStat: true })
    expect(await materializeSession(sessions, log, '/p', durable.service)).toEqual({ id: 's1', eventCount: 2, durable: true })
    expect(durable.calls).toEqual(['create', 'append', 'flush', 'close'])
  })
})

describe('normalizeCreatedAt', () => {
  it('接受毫秒数与 ISO 字符串，非法值回落到当前时间', () => {
    expect(normalizeCreatedAt(1700000000000)).toBe(1700000000000)
    expect(normalizeCreatedAt('2023-11-14T22:13:20.000Z')).toBe(1700000000000)
    expect(normalizeCreatedAt(undefined)).toBeGreaterThan(0)
    expect(normalizeCreatedAt(-1)).toBeGreaterThan(0)
  })
})

describe('buildRemoteSessionSource', () => {
  it('服务缺失时返回空列表而不是抛错', async () => {
    const source = buildRemoteSessionSource(() => undefined)
    expect(await source.listHeaders()).toEqual([])
    expect(await source.readLog('x')).toBeUndefined()
  })

  it('用 sessionPersistence 列头、sessionQuery 读日志', async () => {
    const source = buildRemoteSessionSource((name) => {
      if (name === 'sessionPersistence') {
        return { list: async () => [{ header: { id: 's1', cwd: '/p', createdAt: '2026-01-01' } }] }
      }
      if (name === 'sessionQuery') {
        return { readSession: async () => ({ session: { id: 's1', cwd: '/p' }, events: [{ type: 'a', seq: 0, time: 1, data: {} }] }) }
      }
      return undefined
    })
    expect(await source.listHeaders()).toEqual([{ id: 's1', cwd: '/p', createdAt: '2026-01-01' }])
    const log = await source.readLog('s1')
    expect(log?.header.cwd).toBe('/p')
    expect(log?.events).toHaveLength(1)
  })
})
