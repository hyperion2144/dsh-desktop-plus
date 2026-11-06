import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('../client/remote-sync-menu.jsx', import.meta.url)), 'utf8')

describe('会话菜单项跟随官方菜单写法', () => {
  it('行使用官方 MenuItemButton，而不是自己拼 <button>', () => {
    expect(source).toMatch(/from ["']@deepseek-ai\/dsh-client-ui-primitives["']/)
    expect(source).toContain('<MenuItemButton')
    expect(source).not.toMatch(/<button[^>]*style=\{rowStyle\}/)
  })

  it('弹窗用语义 token，不写死深色背景', () => {
    expect(source).toContain('--dsw-alias-bg-layer-1')
    expect(source).not.toContain('--dsw-alias-bg-elevated')
    expect(source).not.toMatch(/#1f1f22/)
  })

  it('带 16px 图标，且没有 emoji', () => {
    expect(source).toContain('<svg width="16" height="16"')
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })
})
