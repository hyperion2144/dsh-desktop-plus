/**
 * 按 profile 隔离（#145）：插件所有状态（配对设备、会话 cookie、隧道地址、
 * 调优参数、访问日志）都落在 `$DSH_HOME/storages/remote-access/profiles/<profile>/`，
 * 不同 profile 之间不串。
 *
 * 为什么必须隔离：同一个 `$DSH_HOME` 下可以并存多个 profile，cookie 不区分端口，
 * 共用一把密钥时桌面 lane 签发的 cookie 在另一个 profile 的 lane 里也会被认。
 */
import { test, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_PROFILE_SCOPE,
  currentProfileScope,
  legacyStorageDir,
  profileStorageDir,
  profileStoragePath,
  remoteAccessRoot,
  setProfileScope,
} from '../src/host/profile-scope.js'
import { remoteSettingsPath, readRemoteSetting, writeRemoteSetting } from '../src/host/settings.js'
import { createFileStorage } from '../src/host/pairing.js'

let home: string
const originalHome = process.env.DSH_HOME

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-scope-'))
  process.env.DSH_HOME = home
  setProfileScope(null)
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  setProfileScope(null)
  fs.rmSync(home, { recursive: true, force: true })
})

test('profile 名：缺省回退 default', () => {
  assert.equal(currentProfileScope(), DEFAULT_PROFILE_SCOPE)
})

test('profile 名：空值与非法字符被净化', () => {
  setProfileScope('  ')
  assert.equal(currentProfileScope(), DEFAULT_PROFILE_SCOPE, '空值不覆盖回退值')
  setProfileScope('my/profile')
  assert.equal(currentProfileScope(), 'my-profile', '路径分隔符被替换，不会逃出目录')
  setProfileScope('desktop')
  assert.equal(currentProfileScope(), 'desktop')
})

test('落点：按 profile 分目录', () => {
  setProfileScope('desktop')
  assert.equal(profileStorageDir(), path.join(home, 'storages', 'remote-access', 'profiles', 'desktop'))
  assert.equal(profileStoragePath('pairing.json'), path.join(home, 'storages', 'remote-access', 'profiles', 'desktop', 'pairing.json'))
  setProfileScope('web')
  assert.equal(profileStorageDir(), path.join(home, 'storages', 'remote-access', 'profiles', 'web'))
})

test('落点：根目录与旧目录不含 profile 段', () => {
  setProfileScope('desktop')
  assert.equal(remoteAccessRoot(), path.join(home, 'storages', 'remote-access'))
  assert.equal(legacyStorageDir(), path.join(home, 'storages', 'remote-access'))
})

test('设置：不同 profile 互不可见', () => {
  setProfileScope('desktop')
  writeRemoteSetting('tunnel_url', 'https://desktop.test')
  assert.equal(readRemoteSetting('tunnel_url'), 'https://desktop.test')

  setProfileScope('web')
  assert.equal(readRemoteSetting('tunnel_url'), null, '另一个 profile 读不到 desktop 的设置')
  writeRemoteSetting('tunnel_url', 'https://web.test')
  assert.equal(readRemoteSetting('tunnel_url'), 'https://web.test')

  setProfileScope('desktop')
  assert.equal(readRemoteSetting('tunnel_url'), 'https://desktop.test', 'desktop 的设置没被 web 覆盖')
})

test('设置：落点是 profile 目录下的 settings.json', () => {
  setProfileScope('desktop')
  assert.equal(remoteSettingsPath(), path.join(home, 'storages', 'remote-access', 'profiles', 'desktop', 'settings.json'))
})

test('配对存储：不同 profile 各写各的 pairing.json', () => {
  setProfileScope('desktop')
  const desktop = createFileStorage()
  assert.equal(desktop.path, path.join(home, 'storages', 'remote-access', 'profiles', 'desktop', 'pairing.json'))

  setProfileScope('web')
  const web = createFileStorage()
  assert.equal(web.path, path.join(home, 'storages', 'remote-access', 'profiles', 'web', 'pairing.json'))

  assert.notEqual(desktop.path, web.path, '两个 profile 的配对文件必须不同')
})

test('配对存储：一个 profile 的设备不会出现在另一个 profile', () => {
  setProfileScope('desktop')
  const desktop = createFileStorage()
  desktop.save({ token: 'tok-desktop', tokenExpiresAt: Date.now() + 60_000, devices: [] })

  setProfileScope('web')
  const web = createFileStorage()
  const loaded = web.load()
  assert.equal(loaded, null, 'web 读不到 desktop 的配对状态')
})
