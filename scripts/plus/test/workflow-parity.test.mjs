/**
 * 打包流水线对账门禁的单元测试（#145）。
 *
 * 门禁的价值在于「官方新增步骤时 CI 会红」；这里用合成数据把三条不变量各测一遍，
 * 不依赖真实的 workflow 文件内容（那些由 `pnpm run verify:workflow-parity` 覆盖）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcile, stepNames } from '../verify-workflow-parity.mjs'

const PIPELINES = [
  { platform: 'macos', official: ['Install locked dependencies', 'Build signed installers'], ours: ['Install', 'Package'] },
]

test('stepNames：取出步骤名、去引号、去重保序', () => {
  const text = [
    'jobs:',
    '  package:',
    '    steps:',
    '      - name: Install locked dependencies',
    '        run: pnpm install',
    '      - name: "Quoted step"',
    '      - name: Install locked dependencies',
  ].join('\n')
  assert.deepEqual(stepNames(text), ['Install locked dependencies', 'Quoted step'])
})

test('reconcile：官方步骤都有映射时通过', () => {
  const parity = [
    { platform: 'macos', step: 'Install locked dependencies', ours: 'Install' },
    { platform: 'macos', step: 'Build signed installers', ours: 'Package' },
  ]
  assert.deepEqual(reconcile({ pipelines: PIPELINES, parity }), [])
})

test('reconcile：官方新增步骤没有交代时失败', () => {
  const parity = [{ platform: 'macos', step: 'Install locked dependencies', ours: 'Install' }]
  const failures = reconcile({ pipelines: PIPELINES, parity })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /Build signed installers.*missing from/u)
})

test('reconcile：映射到不存在的步骤时失败', () => {
  const parity = [
    { platform: 'macos', step: 'Install locked dependencies', ours: 'Install' },
    { platform: 'macos', step: 'Build signed installers', ours: 'Renamed step' },
  ]
  const failures = reconcile({ pipelines: PIPELINES, parity })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /Renamed step.*not a step in our workflow/u)
})

test('reconcile：豁免必须带理由', () => {
  const parity = [
    { platform: 'macos', step: 'Install locked dependencies', ours: 'Install' },
    { platform: 'macos', step: 'Build signed installers', ours: null },
  ]
  const failures = reconcile({ pipelines: PIPELINES, parity })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /exempted without a reason/u)
})

test('reconcile：官方删掉的步骤留在表里时失败', () => {
  const parity = [
    { platform: 'macos', step: 'Install locked dependencies', ours: 'Install' },
    { platform: 'macos', step: 'Build signed installers', ours: 'Package' },
    { platform: 'macos', step: 'Removed official step', ours: null, reason: 'gone' },
  ]
  const failures = reconcile({ pipelines: PIPELINES, parity })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /Removed official step.*no longer an official step/u)
})

test('reconcile：未知平台失败', () => {
  const parity = [
    { platform: 'macos', step: 'Install locked dependencies', ours: 'Install' },
    { platform: 'macos', step: 'Build signed installers', ours: 'Package' },
    { platform: 'linux', step: 'Whatever', ours: null, reason: 'x' },
  ]
  const failures = reconcile({ pipelines: PIPELINES, parity })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /unknown platform "linux"/u)
})
