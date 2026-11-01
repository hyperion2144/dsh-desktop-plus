#!/usr/bin/env node
// 鸿蒙壳的**跨实现对拍**（code-review 修复 P2 / P4）。
//
// 鸿蒙工程没有单测模块（hvigor 的 ohosTest 要真机/模拟器），因此这里在 node 下
// 直接跑**壳的真实 ArkTS 源码**：把 `.ets` 复制成 `.ts`（node 原生剥离类型标注）后导入。
// 跑的是真源码，不是复制品——改了 ArkTS 实现，向量立刻红。
//
// 向量取自仓库里的共享文件（与 node / Kotlin / Swift 同一份）：
//   - scripts/plus/test/mobile-version.vectors.json（版本号规则）
//   - scripts/plus/test/pair-link.vectors.json（配对链接解析）
//
// 另外做一次**桌面 → 壳的往返**：桌面端签发一条链接，壳侧解析出的候选必须与
// 桌面端下发的一致（签发与解析不同实现，靠这条往返锁住）。

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { connect as netConnect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HARMONY_DIR = resolve(HERE, '..')
const REPO_DIR = resolve(HARMONY_DIR, '../..')
const ENTRY_DIR = join(HARMONY_DIR, 'entry/src/main/ets')

let passes = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passes += 1
    console.log(`PASS  ${name}${detail === '' ? '' : ` — ${detail}`}`)
  } else {
    failures.push(name)
    console.log(`FAIL  ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(REPO_DIR, relativePath), 'utf8'))
}

// ── 载入 ArkTS 源码（.ets → .ts，node 原生剥离类型标注）──────────────────────
//
// 整棵源码树都复制成 .ts 并**保留目录结构**：模块之间的相对 import 才解析得了。
// 复制时顺手把具名 import 改成「命名空间 import + 解构」——node 的类型剥离不做
// 类型导入消除，具名导入一个接口会在运行期报 "does not provide an export"。
const workDir = mkdtempSync(join(tmpdir(), 'dsh-harmony-parity-'))

/** 把 .ets 里的具名 import 改写成运行期安全的写法。 */
function rewriteImports(source) {
  let counter = 0
  return source.replace(
    /import\s*\{([^}]*)\}\s*from\s*(['"])(\.[^'"]*)\2/g,
    (match, names, quote, specifier) => {
      const namespace = `__ns${counter++}`
      const target = specifier.endsWith('.ts') ? specifier : `${specifier}.ts`
      const bindings = names
        .split(',')
        .map((raw) => raw.trim())
        .filter((raw) => raw.length > 0)
        .map((raw) => {
          const parts = raw.split(/\s+as\s+/)
          return parts.length === 2
            ? `${parts[0].trim()}: ${parts[1].trim()}`
            : parts[0].trim()
        })
      return (
        `import * as ${namespace} from ${quote}${target}${quote};\n` +
        `const { ${bindings.join(', ')} } = ${namespace};`
      )
    },
  )
}

/** 把一棵目录树里的 .ets 复制成 .ts（保留目录结构）。 */
function copyArkTsTree(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    if (entry.isDirectory()) {
      const target = join(to, entry.name)
      mkdirSync(target, { recursive: true })
      copyArkTsTree(source, target)
    } else if (entry.name.endsWith('.ets')) {
      writeFileSync(
        join(to, `${entry.name.slice(0, -'.ets'.length)}.ts`),
        rewriteImports(readFileSync(source, 'utf8')),
      )
    }
  }
}

copyArkTsTree(ENTRY_DIR, workDir)

async function loadArkTs(relativePath) {
  const target = join(workDir, relativePath.replace(/\.ets$/, '.ts'))
  return import(pathToFileURL(target).href)
}

const version = await loadArkTs('shell/update/MobileVersion.ets')
const channel = await loadArkTs('shell/update/ChannelFeed.ets')
const pair = await loadArkTs('shell/pair/PairLink.ets')

console.log('DSH 鸿蒙壳跨实现对拍')
console.log(`ArkTS 源码：${ENTRY_DIR}`)
console.log('')

// ── 版本号规则 ────────────────────────────────────────────────────────────────

console.log('── 版本号规则（scripts/plus/test/mobile-version.vectors.json）')
const versionVectors = readJson('scripts/plus/test/mobile-version.vectors.json')

for (const expected of versionVectors.parse) {
  let parsed = null
  try {
    parsed = version.parsePlusVersion(expected.version)
  } catch (error) {
    parsed = null
  }
  check(`解析 ${expected.version}`, parsed !== null)
  if (parsed === null) {
    continue
  }
  check(`解析 ${expected.version} 的 major`, parsed.major === expected.major)
  check(`解析 ${expected.version} 的 minor`, parsed.minor === expected.minor)
  check(`解析 ${expected.version} 的 patch`, parsed.patch === expected.patch)
  check(`解析 ${expected.version} 的 plus 计数`, parsed.plus === expected.plus)
  check(`解析 ${expected.version} 的 level`, parsed.level === expected.level)
  check(`解析 ${expected.version} 的预发布标签`, parsed.label === (expected.label ?? ''))
  check(`解析 ${expected.version} 的标签序号`, parsed.rank === (expected.rank ?? -1))
  check(`解析 ${expected.version} 的预发布序号`, parsed.index === (expected.index ?? 0))
  check(
    `推导 ${expected.version} 的 versionCode`,
    version.mobileVersionCode(expected.version) === expected.versionCode,
    String(version.mobileVersionCode(expected.version)),
  )
  check(
    `推导 ${expected.version} 的 CFBundleVersion`,
    version.mobileBundleVersion(expected.version) === expected.bundleVersion,
    version.mobileBundleVersion(expected.version),
  )
}

for (const invalid of versionVectors.invalid) {
  let rejected = false
  try {
    version.parsePlusVersion(invalid)
  } catch (error) {
    rejected = true
  }
  check(`拒绝非法版本 ${invalid}`, rejected)
}

for (const pairCase of versionVectors.compare) {
  let actual = null
  try {
    actual = Math.sign(version.compareVersions(pairCase.left, pairCase.right))
  } catch (error) {
    actual = null
  }
  check(
    `比较 ${pairCase.left} 与 ${pairCase.right}`,
    actual === pairCase.result,
    `得到 ${actual}，期望 ${pairCase.result}`,
  )
}

for (const invalid of versionVectors.compareInvalid) {
  let rejected = false
  try {
    version.compareVersions(invalid, '1.0.0')
  } catch (error) {
    rejected = true
  }
  check(`比较时拒绝 ${invalid}`, rejected)
}

// ── 配对链接 ─────────────────────────────────────────────────────────────────

console.log('')
console.log('── 配对链接（scripts/plus/test/pair-link.vectors.json）')
const pairVectors = readJson('scripts/plus/test/pair-link.vectors.json')

for (const testCase of pairVectors.cases) {
  const link = pair.PairLink.parse(testCase.link)
  check(`解析配对链接 ${testCase.link}`, link !== null)
  if (link === null) {
    continue
  }
  check(`配对链接的令牌`, link.token === testCase.token)
  check(
    `配对链接的候选地址`,
    JSON.stringify(link.candidates) === JSON.stringify(testCase.candidates),
    JSON.stringify(link.candidates),
  )
}

for (const invalid of pairVectors.invalid) {
  check(`拒绝非法配对链接 ${invalid}`, pair.PairLink.parse(invalid) === null)
}

// ── 桌面 → 壳的往返 ──────────────────────────────────────────────────────────

console.log('')
console.log('── 桌面端签发 → 壳侧解析（往返）')
const { buildHttpPairLink, buildPairLink } = await import(
  pathToFileURL(join(REPO_DIR, 'packages/plus/desktop-remote-access/lib/links.mjs')).href
)

const httpLink = buildHttpPairLink('192.168.1.23:3091', 't3', ['my-mac.local:3091', '192.168.1.23:3091'])
const parsedHttp = pair.PairLink.parse(httpLink)
check('http 形态的桌面链接可解析', parsedHttp !== null, httpLink)
if (parsedHttp !== null) {
  check('http 形态的桌面链接令牌', parsedHttp.token === 't3')
  check(
    'http 形态的桌面链接候选（.local + IP）',
    JSON.stringify(parsedHttp.candidates) ===
      JSON.stringify(['http://my-mac.local:3091', 'http://192.168.1.23:3091']),
    JSON.stringify(parsedHttp.candidates),
  )
}

const mobileLink = buildPairLink(['mutsu-mbp.local:3093', '192.168.3.90:3093'], 't4')
const parsedMobile = pair.PairLink.parse(mobileLink)
check('dsh-mobile 形态的桌面链接可解析', parsedMobile !== null, mobileLink)
if (parsedMobile !== null) {
  check(
    'dsh-mobile 形态的桌面链接候选',
    JSON.stringify(parsedMobile.candidates) ===
      JSON.stringify(['http://mutsu-mbp.local:3093', 'http://192.168.3.90:3093']),
    JSON.stringify(parsedMobile.candidates),
  )
}

// ── 更新源（channel yml）解析 ───────────────────────────────────────────────

console.log('')
console.log('── 更新源（channel yml）解析')
const feed = [
  'version: 0.2.2-alpha.2.plus.1',
  'files:',
  '  - url: dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk',
  '    sha512: ZmFrZS1zaGE1MTItc2hhNTEy',
  '    size: 12345',
  'path: dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk',
  "releaseDate: '2026-11-01T00:00:00.000Z'",
].join('\n')
check('channel yml 的版本号', channel.parseChannelVersion(feed) === '0.2.2-alpha.2.plus.1')
check('channel yml 的产物名', channel.parseChannelMetadata(feed).fileName.endsWith('-android.apk'))
check('channel yml 缺版本时取不到', channel.parseChannelVersion('files:\n  - url: a.apk\n') === '')
check('空文本取不到版本', channel.parseChannelVersion('') === '')


// ── 壳的偏好（更新提醒总开关默认开）────────────────────────────────────────
console.log('')
console.log('── 壳的偏好（更新提醒总开关默认开）')
const preferencesModule = await loadArkTs('shell/store/ShellPreferences.ets')
const keyValueModule = await loadArkTs('shell/store/KeyValueStore.ets')
const preferenceStore = new keyValueModule.MemoryKeyValueStore()
const preferences = new preferencesModule.ShellPreferences(preferenceStore)
check('偏好：更新提醒总开关默认开', (await preferences.updateReminderEnabled()) === true)
check('偏好：生物锁默认开', (await preferences.biometricLockEnabled()) === true)
// 已存过的关闭值不被默认值覆盖。
await preferences.setUpdateReminderEnabled(false)
check(
  '偏好：已存过的关闭值不被默认值覆盖',
  (await preferences.updateReminderEnabled()) === false,
)

// ── 配对前的无凭证可达性预检（不可达 → 不发 accept）────────────────────────────
console.log('')
console.log('── 配对前的无凭证可达性预检（不可达 → 不发 accept）')
const reachabilityModule = await loadArkTs('shell/connect/ReachabilityProbe.ets')
const flowModule = await loadArkTs('shell/pair/PairFlow.ets')
const pairOutcomeModule = await loadArkTs('shell/pair/PairOutcome.ets')

/** node 的 TCP 连接实现（对拍里替代平台的 `@ohos.net.socket`）。 */
function nodeTcpConnector(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)
    socket.on('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

/** 找一个当前没人监听的本地端口（先占再放）。 */
async function closedLocalPort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

/** 记 accept 调用次数的假客户端。 */
function spyAcceptor() {
  const calls = []
  return {
    calls,
    accept: async (origin, token) => {
      calls.push({ origin, token })
      const outcome = new pairOutcomeModule.PairOutcome()
      outcome.kind = 'rejected'
      outcome.failure = 'unexpected'
      return outcome
    },
  }
}

const prober = new reachabilityModule.ReachabilityProbe(nodeTcpConnector)

const closedPort = await closedLocalPort()
const closedSpy = spyAcceptor()
const closedResult = await flowModule.runPairing(
  [`http://127.0.0.1:${closedPort}`],
  'secret-token',
  closedSpy,
  prober,
  'DSH 移动端',
)
check(
  '预检：目标不可达 → 不发 accept',
  closedSpy.calls.length === 0,
  `accept 调用 ${closedSpy.calls.length} 次`,
)
check('预检：目标不可达 → 报不可达', closedResult.failure === 'unreachable', closedResult.failure)
check('预检：目标不可达 → 不配对', closedResult.paired === false)

// 目标可达（本地起一个监听端口）：预检通过 → 走 accept。
const live = createServer()
await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve))
const livePort = live.address().port
const liveSpy = spyAcceptor()
await flowModule.runPairing(
  [`http://127.0.0.1:${livePort}`],
  'token',
  liveSpy,
  prober,
  'DSH 移动端',
)
check(
  '预检：目标可达 → 走 accept',
  liveSpy.calls.length === 1,
  `accept 调用 ${liveSpy.calls.length} 次`,
)
await new Promise((resolve) => live.close(resolve))

const lanEndpoint = reachabilityModule.ReachabilityProbe.endpointOf('http://192.168.3.90:3093')
check('预检：origin 拆出主机名', lanEndpoint !== null && lanEndpoint.host === '192.168.3.90')
check('预检：origin 拆出端口', lanEndpoint !== null && lanEndpoint.port === 3093)
check(
  '预检：https 缺省端口 443',
  reachabilityModule.ReachabilityProbe.endpointOf('https://dsh-4f2e.cpolar.io').port === 443,
)
check(
  '预检：地址解析不出 → 不可达',
  reachabilityModule.ReachabilityProbe.endpointOf('http://') === null,
)
// ── 结果 ─────────────────────────────────────────────────────────────────────

console.log('')
if (failures.length === 0) {
  console.log(`全部通过：${passes} 项断言`)
  process.exit(0)
}
console.log(`失败 ${failures.length} 项 / 共 ${passes + failures.length} 项断言`)
for (const failure of failures) {
  console.log(`  - ${failure}`)
}
process.exit(1)
