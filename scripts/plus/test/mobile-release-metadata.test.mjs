import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { generateMobileReleaseMetadata, parseArguments } from '../release/mobile-release-metadata.mjs'
import { digestArtifact } from '../release/artifact-digest.mjs'
import { parseChannelMetadata, resolveArtifactUrl } from '../release/verify-mobile-release.mjs'

const VERSION = '0.2.2-alpha.2.plus.2'
const RELEASE_DATE = '2026-11-01T04:00:00.000Z'

/** 造一份产物文件，返回它的路径与摘要。 */
function makeArtifact(directory, name, bytes) {
  const path = join(directory, name)
  writeFileSync(path, bytes)
  return { path, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length }
}

test('digestArtifact：sha512（base64）与字节数取自同一份字节', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'impl66-digest-'))
  const bytes = Buffer.from('dsh-plus-upload')
  const artifact = makeArtifact(directory, 'app.apk', bytes)
  const digest = await digestArtifact(artifact.path)
  assert.equal(digest.sha512, artifact.sha512)
  assert.equal(digest.size, artifact.size)
})

test('parseArguments：参数形状与缺省', () => {
  const options = parseArguments([
    '--version',
    VERSION,
    '--out-dir',
    'out',
    '--artifact',
    'android=build/app-release.apk',
    '--artifact',
    'ios=build/DshMobile.ipa',
    '--channel',
    'beta',
    '--release-date',
    RELEASE_DATE,
  ])
  assert.equal(options.version, VERSION)
  assert.equal(options.outDir, 'out')
  assert.equal(options.channel, 'beta')
  assert.equal(options.releaseDate, RELEASE_DATE)
  assert.deepEqual(options.artifacts, [
    { platform: 'android', path: 'build/app-release.apk' },
    { platform: 'ios', path: 'build/DshMobile.ipa' },
  ])
})

test('parseArguments：缺参数与非法参数被拒', () => {
  assert.throws(() => parseArguments(['--out-dir', 'out']), /missing --version/)
  assert.throws(() => parseArguments(['--version', VERSION]), /missing --out-dir/)
  assert.throws(() => parseArguments(['--version', VERSION, '--out-dir', 'out']), /missing --artifact/)
  assert.throws(() => parseArguments(['--version', VERSION, '--out-dir', 'out', '--artifact', 'android']), /platform/)
  assert.throws(() => parseArguments(['--version', VERSION, '--out-dir', 'out', '--wat']), /unknown argument/)
  assert.throws(() => parseArguments(['--version']), /needs a value/)
})

test('generateMobileReleaseMetadata：两份元数据 + 一份清单', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'impl66-metadata-'))
  const apk = makeArtifact(directory, 'app-release.apk', Buffer.from('apk-bytes'))
  const ipa = makeArtifact(directory, 'DshMobile.ipa', Buffer.from('ipa-bytes'))
  const { files, summary } = await generateMobileReleaseMetadata({
    version: VERSION,
    outDir: directory,
    channel: 'nightly',
    releaseDate: RELEASE_DATE,
    artifacts: [
      { platform: 'android', path: apk.path },
      { platform: 'ios', path: ipa.path },
    ],
  })

  assert.deepEqual(Object.keys(files), ['android', 'ios'])
  assert.equal(files.android.filename, 'nightly-android.yml')
  assert.equal(files.ios.filename, 'nightly-ios.yml')

  // 元数据里的产物名 = 清单里的资产名 = Release 上的资产名（唯一事实源在生成器）。
  const androidAsset = `dsh-desktop-plus-mobile-${VERSION}-android.apk`
  const iosAsset = `dsh-desktop-plus-mobile-${VERSION}-ios.ipa`
  assert.equal(summary.artifacts[0].assetName, androidAsset)
  assert.equal(summary.artifacts[1].assetName, iosAsset)
  assert.equal(summary.artifacts[0].sha512, apk.sha512)
  assert.equal(summary.artifacts[1].sha512, ipa.sha512)
  assert.equal(summary.artifacts[0].size, apk.size)
  assert.equal(summary.artifacts[1].size, ipa.size)
  assert.equal(summary.artifacts[0].metadata, 'nightly-android.yml')
  assert.equal(summary.artifacts[1].metadata, 'nightly-ios.yml')

  const contents = files.android.contents
  assert.ok(contents.startsWith(`version: ${VERSION}\nfiles:\n`))
  assert.ok(contents.includes(`  - url: ${androidAsset}\n`))
  assert.ok(contents.includes(`    sha512: ${apk.sha512}\n`))
  assert.ok(contents.includes(`    size: ${apk.size}\n`))
  assert.ok(contents.includes(`path: ${androidAsset}\n`))
  assert.ok(contents.includes(`releaseDate: '${RELEASE_DATE}'\n`))
})

test('generateMobileReleaseMetadata：接错平台产物被拒', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'impl66-metadata-'))
  const apk = makeArtifact(directory, 'app-release.apk', Buffer.from('apk-bytes'))
  await assert.rejects(
    () =>
      generateMobileReleaseMetadata({
        version: VERSION,
        outDir: directory,
        releaseDate: RELEASE_DATE,
        artifacts: [{ platform: 'ios', path: apk.path }],
      }),
    /must be a \.ipa file/,
  )
})

test('parseChannelMetadata：读回生成的元数据（独立实现，形状必须对得上）', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'impl66-metadata-'))
  const apk = makeArtifact(directory, 'app-release.apk', Buffer.from('apk-bytes'))
  const { files } = await generateMobileReleaseMetadata({
    version: VERSION,
    outDir: directory,
    releaseDate: RELEASE_DATE,
    artifacts: [{ platform: 'android', path: apk.path }],
  })
  const metadata = parseChannelMetadata(files.android.contents)
  assert.equal(metadata.version, VERSION)
  assert.equal(metadata.path, `dsh-desktop-plus-mobile-${VERSION}-android.apk`)
  assert.equal(metadata.files.length, 1)
  assert.equal(metadata.files[0].url, `dsh-desktop-plus-mobile-${VERSION}-android.apk`)
  assert.equal(metadata.files[0].sha512, apk.sha512)
  assert.equal(metadata.files[0].size, apk.size)
  assert.equal(metadata.releaseDate, RELEASE_DATE)
})

test('parseChannelMetadata：不成形的元数据被拒', () => {
  assert.throws(() => parseChannelMetadata('files:\n  - url: a.apk\n'), /missing version/)
  assert.throws(() => parseChannelMetadata('version: 1.0.0\n'), /missing path/)
  assert.throws(() => parseChannelMetadata('version: 1.0.0\npath: a.apk\n'), /missing files/)
})

test('resolveArtifactUrl：产物地址相对 feed 目录（壳的拼接规则）', () => {
  const feed = 'https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/nightly-android.yml'
  assert.equal(
    resolveArtifactUrl(feed, 'dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.2-android.apk'),
    'https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.2-android.apk',
  )
  assert.equal(
    resolveArtifactUrl('http://10.0.2.2:8765/nightly-android.yml', 'a.apk'),
    'http://10.0.2.2:8765/a.apk',
  )
})

test('生成的元数据落在输出目录里（CLI 的落盘形状）', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'impl66-metadata-'))
  const apk = makeArtifact(directory, 'app-release.apk', Buffer.from('apk-bytes'))
  const { files } = await generateMobileReleaseMetadata({
    version: VERSION,
    outDir: directory,
    releaseDate: RELEASE_DATE,
    artifacts: [{ platform: 'android', path: apk.path }],
  })
  // 读回文件内容：证明落盘的就是渲染出来的那份（不另有一套模板）。
  const written = readFileSync(join(directory, files.android.filename), 'utf8')
  assert.equal(written, files.android.contents)
})
