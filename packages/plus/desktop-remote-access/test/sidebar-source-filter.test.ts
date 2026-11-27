// 侧栏来源过滤的纯逻辑（#149）：本地 / 远程 / 全部三种视图怎么判、怎么记、怎么和主题插件互斥。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_SOURCE,
  SIDEBAR_SOURCES,
  detectThemeDropdown,
  isRemoteWorkspace,
  parseSidebarSource,
  rowVisibleInSource,
  sidebarSourceStorageKey,
  workspaceIdOfRowKey,
} from '../client/sidebar-source-filter.js'

/** 极简的假根：querySelectorAll('*') 返回给定元素，元素只带属性名。 */
function fakeRoot(elements) {
  return { querySelectorAll: (selector) => (selector === '*' ? elements : []), evaluate: undefined }
}
const el = (...names) => ({ attributes: names.map((name) => ({ name })) })

describe('来源取值', () => {
  it('只有 全部 / 本地 / 远程 三种，缺省全部', () => {
    expect(SIDEBAR_SOURCES.map((item) => item.value)).toEqual(['all', 'local', 'remote'])
    expect(SIDEBAR_SOURCES.map((item) => item.label)).toEqual(['全部', '本地', '远程'])
    expect(DEFAULT_SIDEBAR_SOURCE).toBe('all')
    expect(parseSidebarSource('remote')).toBe('remote')
    expect(parseSidebarSource('local')).toBe('local')
    expect(parseSidebarSource('nope')).toBe('all')
    expect(parseSidebarSource(undefined)).toBe('all')
  })

  it('记住上次选择时按 profile 隔离；没有 profile 名时落到 default', () => {
    expect(sidebarSourceStorageKey('desktop')).not.toBe(sidebarSourceStorageKey('web'))
    expect(sidebarSourceStorageKey('')).toBe(sidebarSourceStorageKey(undefined))
    expect(sidebarSourceStorageKey('desktop')).toContain('desktop')
  })
})

describe('按标记判定', () => {
  const known = { workspaces: new Set(['w-remote']), sessions: new Set(['remote-abc-s1']) }

  it('工作区行：id 在远程工作区集合里才算远程；会话行不是工作区', () => {
    expect(workspaceIdOfRowKey('workspace:w-remote')).toBe('w-remote')
    expect(workspaceIdOfRowKey('session:w-remote')).toBe('')
    expect(isRemoteWorkspace('w-remote', known)).toBe(true)
    expect(isRemoteWorkspace('w-local', known)).toBe(false)
    expect(isRemoteWorkspace('', known)).toBe(false)
    expect(isRemoteWorkspace('w-remote', undefined)).toBe(false)
  })
})

describe('三种视图下是否可见', () => {
  it('全部都显示；本地只显示非远程；远程只显示远程', () => {
    expect([true, false].map((remote) => rowVisibleInSource('all', remote))).toEqual([true, true])
    expect([true, false].map((remote) => rowVisibleInSource('local', remote))).toEqual([false, true])
    expect([true, false].map((remote) => rowVisibleInSource('remote', remote))).toEqual([true, false])
  })
})

describe('与主题插件的互斥', () => {
  it('任一元素的属性名以 data-dsh-claude- 开头即判定主题下拉在场，并报出是哪个属性', () => {
    const root = fakeRoot([el('class'), el('data-row-key', 'data-dsh-claude-workspace-tabs'), el('id')])
    expect(detectThemeDropdown(root)).toBe('data-dsh-claude-workspace-tabs')
  })

  it('没有主题插件的标记、或根本没有根：视为不在场', () => {
    expect(detectThemeDropdown(fakeRoot([el('class'), el('data-row-key')]))).toBeNull()
    expect(detectThemeDropdown(null)).toBeNull()
    expect(detectThemeDropdown(undefined)).toBeNull()
  })
})
