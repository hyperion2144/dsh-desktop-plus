// 镜像缓存（#107）：A 的会话事件在本机的顺序副本，带 seq 水位。
// 它支撑三件事：重启后从水位续传、离线时仍可读、接管与回推时的种子与前缀。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMirrorCache, type MirrorCache } from '../src/host/remote-mirror-cache.js'
import type { RemoteSessionEvent } from '../src/host/remote-sessions.js'

const HOST = '0030dfa35f0329d0@http://192.168.1.9:3091'
const META = { hostId: HOST, sessionId: 's1', cwd: '/Users/a/proj', createdAt: 1700000000000 }

function event(seq: number, text: string): RemoteSessionEvent {
  return { type: 'assistant/message', seq, time: 1000 + seq, data: { text }, surfaceOp: 'append' }
}

describe('镜像缓存', () => {
  const roots: string[] = []

  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

  const open = (): { cache: MirrorCache, root: string } => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-cache-'))
    roots.push(root)
    return { cache: createMirrorCache(root), root }
  }

  it('没有缓存时读不到，水位是 -1', () => {
    const { cache } = open()
    expect(cache.read(HOST, 's1')).toBeUndefined()
    expect(cache.watermark(HOST, 's1')).toBe(-1)
  })

  it('追加后能按原顺序读回，水位是最后一条事件的 seq', () => {
    const { cache } = open()
    cache.append(META, [event(0, 'a'), event(1, 'b')])
    cache.append(META, [event(2, 'c')])
    const snapshot = cache.read(HOST, 's1')
    expect(snapshot?.events.map((item) => item.seq)).toEqual([0, 1, 2])
    expect(snapshot?.events[2]?.data).toEqual({ text: 'c' })
    expect(snapshot?.meta.cwd).toBe('/Users/a/proj')
    expect(cache.watermark(HOST, 's1')).toBe(2)
  })

  it('重启后缓存还在：新实例读出同样的事件与水位，续传就从这里开始', () => {
    const { cache, root } = open()
    cache.append(META, [event(0, 'a'), event(1, 'b'), event(2, 'c')])
    const restarted = createMirrorCache(root)
    expect(restarted.watermark(HOST, 's1')).toBe(2)
    expect(restarted.read(HOST, 's1')?.events).toHaveLength(3)
  })

  it('主机 id 带斜杠和冒号也能落盘；不同主机、不同会话互不覆盖', () => {
    const { cache } = open()
    cache.append(META, [event(0, 'a')])
    cache.append({ ...META, sessionId: 's2' }, [event(0, 'x'), event(1, 'y')])
    cache.append({ ...META, hostId: 'other@http://10.0.0.2:3091' }, [event(0, 'z'), event(1, 'z2')])
    expect(cache.watermark(HOST, 's1')).toBe(0)
    expect(cache.watermark(HOST, 's2')).toBe(1)
    expect(cache.watermark('other@http://10.0.0.2:3091', 's1')).toBe(1)
  })

  it('最后一行写了一半（断电 / 崩溃）：丢弃残缺行，其余照常读出', () => {
    const { cache, root } = open()
    cache.append(META, [event(0, 'a'), event(1, 'b')])
    const file = path.join(root, 'remote-sessions', encodeURIComponent(HOST), 's1.jsonl')
    fs.appendFileSync(file, '{"seq":2,"time":1002,"type":"assistant/mess')
    const snapshot = cache.read(HOST, 's1')
    expect(snapshot?.events.map((item) => item.seq)).toEqual([0, 1])
    expect(cache.watermark(HOST, 's1')).toBe(1)
  })

  it('元信息缺失或文件为空时读不到', () => {
    const { cache, root } = open()
    const file = path.join(root, 'remote-sessions', encodeURIComponent(HOST), 's1.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
    expect(cache.read(HOST, 's1')).toBeUndefined()
  })

  it('移除后读不到，再追加相当于重新开始', () => {
    const { cache } = open()
    cache.append(META, [event(0, 'a')])
    cache.remove(HOST, 's1')
    expect(cache.read(HOST, 's1')).toBeUndefined()
    cache.append(META, [event(0, 'fresh')])
    expect(cache.read(HOST, 's1')?.events.map((item) => item.data)).toEqual([{ text: 'fresh' }])
  })
})
