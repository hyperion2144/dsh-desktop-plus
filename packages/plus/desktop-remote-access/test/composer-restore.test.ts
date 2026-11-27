import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const client = readFileSync(fileURLToPath(new URL('../client/client.source.jsx', import.meta.url)), 'utf8')
const restore = readFileSync(fileURLToPath(new URL('../client/composer-restore.js', import.meta.url)), 'utf8')

describe('发送失败的正文回到输入框', () => {
  it('prompt 转发失败时把正文退回输入框', () => {
    expect(client).toContain('import { restoreComposer }')
    expect(client).toContain("if (endpoint === 'session/prompt')")
    expect(client).toContain('restoreComposer(promptTextOf(args))')
  })

  it('正文取自 request.content 里 type=text 的片段', () => {
    expect(client).toContain("part.type === 'text'")
  })

  it('受控输入框要走原生 setter，否则会被下一次渲染清掉', () => {
    expect(restore).toContain('Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype')
    expect(restore).toContain("dispatchEvent(new Event('input'")
    expect(restore).toContain('contenteditable="true"')
  })
})
