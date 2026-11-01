import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compare as semverCompare, valid as semverValid } from 'semver'
import { readFileSync } from 'node:fs'
import {
  ANDROID_MAX_VERSION_CODE,
  PRERELEASE_LABELS,
  comparePlusVersions,
  isNewerPlusVersion,
  mobileBundleVersion,
  mobileVersionCode,
  parsePlusVersion,
} from '../mobile-version.mjs'

test('parsePlusVersion：拆出 base / 预发布 / plus 计数', () => {
  assert.deepEqual(parsePlusVersion('0.2.2-alpha.2.plus.9'), {
    major: 0,
    minor: 2,
    patch: 2,
    prerelease: { label: 'alpha', rank: 0, index: 2 },
    plus: 9,
    level: 2,
  })
  // GitHub tag 带 `v` 前缀，比较前先剥掉。
  assert.deepEqual(parsePlusVersion('v0.2.2-alpha.2.plus.9'), parsePlusVersion('0.2.2-alpha.2.plus.9'))
  // 正式版 base（上游不再带 prerelease）：level 取正式版档位 999。
  assert.deepEqual(parsePlusVersion('0.2.2.plus.3'), {
    major: 0,
    minor: 2,
    patch: 2,
    prerelease: null,
    plus: 3,
    level: 999,
  })
  assert.equal(parsePlusVersion('0.2.2').plus, 0)
})

test('parsePlusVersion：拒绝非法输入', () => {
  assert.throws(() => parsePlusVersion(''), /non-empty string/)
  assert.throws(() => parsePlusVersion('0.2.2-alpha'), /prerelease/)
  assert.throws(() => parsePlusVersion('0.2.2-alpha.2.3'), /prerelease/)
  assert.throws(() => parsePlusVersion('0.2.2-preview.1'), /unknown prerelease label/)
  assert.throws(() => parsePlusVersion('0.2.2-alpha.2.plus.010'), /leading zeros/)
  assert.throws(() => parsePlusVersion('0.2.2-alpha.2.plus.0'), /at least 1/)
  assert.throws(() => parsePlusVersion('0.2.2-alpha.2+plus.9'), /build metadata/)
})

test('mobileVersionCode：确定性', () => {
  assert.equal(mobileVersionCode('0.2.2-alpha.2.plus.9'), 20200209)
  assert.equal(mobileVersionCode('0.2.2-alpha.2.plus.9'), mobileVersionCode('0.2.2-alpha.2.plus.9'))
  assert.equal(mobileVersionCode('v0.2.2-alpha.2.plus.9'), 20200209)
})

test('mobileVersionCode：plus.N 进位只动最低位（不是字典序）', () => {
  const nine = mobileVersionCode('0.2.2-alpha.2.plus.9')
  const ten = mobileVersionCode('0.2.2-alpha.2.plus.10')
  assert.equal(ten, 20200210)
  assert.ok(ten > nine, 'plus.10 必须大于 plus.9（数字标识符按数值比较）')
})

test('mobileVersionCode：预发布层级单调（跨上游 alpha）', () => {
  const chain = [
    '0.2.2-alpha.2.plus.9',
    '0.2.2-alpha.2.plus.10',
    '0.2.2-alpha.3.plus.1',
    '0.2.2-alpha.3.plus.2',
    '0.2.2.plus.1',
    '0.2.3-alpha.1.plus.1',
    '0.3.0-alpha.1.plus.1',
  ]
  const codes = chain.map(mobileVersionCode)
  for (let index = 1; index < codes.length; index += 1) {
    assert.ok(codes[index] > codes[index - 1], `${chain[index]} 的构建号必须大于 ${chain[index - 1]}`)
  }
  assert.deepEqual(codes, [20200209, 20200210, 20200301, 20200302, 20299901, 20300101, 30000101])
})

test('mobileVersionCode：始终在 Android 安装上限之内', () => {
  assert.ok(mobileVersionCode('0.2.2-alpha.2.plus.9') < ANDROID_MAX_VERSION_CODE)
  assert.ok(mobileVersionCode('9.9.99-alpha.2.plus.99') < ANDROID_MAX_VERSION_CODE)
})

test('mobileBundleVersion：iOS 形态是 1~3 段点分整数且与 versionCode 同序', () => {
  assert.equal(mobileBundleVersion('0.2.2-alpha.2.plus.9'), '0.2.200209')
  assert.match(mobileBundleVersion('0.2.2-alpha.2.plus.9'), /^\d+(\.\d+){1,2}$/)
  const chain = [
    '0.2.2-alpha.2.plus.9',
    '0.2.2-alpha.2.plus.10',
    '0.2.2-alpha.3.plus.1',
    '0.2.2.plus.1',
    '0.2.3-alpha.1.plus.1',
    '0.3.0-alpha.1.plus.1',
  ]
  const parts = chain.map((version) => mobileBundleVersion(version).split('.').map(Number))
  for (let index = 1; index < parts.length; index += 1) {
    const [left, right] = [parts[index - 1], parts[index]]
    const greater = left[0] !== right[0]
      ? right[0] > left[0]
      : left[1] !== right[1]
        ? right[1] > left[1]
        : right[2] > left[2]
    assert.ok(greater, `${chain[index]} 的 CFBundleVersion 必须大于 ${chain[index - 1]}`)
  }
})

test('comparePlusVersions：复用 semver 的优先级', () => {
  assert.ok(comparePlusVersions('0.2.2-alpha.2.plus.9', '0.2.2-alpha.2.plus.10') < 0)
  assert.ok(comparePlusVersions('0.2.2-alpha.2.plus.10', '0.2.2-alpha.3') < 0)
  assert.ok(comparePlusVersions('0.2.2-alpha.3', '0.2.2') < 0)
  assert.equal(comparePlusVersions('0.2.2-alpha.2.plus.9', '0.2.2-alpha.2.plus.9'), 0)
  assert.equal(isNewerPlusVersion('0.2.2-alpha.2.plus.2', '0.2.2-alpha.2.plus.1'), true)
  assert.equal(isNewerPlusVersion('0.2.2-alpha.2.plus.1', '0.2.2-alpha.2.plus.2'), false)
})

test('SemVer 已知坑①：plus 计数不能补零（§9 禁前导零）', () => {
  // 库本身就把补零版本判为非法——这个行为要锁住，别让谁「顺手补零」。
  assert.equal(semverValid('0.2.2-alpha.2.plus.010'), null)
  assert.throws(() => parsePlusVersion('0.2.2-alpha.2.plus.010'), /leading zeros/)
  assert.throws(
    () => comparePlusVersions('0.2.2-alpha.2.plus.010', '0.2.2-alpha.2.plus.9'),
    /leading zeros/,
  )
})

test('SemVer 已知坑②：.plus.N 不能挪进构建元数据段（§10 不参与比较）', () => {
  // 挪到 `+` 之后，SemVer 认为两个版本**相等**——更新判定会直接失效。
  assert.equal(semverCompare('0.2.2-alpha.2+plus.10', '0.2.2-alpha.2+plus.9'), 0)
  assert.throws(() => parsePlusVersion('0.2.2-alpha.2+plus.10'), /build metadata/)
  assert.throws(
    () => comparePlusVersions('0.2.2-alpha.2+plus.10', '0.2.2-alpha.2+plus.9'),
    /build metadata/,
  )
})

test('PRERELEASE_LABELS：标签表稠密、无重复，且在推导公式的容量之内', () => {
  assert.equal(new Set(PRERELEASE_LABELS).size, PRERELEASE_LABELS.length)
  assert.ok(PRERELEASE_LABELS.length <= 9, '标签序号最多 9 个（level = 序号×100 + 预发布序号，要留得下正式版的 999）')
  // 表里的标签都必须真的能用（rank 即下标）。
  for (const label of PRERELEASE_LABELS) {
    assert.equal(parsePlusVersion(`0.2.2-${label}.1.plus.1`).prerelease.label, label)
  }
})

test('跨实现测试向量：node 侧必须与共享向量一致（Swift / Kotlin / ArkTS 对拍同一份文件）', () => {
  const vectors = JSON.parse(
    readFileSync(new URL('./mobile-version.vectors.json', import.meta.url), 'utf8'),
  )

  for (const expected of vectors.parse) {
    const parsed = parsePlusVersion(expected.version)
    assert.equal(parsed.major, expected.major, `${expected.version} 的 major`)
    assert.equal(parsed.minor, expected.minor, `${expected.version} 的 minor`)
    assert.equal(parsed.patch, expected.patch, `${expected.version} 的 patch`)
    assert.equal(parsed.plus, expected.plus, `${expected.version} 的 plus 计数`)
    assert.equal(parsed.level, expected.level, `${expected.version} 的 level`)
    assert.equal(parsed.prerelease?.label ?? null, expected.label, `${expected.version} 的预发布标签`)
    assert.equal(parsed.prerelease?.rank ?? null, expected.rank, `${expected.version} 的标签序号`)
    assert.equal(parsed.prerelease?.index ?? null, expected.index, `${expected.version} 的预发布序号`)
    assert.equal(mobileVersionCode(expected.version), expected.versionCode, `${expected.version} 的 versionCode`)
    assert.equal(mobileBundleVersion(expected.version), expected.bundleVersion, `${expected.version} 的 CFBundleVersion`)
  }

  for (const invalid of vectors.invalid) {
    assert.throws(() => parsePlusVersion(invalid), undefined, `${invalid} 必须被拒绝`)
    assert.throws(() => mobileVersionCode(invalid), undefined, `${invalid} 必须被拒绝`)
  }

  for (const pair of vectors.compare) {
    assert.equal(
      Math.sign(comparePlusVersions(pair.left, pair.right)),
      pair.result,
      `比较 ${pair.left} 与 ${pair.right}`,
    )
  }

  for (const invalid of vectors.compareInvalid) {
    assert.throws(() => comparePlusVersions(invalid, '1.0.0'), undefined, `${invalid} 比较时必须被拒绝`)
  }
})
