// 会话接管（#154）的纯逻辑：什么时候允许接管、分支怎么取 id、种子取到哪、出处怎么存怎么说。
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  branchEvents,
  branchLabel,
  createBranchRegistry,
  decideTakeover,
  titleFromEvents,
  newBranchSessionId,
  type BranchProvenance,
} from '../src/host/remote-takeover.js'

describe('什么时候允许接管', () => {
  it('只在设备离线时允许：这是「A 不可达时继续干活」的出口，不做自动切换', () => {
    expect(decideTakeover('offline')).toEqual({ ok: true })
  })

  it('设备在线、未配对、版本不符、状态未知都拒绝，并给出能照着做的一句话', () => {
    for (const state of ['online', 'unpaired', 'incompatible', undefined, 'nonsense']) {
      const decision = decideTakeover(state)
      expect(decision.ok).toBe(false)
      if (!decision.ok) expect(decision.message.length).toBeGreaterThan(4)
    }
    expect(decideTakeover('online')).toMatchObject({ ok: false, reason: 'online' })
    expect(decideTakeover(undefined)).toMatchObject({ ok: false, reason: 'unknown' })
  })
})

describe('分支的 id 与种子', () => {
  it('分支用普通的本机会话 id，与镜像 id（remote- 前缀）区分得开', () => {
    const id = newBranchSessionId(() => '0f0e-uuid')
    expect(id).toBe('session-0f0e-uuid')
    expect(id.startsWith('remote-')).toBe(false)
  })

  it('种子只取水位以内的事件，按原顺序从 0 重编号，并把投递标记换成分支的 id', () => {
    const events = [
      { type: 'user/message', seq: 7, time: 1, data: { text: 'hi' } },
      { type: 'session-log-deepseek/delivery-accepted', seq: 8, time: 1, data: { sessionId: 'remote-x-session-s1', requestId: 'r1' } },
      { type: 'assistant/message', seq: 9, time: 2, data: { text: 'yo' } },
      { type: 'assistant/message', seq: 11, time: 3, data: { text: '超出水位' } },
    ]
    const seeded = branchEvents({ events, watermark: 9 }, 'session-branch')
    expect(seeded.map((event) => event.seq)).toEqual([0, 1, 2])
    expect(seeded[1]?.data).toMatchObject({ sessionId: 'session-branch', requestId: 'r1' })
    expect(seeded[2]?.data).toMatchObject({ text: 'yo' })
    expect(seeded.some((event) => (event.data as { text?: string }).text === '超出水位')).toBe(false)
  })
})

describe('出处的存放与说法', () => {
  it('出处落盘后原样读回；文件缺失或损坏时是空表', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'branch-registry-'))
    try {
      const registry = createBranchRegistry(path.join(dir, 'nested', 'branches.json'))
      expect(registry.load()).toEqual([])
      const record: BranchProvenance = {
        kind: 'remote-branch', sessionId: 'session-b1', hostId: 'h@http://a', remoteSessionId: 'session-s1', mirrorSessionId: 'remote-h-session-s1',
        forkPoint: 9, takenAt: 5, title: '原会话标题', hostName: 'A 的 Mac',
      }
      registry.save([record])
      expect(createBranchRegistry(registry.path).load()).toEqual([record])
      expect(JSON.parse(readFileSync(registry.path, 'utf8')).branches).toHaveLength(1)
      writeFileSync(registry.path, '{not json')
      expect(registry.load()).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('会话页上的说法：本地分支（来自 <主机> / <原会话>，自 seq N）', () => {
    expect(branchLabel({ kind: 'remote-branch', sessionId: 'session-b1', hostId: 'h@http://a', remoteSessionId: 'session-s1', mirrorSessionId: 'remote-h-session-s1', forkPoint: 9, takenAt: 5, title: '改登录页', hostName: 'A 的 Mac' }))
      .toBe('本地分支（来自 A 的 Mac / 改登录页，自 seq 9）')
  })

  it('分支标题：优先取日志里记下的标题；没有就取第一条真正的用户消息（跳过系统注入的提醒）；都没有为空', () => {
    const reminder = { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '<system-reminder>工作区说明</system-reminder>' }], source: { kind: 'system' } } }
    const question = { type: 'user/message', seq: 1, time: 2, data: { content: [{ type: 'text', text: '把  登录页\n改一下' }], source: { kind: 'user' } } }
    const titled = { type: 'session/title', seq: 2, time: 3, data: { title: '修改登录页' } }
    expect(titleFromEvents([titled, question, reminder])).toBe('修改登录页')
    expect(titleFromEvents([reminder, question])).toBe('把 登录页 改一下')
    expect(titleFromEvents([reminder])).toBe('')
    expect(titleFromEvents([])).toBe('')
  })
})
