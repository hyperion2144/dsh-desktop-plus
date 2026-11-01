import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MOBILE_CHANNEL,
  mobileArtifactName,
  mobileChannelFileName,
  mobileChannelFiles,
  mobileChannelMetadata,
  renderChannelMetadata,
} from '../mobile-metadata.mjs'
import { mobileVersionCode } from '../mobile-version.mjs'

const VERSION = '0.2.2-alpha.2.plus.1'
const RELEASE_DATE = '2026-10-31T12:24:24.528Z'
const ANDROID_SHA512 = Buffer.alloc(64, 0x11).toString('base64')
const IOS_SHA512 = Buffer.alloc(64, 0x22).toString('base64')

const ARTIFACTS = [
  { platform: 'android', sha512: ANDROID_SHA512, size: 12_345_678 },
  { platform: 'ios', sha512: IOS_SHA512, size: 9_876_543 },
]

test('mobileChannelFiles：各平台一份元数据，形态与桌面 channel yml 一致', () => {
  const files = mobileChannelFiles({ version: VERSION, artifacts: ARTIFACTS, releaseDate: RELEASE_DATE })
  assert.deepEqual(Object.keys(files), ['android', 'ios'])
  assert.equal(files.android.filename, 'nightly-android.yml')
  assert.equal(files.ios.filename, 'nightly-ios.yml')
  assert.equal(
    files.android.contents,
    [
      'version: 0.2.2-alpha.2.plus.1',
      'files:',
      '  - url: dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk',
      `    sha512: ${ANDROID_SHA512}`,
      '    size: 12345678',
      'path: dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk',
      `sha512: ${ANDROID_SHA512}`,
      "releaseDate: '2026-10-31T12:24:24.528Z'",
      '',
    ].join('\n'),
  )
  assert.equal(
    files.ios.contents,
    [
      'version: 0.2.2-alpha.2.plus.1',
      'files:',
      '  - url: dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-ios.ipa',
      `    sha512: ${IOS_SHA512}`,
      '    size: 9876543',
      'path: dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-ios.ipa',
      `sha512: ${IOS_SHA512}`,
      "releaseDate: '2026-10-31T12:24:24.528Z'",
      '',
    ].join('\n'),
  )
})

test('mobileChannelMetadata：字段与桌面 channel yml 逐字同形', () => {
  const metadata = mobileChannelMetadata({
    version: VERSION,
    platform: 'android',
    artifact: ARTIFACTS[0],
    releaseDate: RELEASE_DATE,
  })
  assert.deepEqual(Object.keys(metadata), ['version', 'files', 'path', 'sha512', 'releaseDate'])
  assert.deepEqual(Object.keys(metadata.files[0]), ['url', 'sha512', 'size'])
  assert.equal(metadata.version, VERSION)
  assert.equal(metadata.files[0].sha512, metadata.sha512)
  assert.equal(metadata.path, metadata.files[0].url)
  // 渲染出来的 YAML 就是元数据文件的内容（桌面那一侧也是「先有元数据、再 dump 成 yml」）。
  const rendered = renderChannelMetadata(metadata)
  assert.ok(rendered.startsWith('version: 0.2.2-alpha.2.plus.1\nfiles:\n'))
  assert.ok(rendered.endsWith("releaseDate: '2026-10-31T12:24:24.528Z'\n"))
})

test('mobileChannelFiles：确定性（同样输入 → 逐字同样的输出）', () => {
  const first = mobileChannelFiles({ version: VERSION, artifacts: ARTIFACTS, releaseDate: RELEASE_DATE })
  const second = mobileChannelFiles({ version: VERSION, artifacts: ARTIFACTS, releaseDate: RELEASE_DATE })
  assert.deepEqual(first, second)
})

test('mobileArtifactName / mobileChannelFileName：命名由平台与版本推出', () => {
  assert.equal(mobileArtifactName('android', VERSION), 'dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk')
  assert.equal(mobileArtifactName('ios', VERSION), 'dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-ios.ipa')
  assert.equal(mobileChannelFileName('android'), `${DEFAULT_MOBILE_CHANNEL}-android.yml`)
  assert.equal(mobileChannelFileName('ios', 'beta'), 'beta-ios.yml')
})

test('mobileChannelFiles：渠道名可切换（桌面用 nightly）', () => {
  const files = mobileChannelFiles({
    version: VERSION,
    artifacts: ARTIFACTS,
    releaseDate: RELEASE_DATE,
    channel: 'beta',
  })
  assert.equal(files.android.filename, 'beta-android.yml')
  assert.equal(files.ios.filename, 'beta-ios.yml')
})

test('mobileChannelMetadata：releaseDate 归一化成毫秒精度的 ISO 串', () => {
  const metadata = mobileChannelMetadata({
    version: VERSION,
    platform: 'android',
    artifact: ARTIFACTS[0],
    releaseDate: new Date('2026-10-31T12:24:24.528Z'),
  })
  assert.equal(metadata.releaseDate, RELEASE_DATE)
  assert.throws(
    () =>
      mobileChannelMetadata({
        version: VERSION,
        platform: 'android',
        artifact: ARTIFACTS[0],
        releaseDate: 'not-a-date',
      }),
    /invalid release date/,
  )
})

test('mobileChannelFiles：非法输入被拒', () => {
  assert.throws(
    () => mobileChannelFiles({ version: VERSION, artifacts: [], releaseDate: RELEASE_DATE }),
    /at least one platform artifact/,
  )
  assert.throws(
    () =>
      mobileChannelFiles({
        version: VERSION,
        artifacts: [{ platform: 'harmony', sha512: ANDROID_SHA512, size: 1 }],
        releaseDate: RELEASE_DATE,
      }),
    /unknown mobile platform/,
  )
  assert.throws(
    () =>
      mobileChannelFiles({
        version: VERSION,
        artifacts: [ARTIFACTS[0], ARTIFACTS[0]],
        releaseDate: RELEASE_DATE,
      }),
    /duplicate mobile artifact/,
  )
  assert.throws(
    () =>
      mobileChannelFiles({
        version: '0.2.2-alpha.2.plus.010',
        artifacts: ARTIFACTS,
        releaseDate: RELEASE_DATE,
      }),
    /leading zeros/,
  )
  assert.throws(
    () =>
      mobileChannelMetadata({
        version: VERSION,
        platform: 'android',
        artifact: { platform: 'android', sha512: 'not-base64', size: 1 },
        releaseDate: RELEASE_DATE,
      }),
    /sha512/,
  )
  assert.throws(
    () =>
      mobileChannelMetadata({
        version: VERSION,
        platform: 'android',
        artifact: { platform: 'android', sha512: ANDROID_SHA512, size: 0 },
        releaseDate: RELEASE_DATE,
      }),
    /size/,
  )
})

test('元数据里的版本能推出移动端安装版本号（客户端本地算即可）', () => {
  const files = mobileChannelFiles({ version: VERSION, artifacts: ARTIFACTS, releaseDate: RELEASE_DATE })
  const version = files.android.contents.split('\n')[0].replace('version: ', '')
  assert.equal(version, VERSION)
  assert.equal(mobileVersionCode(version), 20200201)
})
