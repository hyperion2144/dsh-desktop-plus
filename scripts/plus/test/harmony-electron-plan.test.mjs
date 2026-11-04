import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  injectSigningConfigs,
  isUnsignedHap,
  missingMaterialKeys,
  pickHap,
  planOverlay,
} from '../harmony-electron-plan.mjs'

const MATERIAL = {
  certpath: '/tmp/default.cer',
  keyAlias: 'debugKey',
  keyPassword: '0000',
  profile: '/tmp/default.p7b',
  signAlg: 'SHA256withECDSA',
  storeFile: '/tmp/default.p12',
  storePassword: '0001',
}

// 与钉版模板同形的 build-profile.json5 片段（JSON5：有尾逗号，故意不是合法 JSON）。
const TEMPLATE_PROFILE = [
  '{',
  '  "app": {',
  '    "products": [',
  '      {',
  '        "name": "default",',
  '        "signingConfig": "default",',
  '        "compatibleSdkVersion": "5.0.3(15)",',
  '      },',
  '    ],',
  '    "buildModeSet": [{ "name": "debug" }, { "name": "release" }],',
  '  },',
  '  "modules": [{ "name": "electron", "srcPath": "./electron" }],',
  '}',
  '',
].join('\n')

test('planOverlay：命中与缺失分开报，缺一个就是硬失败', () => {
  const templateFiles = new Set(['a.txt', 'b/c.txt'])
  const planned = planOverlay({ overlayFiles: ['a.txt', 'b/c.txt', 'gone.json'], templateFiles })
  assert.deepEqual(planned.present, ['a.txt', 'b/c.txt'])
  assert.deepEqual(planned.missing, ['gone.json'])
})

test('planOverlay：空覆盖层不算失败', () => {
  const planned = planOverlay({ overlayFiles: [], templateFiles: new Set() })
  assert.deepEqual(planned.present, [])
  assert.deepEqual(planned.missing, [])
})

test('missingMaterialKeys：完整材料没有缺项', () => {
  assert.deepEqual(missingMaterialKeys(MATERIAL), [])
})

test('missingMaterialKeys：缺字段与空字符串都算缺', () => {
  assert.deepEqual(missingMaterialKeys({ ...MATERIAL, profile: '' }), ['profile'])
  assert.deepEqual(missingMaterialKeys({ ...MATERIAL, storeFile: undefined }), ['storeFile'])
  assert.equal(missingMaterialKeys(null).length, 7)
})

test('injectSigningConfigs：注入到 "app": { 之后，其余逐字不动', () => {
  const injected = injectSigningConfigs(TEMPLATE_PROFILE, MATERIAL)
  assert.ok(injected.startsWith('{\n  "app": {\n  "signingConfigs": ['))
  assert.ok(injected.includes('"name": "default"'))
  assert.ok(injected.includes('"certpath": "/tmp/default.cer"'))
  // 注入只加内容，模板原有的每个非空行都还在
  for (const line of TEMPLATE_PROFILE.split('\n').filter((text) => text.trim().length > 0)) {
    assert.ok(injected.includes(line), '丢失了原模板行：' + line)
  }
})

test('injectSigningConfigs：签名块用的是 products 里声明的那个 signingConfig 名', () => {
  const injected = injectSigningConfigs(TEMPLATE_PROFILE.replace('"default",', '"release",'), MATERIAL)
  assert.ok(injected.includes('"name": "release"'))
})

test('injectSigningConfigs：模板已自带 signingConfigs 时拒绝注入', () => {
  const withSigning = TEMPLATE_PROFILE.replace('"app": {', '"app": {\n    "signingConfigs": [],')
  assert.throws(() => injectSigningConfigs(withSigning, MATERIAL), /已有 signingConfigs/)
})

test('injectSigningConfigs：找不到 "app": { 时拒绝注入', () => {
  assert.throws(() => injectSigningConfigs('{ "modules": [] }', MATERIAL), /找不到 "app"/)
})

test('injectSigningConfigs：材料不全时先报缺字段', () => {
  assert.throws(() => injectSigningConfigs(TEMPLATE_PROFILE, { ...MATERIAL, certpath: '' }), /缺字段：certpath/)
})

test('isUnsignedHap：只认 hvigor 的 -unsigned.hap 后缀', () => {
  assert.equal(isUnsignedHap('electron-default-unsigned.hap'), true)
  assert.equal(isUnsignedHap('electron-default.hap'), false)
  assert.equal(isUnsignedHap('electron-default-unsigned.hap.bak'), false)
})

test('pickHap：已签名优先，全未签名时也给一个，空目录返回 null', () => {
  assert.equal(pickHap(['electron-default-unsigned.hap', 'electron-default.hap']), 'electron-default.hap')
  assert.equal(pickHap(['b-unsigned.hap', 'a-unsigned.hap']), 'a-unsigned.hap')
  assert.equal(pickHap(['readme.md']), null)
  assert.equal(pickHap([]), null)
})
