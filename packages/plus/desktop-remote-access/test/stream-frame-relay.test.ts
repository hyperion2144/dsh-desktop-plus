// 流式通道的帧中继（#151）：浏览器 ↔ 本机宿主 ↔ A 机 mux 之间，逐帧把会话 id 换成对面认识的那个。
import { describe, expect, it } from 'vitest'
import { OP_PING, OP_TEXT, decodeFrame, encodeFrame } from '../src/host/ws-frame.js'
import { relayFrames, streamFrameTranslator } from '../src/host/stream-frame-relay.js'

const LOCAL = 'remote-0123456789abcdef-s1'
const REMOTE = 'session-s1'

describe('streamFrameTranslator', () => {
  it('打开帧：参数里的本机镜像 id 换成远端会话 id；别的字段原样保留', () => {
    const toRemote = streamFrameTranslator({ [LOCAL]: REMOTE })
    const text = toRemote(JSON.stringify({ type: 'open', streamId: 'rs-1', endpoint: 'job/list', payload: { args: { request: { sessionId: LOCAL } } } }))
    expect(JSON.parse(text)).toEqual({ type: 'open', streamId: 'rs-1', endpoint: 'job/list', payload: { args: { request: { sessionId: REMOTE } } } })
  })

  it('数据帧：值里的 id 按方向替换（上行换成远端会话 id，下行换回本机镜像 id），嵌套多深都换', () => {
    const toRemote = streamFrameTranslator({ [LOCAL]: REMOTE })
    const toLocal = streamFrameTranslator({ [REMOTE]: LOCAL })
    const up = JSON.parse(toRemote(JSON.stringify({ type: 'item', streamId: 'rs-1', value: { sessionId: LOCAL, nested: { agentId: LOCAL }, text: `提到 ${LOCAL}` } })))
    expect(up.value).toEqual({ sessionId: REMOTE, nested: { agentId: REMOTE }, text: `提到 ${LOCAL}` })
    const down = JSON.parse(toLocal(JSON.stringify({ type: 'item', streamId: 'rs-1', value: { sessionId: REMOTE } })))
    expect(down.value).toEqual({ sessionId: LOCAL })
  })

  it('没有可换的 id、不是 JSON、或别的类型的帧：文本原样返回，不重新序列化', () => {
    const toRemote = streamFrameTranslator({ [LOCAL]: REMOTE })
    const untouched = JSON.stringify({ type: 'open', streamId: 'rs-1', endpoint: 'job/list', payload: { args: { request: { sessionId: 'local-1' } } } })
    expect(toRemote(untouched)).toBe(untouched)
    expect(toRemote('not json')).toBe('not json')
    expect(toRemote(JSON.stringify({ type: 'cancel', streamId: 'rs-1' }))).toBe(JSON.stringify({ type: 'cancel', streamId: 'rs-1' }))
  })
})

describe('relayFrames', () => {
  const toRemote = streamFrameTranslator({ [LOCAL]: REMOTE })

  it('完整的文本帧翻译后按输出方向重新编码；控制帧原样转发；剩下的不完整字节留给下一段', () => {
    const open = encodeFrame(OP_TEXT, Buffer.from(JSON.stringify({ type: 'open', payload: { args: { agentId: LOCAL } } })), { masked: true })
    const ping = encodeFrame(OP_PING, Buffer.from('x'), { masked: true })
    const { out, rest, invalid } = relayFrames(Buffer.concat([open, ping, open.subarray(0, 5)]), toRemote, false)
    expect(invalid).toBe(false)
    expect(out).toHaveLength(2)
    // 输出方向是服务器（写给浏览器）：不带掩码。
    const decoded = decodeFrame(out[0]!, 0)!
    expect(decoded.masked).toBe(false)
    expect(JSON.parse(decoded.payload.toString('utf8'))).toEqual({ type: 'open', payload: { args: { agentId: REMOTE } } })
    const pong = decodeFrame(out[1]!, 0)!
    expect(pong.opcode).toBe(OP_PING)
    expect(pong.payload.toString()).toBe('x')
    expect(rest.equals(open.subarray(0, 5))).toBe(true)
    // 上一段剩下的半帧拼上新数据后能继续解析。
    const again = relayFrames(Buffer.concat([rest, open.subarray(5)]), toRemote, false)
    expect(again.out).toHaveLength(1)
    expect(again.rest.length).toBe(0)
  })

  it('输出方向是客户端（写给 A 机 mux）：帧带掩码', () => {
    const frame = encodeFrame(OP_TEXT, Buffer.from(JSON.stringify({ type: 'open', payload: { args: { sessionId: LOCAL } } })))
    const { out } = relayFrames(frame, toRemote, true)
    const decoded = decodeFrame(out[0]!, 0)!
    expect(decoded.masked).toBe(true)
    expect(JSON.parse(decoded.payload.toString('utf8')).payload.args.sessionId).toBe(REMOTE)
  })

  it('非法的帧头如实报告，由调用方断开连接', () => {
    const { invalid, out } = relayFrames(Buffer.from([0x81, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), toRemote, false)
    expect(invalid).toBe(true)
    expect(out).toEqual([])
  })
})
