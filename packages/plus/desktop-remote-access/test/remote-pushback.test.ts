// 会话回推（#155）的纯逻辑：什么时候允许回推、回推哪一段、出处怎么记、设备侧怎么认领单分支。
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  decidePushbackFromBranch,
  decidePushbackOnDevice,
  pushbackProvenanceEvent,
  pushbackTail,
  createPushbackRegistry,
  type BranchProvenance,
} from '../src/host/remote-pushback.js'

const branch: BranchProvenance = {
  kind: 'remote-branch', sessionId: 'session-b1', hostId: 'h@http://a', remoteSessionId: 'session-s1', mirrorSessionId: 'remote-h-session-s1',
  forkPoint: 9, takenAt: 5, title: '改登录页', hostName: 'A 的 Mac',
}
const BOTH = ['keep-local', 'fork-on-device']

describe('发起侧：回推之前先看设备', () => {
  it('设备不可达：不回推，也不给「另起一条」的出口（那同样要连得上设备）', () => {
    for (const state of ['offline', 'unpaired', 'incompatible', undefined]) {
      const decision = decidePushbackFromBranch(branch, state)
      expect(decision.ok).toBe(false)
      if (!decision.ok) {
        expect(decision.reason).toBe('unreachable')
        expect(decision.exits).toEqual([])
        expect(decision.message.length).toBeGreaterThan(4)
      }
    }
  })

  it('设备在线、分支已选择保持本地或已经回推过：不再回推并说明', () => {
    expect(decidePushbackFromBranch(branch, 'online')).toEqual({ ok: true })
    expect(decidePushbackFromBranch({ ...branch, keptAt: 7 }, 'online')).toMatchObject({ ok: false, reason: 'kept' })
    expect(decidePushbackFromBranch({ ...branch, pushedAt: 7 }, 'online')).toMatchObject({ ok: false, reason: 'pushed' })
  })
})

describe('设备侧：四个前提全部满足才允许回推', () => {
  const base = { lastSeq: 9, forkPoint: 9, running: false, priorPush: undefined, deviceId: 'dev-b' }

  it('会话不存在、正在运行：拒绝，只能等', () => {
    expect(decidePushbackOnDevice({ ...base, lastSeq: undefined })).toMatchObject({ ok: false, reason: 'not-found', exits: [] })
    expect(decidePushbackOnDevice({ ...base, running: true })).toMatchObject({ ok: false, reason: 'running', exits: [] })
  })

  it('设备上的会话在分叉点之后又前进了：拒绝（diverged），给两个出口，且不自动合并', () => {
    const decision = decidePushbackOnDevice({ ...base, lastSeq: 12 })
    expect(decision).toMatchObject({ ok: false, reason: 'diverged', exits: BOTH })
    if (!decision.ok) expect(decision.message).toContain('不会自动合并')
  })

  it('单分支：别的分支已经回推过（或正在回推）：拒绝并给两个出口', () => {
    const decision = decidePushbackOnDevice({ ...base, priorPush: { deviceId: 'dev-c', state: 'done' } })
    expect(decision).toMatchObject({ ok: false, reason: 'already-pushed', exits: BOTH })
  })

  it('四个前提都满足：允许', () => {
    expect(decidePushbackOnDevice(base)).toEqual({ ok: true })
  })
})

describe('回推哪一段', () => {
  it('只取分叉点之后的事件，seq 接在分叉点后面，投递标记换回设备上的会话 id', () => {
    const events = [
      { type: 'user/message', seq: 8, time: 1, data: { text: '分叉点之前' } },
      { type: 'user/message', seq: 9, time: 2, data: { text: '分叉点' } },
      { type: 'user/message', seq: 10, time: 3, data: { text: '分支里的新消息' } },
      { type: 'session-log-deepseek/delivery-accepted', seq: 11, time: 3, data: { sessionId: 'session-b1', requestId: 'r' } },
      { type: 'assistant/message', seq: 12, time: 4, data: { text: '本机的回复' } },
    ]
    const tail = pushbackTail(events, 9, 'session-s1')
    expect(tail.map((event) => event.seq)).toEqual([10, 11, 12])
    expect(tail[1]?.data).toMatchObject({ sessionId: 'session-s1', requestId: 'r' })
    expect(tail.some((event) => (event.data as { text?: string }).text === '分叉点')).toBe(false)
    expect(pushbackTail(events.slice(0, 2), 9, 'session-s1')).toEqual([])
  })

  it('出处事件：来自哪台设备、分叉点在哪、带了多少条', () => {
    const event = pushbackProvenanceEvent(13, 99, 'dev-b', 9, 3)
    expect(event).toEqual({ type: 'remote-access/branch-imported', seq: 13, time: 99, data: { importedFrom: 'dev-b', forkPoint: 9, events: 3 } })
  })
})

describe('设备侧的回推登记', () => {
  it('落盘后原样读回；文件缺失或损坏时是空表', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pushback-registry-'))
    try {
      const registry = createPushbackRegistry(path.join(dir, 'nested', 'pushbacks.json'))
      expect(registry.load()).toEqual([])
      registry.save([{ sessionId: 'session-s1', deviceId: 'dev-b', forkPoint: 9, events: 3, state: 'done', at: 1 }])
      expect(createPushbackRegistry(registry.path).load()).toEqual([{ sessionId: 'session-s1', deviceId: 'dev-b', forkPoint: 9, events: 3, state: 'done', at: 1 }])
      writeFileSync(registry.path, '{not json')
      expect(registry.load()).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
