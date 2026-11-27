// 镜像会话 id（#107）：本机镜像会话的 id 带 `remote-` 前缀，由主机与远端会话 id 确定，可校验归属。
// 官方存储按会话 id「一键一文件」落盘（投影缓存等），键名只允许字母、数字、下划线、连字符，
// 所以主机 id 不能原样放进 id 里，改用它的哈希；转发到 A 之前按值逐层换回远端会话 id。
import { describe, expect, it } from 'vitest'
import { isMirrorId, mirrorIdOf, MIRROR_ID_PREFIX, remoteIdOfMirror, replaceSessionIds } from '../src/host/mirror-id.js'

// 主机 id 自带冒号与斜杠（设备 id @ 对端地址），不能原样进会话 id。
const HOST = '0030dfa35f0329d0@http://192.168.1.9:3091'
const OTHER = '9c1f@http://10.0.0.2:3091'

describe('镜像会话 id', () => {
  it('带 remote- 前缀，由主机与远端会话 id 确定，能准确还原', () => {
    const id = mirrorIdOf(HOST, 'session-abc')
    expect(id).toMatch(/^remote-[0-9a-f]{16}-session-abc$/)
    expect(id.startsWith(MIRROR_ID_PREFIX)).toBe(true)
    expect(isMirrorId(id)).toBe(true)
    expect(remoteIdOfMirror(id, HOST)).toBe('session-abc')
  })

  it('只含字母、数字、下划线、连字符：官方按会话 id 一键一文件落盘，别的字符写不进去', () => {
    expect(mirrorIdOf(HOST, 'session-abc')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('同一台主机的 id 段是确定的：同一对（主机，会话）总是得到同一个镜像 id，不同主机不会撞', () => {
    expect(mirrorIdOf(HOST, 's1')).toBe(mirrorIdOf(HOST, 's1'))
    expect(mirrorIdOf(HOST, 's1')).not.toBe(mirrorIdOf(OTHER, 's1'))
  })

  it('远端会话 id 里也有连字符时不会切错', () => {
    expect(remoteIdOfMirror(mirrorIdOf(HOST, 'job-7-step'), HOST)).toBe('job-7-step')
  })

  it('镜像确实带前缀但主机对不上时返回 undefined：宁可拒绝，也不把一个错的 id 发给别的设备', () => {
    expect(remoteIdOfMirror(mirrorIdOf(HOST, 's1'), OTHER)).toBeUndefined()
  })

  it('带前缀但结构不完整（没有主机段、主机段不是十六进制）时返回 undefined', () => {
    expect(remoteIdOfMirror('remote-session-abc', HOST)).toBeUndefined()
    expect(remoteIdOfMirror('remote-zzzzzzzzzzzzzzzz-s1', HOST)).toBeUndefined()
    expect(isMirrorId('session-abc')).toBe(false)
  })

  it('旧版镜像没有前缀：id 本身就是远端会话 id', () => {
    expect(isMirrorId('session-abc')).toBe(false)
    expect(remoteIdOfMirror('session-abc', HOST)).toBe('session-abc')
  })
})

describe('replaceSessionIds', () => {
  const local = mirrorIdOf(HOST, 's1')

  it('把参数里所有等于本机镜像 id 的字符串换成远端会话 id，嵌套多深都找', () => {
    const args = {
      request: { sessionId: local, address: { kind: 'session', sessionId: local }, note: `关于 ${local} 的说明` },
      agentId: local,
      list: [local, 'x', local],
      count: 1,
      ok: true,
      none: null,
    }
    expect(replaceSessionIds(args, { [local]: 's1' })).toEqual({
      request: { sessionId: 's1', address: { kind: 'session', sessionId: 's1' }, note: `关于 ${local} 的说明` },
      agentId: 's1',
      list: ['s1', 'x', 's1'],
      count: 1,
      ok: true,
      none: null,
    })
  })

  it('只替换整串相等的值：正文里顺带提到的 id 原样保留', () => {
    expect(replaceSessionIds({ text: `参见 ${local}` }, { [local]: 's1' })).toEqual({ text: `参见 ${local}` })
  })

  it('不改动传入的参数对象', () => {
    const args = { request: { sessionId: local } }
    replaceSessionIds(args, { [local]: 's1' })
    expect(args.request.sessionId).toBe(local)
  })

  it('没有可替换的值时原样返回同一个对象', () => {
    const args = { request: { sessionId: 'local-session' } }
    expect(replaceSessionIds(args, { [local]: 's1' })).toBe(args)
  })
})
