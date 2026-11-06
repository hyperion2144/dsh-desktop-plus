// #109 会话流转：一次只搬一次，来源可追溯，拒绝理由说清两侧事件数。
import { describe, expect, it } from 'vitest'
import {
  HandoffStore,
  createMemoryHandoffStorage,
  decideHandoff,
  type HandoffRecord,
} from '../src/host/remote-handoff.js'

const record: HandoffRecord = {
  sessionId: 'session-1',
  hostId: 'dev@http://127.0.0.1:3091',
  hostName: 'host-A',
  originSessionId: 'session-1',
  path: '/Users/a/proj',
  handedOffAt: 1_700_000_000_000,
  eventCount: 3,
}

describe('decideHandoff', () => {
  it('没有既有记录时放行首次流转', () => {
    const decision = decideHandoff(undefined, 3)
    expect(decision.action).toBe('create')
    expect(decision.reason).toBeNull()
  })

  it('已流转过即拒绝，并说明对端新增了多少事件', () => {
    const decision = decideHandoff(record, 5)
    expect(decision.action).toBe('refuse')
    expect(decision.reason).toContain('host-A')
    expect(decision.reason).toContain('3 个事件')
    expect(decision.reason).toContain('新增了 2 个事件')
    expect(decision.reason).toContain('不合并、不覆盖')
  })

  it('对端没有新增事件也拒绝（同一会话只搬一次）', () => {
    const decision = decideHandoff(record, 3)
    expect(decision.action).toBe('refuse')
    expect(decision.reason).toContain('没有新增事件')
  })
})

describe('HandoffStore', () => {
  it('写入后可读出，并带全部来源字段', () => {
    const store = new HandoffStore({ storage: createMemoryHandoffStorage() })
    store.upsert(record)
    expect(store.get('session-1')).toEqual(record)
    expect(store.get('session-2')).toBeUndefined()
    expect(store.list()).toHaveLength(1)
  })

  it('持久化后新建实例能恢复（重启不丢来源）', () => {
    const storage = createMemoryHandoffStorage()
    new HandoffStore({ storage }).upsert(record)
    const restored = new HandoffStore({ storage })
    expect(restored.get('session-1')?.hostName).toBe('host-A')
    expect(restored.get('session-1')?.eventCount).toBe(3)
  })

  it('坏记录跳过而不是整表崩掉', () => {
    const storage = createMemoryHandoffStorage()
    storage.save({ handoffs: [{ sessionId: 1 } as unknown as HandoffRecord, record] })
    const store = new HandoffStore({ storage })
    expect(store.list()).toHaveLength(1)
    expect(store.get('session-1')?.hostId).toBe(record.hostId)
  })
})
