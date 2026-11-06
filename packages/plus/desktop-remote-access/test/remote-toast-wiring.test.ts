import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const client = readFileSync(fileURLToPath(new URL('../client/client.source.jsx', import.meta.url)), 'utf8')
const toast = readFileSync(fileURLToPath(new URL('../client/remote-toast.js', import.meta.url)), 'utf8')
const gate = readFileSync(fileURLToPath(new URL('../client/remote-gate.js', import.meta.url)), 'utf8')

describe('远程调用被拒或失败必须看得见', () => {
  it('被拒时弹提示，且只在用户主动发起的调用上', () => {
    expect(client).toContain('from "./remote-toast.js"')
    expect(client).toContain('if (verdict.notify) showRemoteToast(verdict.message);')
    // 后台轮询类被拒不弹，免得刷屏。
    expect(gate).toContain('notify: USER_INITIATED.has(endpoint)')
  })

  it('提示层挂在自己的浮层上，不依赖官方组件树', () => {
    expect(toast).toContain("document.querySelector('[' + CONTAINER_ATTR + ']')")
    expect(toast).toContain('position:fixed')
  })
})
