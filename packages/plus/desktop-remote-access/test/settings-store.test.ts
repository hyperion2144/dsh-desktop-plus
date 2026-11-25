/**
 * 独立发布（#145）：设置落点从壳的 desktop-settings.json 迁到插件自己的
 * $DSH_HOME/storages/remote-access/settings.json。
 *
 * 锁死三条不变量：
 *   1. 不设任何 DSH_* 环境变量也能读写设置（插件装进任意 profile 即用）；
 *   2. 插件设置优先于壳设置；
 *   3. 壳设置里的旧数据仍能读到（一次性迁移来源），但写入只落插件自己的文件。
 */
import { test, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { remoteSettingsPath, readRemoteSetting, writeRemoteSetting, shellSettingsPath, writeShellSetting } from '../src/host/settings.js'

let home: string
const originalHome = process.env.DSH_HOME

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-settings-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  fs.rmSync(home, { recursive: true, force: true })
})

test('设置落点：按 profile 隔离的 storages/remote-access/profiles/<profile>/settings.json', () => {
  // 未设 profile 时回退 default（单 profile 场景行为不变）。
  assert.equal(remoteSettingsPath(), path.join(home, 'storages', 'remote-access', 'profiles', 'default', 'settings.json'))
})

test('设置读写：不依赖壳设置也能往返', () => {
  assert.equal(readRemoteSetting('tunnel_url'), null)
  writeRemoteSetting('tunnel_url', 'https://example.test')
  assert.equal(readRemoteSetting('tunnel_url'), 'https://example.test')
  // 落盘位置是插件自己的文件，不是壳的 desktop-settings.json
  assert.ok(fs.existsSync(remoteSettingsPath()))
  assert.ok(!fs.existsSync(shellSettingsPath()))
})

test('设置优先级：插件设置优先于壳设置', () => {
  writeShellSetting('tunnel_url', 'https://legacy.test')
  assert.equal(readRemoteSetting('tunnel_url'), 'https://legacy.test', '壳里的旧数据仍能读到')
  writeRemoteSetting('tunnel_url', 'https://own.test')
  assert.equal(readRemoteSetting('tunnel_url'), 'https://own.test', '插件设置优先')
})

test('设置写入：只落插件自己的文件，不碰壳设置', () => {
  writeShellSetting('cloudflared_bin', '/legacy/bin')
  writeRemoteSetting('cloudflared_bin', '/own/bin')
  const shell = JSON.parse(fs.readFileSync(shellSettingsPath(), 'utf8')) as Record<string, unknown>
  assert.equal(shell.cloudflared_bin, '/legacy/bin', '壳设置不被改写')
  const own = JSON.parse(fs.readFileSync(remoteSettingsPath(), 'utf8')) as Record<string, unknown>
  assert.equal(own.cloudflared_bin, '/own/bin')
})

test('设置写入：目录不存在时自动创建', () => {
  assert.ok(!fs.existsSync(path.dirname(remoteSettingsPath())))
  writeRemoteSetting('ws_keepalive_ms', 15000)
  assert.ok(fs.existsSync(remoteSettingsPath()))
  assert.equal(readRemoteSetting('ws_keepalive_ms'), '15000')
})

test('设置读取：文件损坏时回退壳设置而不是抛错', () => {
  fs.mkdirSync(path.dirname(remoteSettingsPath()), { recursive: true })
  fs.writeFileSync(remoteSettingsPath(), '{ not json', 'utf8')
  writeShellSetting('tunnel_url', 'https://legacy.test')
  assert.equal(readRemoteSetting('tunnel_url'), 'https://legacy.test')
})
