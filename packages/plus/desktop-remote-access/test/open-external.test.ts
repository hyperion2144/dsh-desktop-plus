// 「在浏览器打开该设备的 DSH」的打开方式（#150）：桌面壳在场走系统浏览器，否则新标签页。
import { describe, expect, it } from 'vitest'
import { openInSystemBrowser } from '../client/open-external.js'

describe('openInSystemBrowser', () => {
  it('桌面壳在场：经壳通道用系统浏览器打开，命令是 open_external', async () => {
    const calls = []
    const env = { shellChannelRpc: async (endpoint, payload) => { calls.push([endpoint, payload]) }, open: () => { throw new Error('不该走到这里') } }
    expect(await openInSystemBrowser('http://10.0.0.5:3091/__dsh-mobile/webui?ticket=t', env)).toBe('external')
    expect(calls).toEqual([['shell.invoke', { method: 'open_external', params: { url: 'http://10.0.0.5:3091/__dsh-mobile/webui?ticket=t' } }]])
  })

  it('纯浏览器或壳通道失败：退回新标签页，带 noopener', async () => {
    const opened = []
    const env = { open: (...args) => { opened.push(args); return {} } }
    expect(await openInSystemBrowser('http://a/', env)).toBe('window')
    expect(opened).toEqual([['http://a/', '_blank', 'noopener,noreferrer']])
    const failing = { shellChannelRpc: async () => { throw new Error('shell rpc unavailable') }, open: (...args) => { opened.push(args); return null } }
    expect(await openInSystemBrowser('http://b/', failing)).toBe('window')
    expect(opened).toHaveLength(2)
  })

  it('两种方式都没有：明确报错，不静默', async () => {
    await expect(openInSystemBrowser('http://c/', {})).rejects.toThrow('无法打开外部链接')
  })
})
