#!/usr/bin/env node
// 构建「Electron on HarmonyOS」的 HAP。
//
// 这条路线（#96 选型 C）的宿主运行时不是我们的代码：OpenHarmony SIG 的 Electron 移植
// 由社区模板 ohosvscode/ohos_electron_hap 提供（Electron 运行时 SO + Chromium 资源 +
// ArkTS 适配层）。所以这里的做法是**不改模板、只叠覆盖层**：
//
//   下载钉版模板（.plus/tmp/harmony-electron/cache/<ref>）
//     → 同步到构建目录（.plus/tmp/harmony-electron/build）
//     → 叠 overlay/（我们的资源与清单）
//     → 换掉 resources/app（我们的 Electron 应用）
//     → 可选注入 signingConfigs
//     → hvigorw assembleHap
//     → 产物收进 dist/harmony-electron/
//
// 模板与运行时 SO 合计约 300 MiB，全部落在 .plus/tmp（不入库）；仓库里只有我们的覆盖层。
//
// 用法：
//   node scripts/plus/build-harmony-electron.mjs                 # 构建（未签名）
//   node scripts/plus/build-harmony-electron.mjs --check         # 只校验覆盖层能否命中模板
//   node scripts/plus/build-harmony-electron.mjs --dry           # 只打印计划
//   node scripts/plus/build-harmony-electron.mjs --signing sign.json
//   node scripts/plus/build-harmony-electron.mjs --app <dir>     # 换真实 app 产物目录
//   node scripts/plus/build-harmony-electron.mjs --skip-download # 只用已缓存的模板
//   node scripts/plus/build-harmony-electron.mjs --ohpm <path>     # 指定 ohpm（默认取 DevEco 自带）
//
// --signing 的 JSON 就是 hvigor 的 material 块（字段见 harmony-electron-plan.mjs）：
//   { "certpath": "...cer", "keyAlias": "debugKey", "keyPassword": "...",
//     "profile": "...p7b", "signAlg": "SHA256withECDSA",
//     "storeFile": "...p12", "storePassword": "..." }
//
// 签名材料**不入库**：debug profile 绑 bundle 名与设备 UDID，是个人证书，属于本机状态。

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { injectSigningConfigs, isUnsignedHap, pickHap, planOverlay } from './harmony-electron-plan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PROJECT_DIR = join(ROOT, 'mobile/harmony-electron')
const SCRATCH_DIR = join(ROOT, '.plus/tmp/harmony-electron')
const OUT_DIR = join(ROOT, 'dist/harmony-electron')

const DEFAULT_DEVECO_SDK = '/Applications/DevEco-Studio.app/Contents/sdk'
const DEFAULT_HVIGOR = '/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw'
const DEFAULT_OHPM = '/Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm'

/** 构建产物里 HAP 的落点（相对构建目录）。 */
function hapOutputDir(moduleName) {
  return join(moduleName, 'build/default/outputs/default')
}

function parseArgs(argv) {
  const options = {
    check: false,
    dry: false,
    skipDownload: false,
    appDir: null,
    signing: null,
    bundle: null,
    devecSdk: process.env.DEVECO_SDK_HOME || DEFAULT_DEVECO_SDK,
    hvigor: process.env.HVIGORW || DEFAULT_HVIGOR,
    ohpm: process.env.OHPM || DEFAULT_OHPM,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.check = true
    else if (arg === '--dry') options.dry = true
    else if (arg === '--skip-download') options.skipDownload = true
    else if (arg === '--app') options.appDir = resolve(ROOT, argv[(index += 1)])
    else if (arg === '--signing') options.signing = resolve(ROOT, argv[(index += 1)])
    else if (arg === '--devec-sdk') options.devecSdk = argv[(index += 1)]
    else if (arg === '--hvigor') options.hvigor = argv[(index += 1)]
    else if (arg === '--ohpm') options.ohpm = argv[(index += 1)]
    else if (arg === '--bundle') options.bundle = argv[(index += 1)]
    else fail('未知参数 ' + arg)
  }
  return options
}

function log(message) {
  console.log('  ' + message)
}

function step(title) {
  console.log('\n▸ ' + title)
}

function fail(message) {
  console.error('\n✗ ' + message)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error }
}

async function walkFiles(dir, base = dir, out = new Map()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walkFiles(full, base, out)
    else if (entry.isFile()) out.set(relative(base, full).split(sep).join('/'), full)
  }
  return out
}

/** 复制目录。macOS 上优先 APFS 克隆（cp -Rc），几秒级；失败再退普通复制。 */
function copyTree(from, to) {
  const cloned = run('cp', ['-Rc', from, to])
  if (cloned.status === 0) return
  const plain = run('cp', ['-R', from, to])
  if (plain.status !== 0) fail('复制失败：' + from + ' → ' + to + '\n' + (plain.stderr || plain.error))
}

function sha256OfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function humanSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GiB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MiB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KiB'
  return bytes + ' B'
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const spec = JSON.parse(await readFile(join(PROJECT_DIR, 'template.json'), 'utf8'))
  const { template, overlay, app } = spec
  const cacheDir = join(SCRATCH_DIR, 'cache', template.ref)
  const buildDir = join(SCRATCH_DIR, 'build')
  const appDir = options.appDir ?? join(PROJECT_DIR, app.dir)

  console.log('鸿蒙 Electron 构建（模板 ' + template.repo + '@' + template.ref.slice(0, 8) + '）')
  log('构建目录 ' + buildDir)
  log('应用目录 ' + appDir)
  log('签名     ' + (options.signing ? options.signing : '（未提供，产出 unsigned 包）'))

  if (options.dry) {
    log('dry: 只打印计划，不下载、不构建')
    return
  }

  // 1. 模板缓存（只在缺失时下载）
  if (!existsSync(cacheDir)) {
    if (options.skipDownload) fail('模板缓存不存在，且指定了 --skip-download：' + cacheDir)
    await downloadTemplate(template, cacheDir)
  } else {
    log('模板缓存已就绪（' + cacheDir + '）')
  }

  // 2. 覆盖层计划：每个覆盖文件都必须在模板里存在
  const templateFiles = await walkFiles(cacheDir)
  const overlayFiles = await walkFiles(join(PROJECT_DIR, overlay.dir))
  const planned = planOverlay({ overlayFiles: [...overlayFiles.keys()], templateFiles: new Set(templateFiles.keys()) })
  if (planned.missing.length > 0) {
    fail(
      '覆盖层有 ' +
      planned.missing.length +
      ' 个目标在模板里找不到（模板结构变了？）：\n' +
      planned.missing.map((rel) => '    - ' + rel).join('\n'),
    )
  }
  log('覆盖层命中模板：' + planned.present.length + ' 个文件')
  if (options.check) {
    console.log('\n✓ 覆盖层与模板一致（--check 通过）')
    return
  }

  // 3. 构建目录：ref 变了就重建，否则就地复用（增量构建快很多）
  const markerPath = join(buildDir, '.dsh-template-ref')
  const marker = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : ''
  if (marker !== template.ref) {
    await rm(buildDir, { recursive: true, force: true })
    await mkdir(dirname(buildDir), { recursive: true })
    copyTree(cacheDir, buildDir)
    await writeFile(markerPath, template.ref + '\n', 'utf8')
    log('构建目录已按模板重建')
  } else {
    log('复用已有构建目录（增量）')
  }

  // 4. 叠覆盖层
  for (const [rel, source] of overlayFiles) {
    const target = join(buildDir, rel)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target)
  }
  log('覆盖层已应用')

  // 5. 可选覆盖 bundleName：debug profile 绑 bundle 名，想用现成 profile 验签名就得对上一个。
  //    只改构建目录里的 AppScope/app.json5，不动仓库里的覆盖层。
  if (options.bundle) {
    const scopePath = join(buildDir, 'AppScope/app.json5')
    const scope = await readFile(scopePath, 'utf8')
    const patched = scope.replace(/("bundleName"\s*:\s*")[^"]*(")/, '$1' + options.bundle + '$2')
    if (patched === scope) fail('AppScope/app.json5 里找不到 bundleName，无法覆盖')
    await writeFile(scopePath, patched, 'utf8')
    log('bundleName 已覆盖为 ' + options.bundle)
  }

  // 6. 换 app 目录（整目录替换，避免上一份 app 的残渣）
  const appTarget = join(buildDir, template.appDir)
  await rm(appTarget, { recursive: true, force: true })
  copyTree(appDir, appTarget)
  log('app 目录已替换')

  // 7. 可选注入签名
  const profilePath = join(buildDir, 'build-profile.json5')
  // 每轮都从模板原件复原：签名会改写它，复用构建目录时不能带着上一轮的注入。
  await cp(join(cacheDir, 'build-profile.json5'), profilePath)
  if (options.signing) {
    const material = JSON.parse(await readFile(options.signing, 'utf8'))
    const before = await readFile(profilePath, 'utf8')
    const after = injectSigningConfigs(before, material)
    await writeFile(profilePath, after, 'utf8')
    log('build-profile.json5 已注入 signingConfigs')
  }

  // 8. ohpm 依赖：electron 模块依赖 web_engine（file:../web_engine），不装就没有 oh_modules
  //    hvigor 自己的解析不会替我们装依赖，缺了就会报 Cannot find module 'web_engine'。
  if (!existsSync(options.ohpm)) fail('找不到 ohpm：' + options.ohpm + '（可用 --ohpm 指定）')
  step('ohpm install --all')
  const install = run(options.ohpm, ['install', '--all'], { cwd: buildDir })
  if (install.status !== 0) {
    fail('ohpm install 失败（exit ' + install.status + '）\n\n' + tail(install.stdout + install.stderr, 40))
  }
  log('依赖已就绪')

  // 9. 打包
  if (!existsSync(options.devecSdk)) fail('找不到 DevEco SDK：' + options.devecSdk + '（可用 --devec-sdk 指定）')
  if (!existsSync(options.hvigor)) fail('找不到 hvigorw：' + options.hvigor + '（可用 --hvigor 指定）')
  step('hvigorw assembleHap')
  const build = run(options.hvigor, ['--no-daemon', 'assembleHap'], {
    cwd: buildDir,
    env: { ...process.env, DEVECO_SDK_HOME: options.devecSdk },
  })
  const output = (build.stdout + build.stderr).trim()
  if (build.status !== 0) {
    fail('hvigor 失败（exit ' + build.status + '）\n\n' + tail(output, 60))
  }
  const skippedSigning = /Will skip sign/.test(output)
  log('BUILD SUCCESSFUL' + (skippedSigning ? '（未签名）' : ''))
  if (!/BUILD SUCCESSFUL/.test(output)) log(tail(output, 10))

  // 10. 收产物
  const outputsDir = join(buildDir, hapOutputDir(template.hapModule))
  const names = existsSync(outputsDir) ? await readdir(outputsDir) : []
  const hapName = pickHap(names)
  if (!hapName) fail('没有在 ' + outputsDir + ' 找到 HAP（模板结构与预期不符？）')
  await mkdir(OUT_DIR, { recursive: true })
  const hapSource = join(outputsDir, hapName)
  const hapTarget = join(OUT_DIR, hapName)
  await cp(hapSource, hapTarget)
  const size = (await readFile(hapTarget)).length
  const signed = !isUnsignedHap(hapName)

  console.log('\n✓ HAP: ' + hapTarget)
  log('大小 ' + humanSize(size))
  log('sha256 ' + sha256OfFile(hapTarget))
  log('签名 ' + (signed ? '已签' : '未签（装真机前要配 signingConfigs）'))
  if (!signed) {
    log('提示：debug profile 绑定 bundle 名与设备 UDID；本工程 bundle 是 ' + bundleNameOf(spec) + '，')
    log('      需要为它生成 debug 签名（DevEco 自动签名），再用 --signing <json> 注入。')
  }
}

function bundleNameOf(spec) {
  return spec.bundleName ?? 'io.github.hyperion2144.dsh.plus.hos'
}

async function downloadTemplate(template, cacheDir) {
  const url = template.archive.replace('{ref}', template.ref)
  const downloadDir = join(SCRATCH_DIR, 'downloads')
  await mkdir(downloadDir, { recursive: true })
  const archive = join(downloadDir, template.ref + '.tar.gz')
  if (!existsSync(archive)) {
    step('下载模板 ' + url)
    const attempt = run('curl', ['-sSL', '--fail', '-m', '600', url, '-o', archive])
    if (attempt.status !== 0) fail('下载模板失败：' + (attempt.stderr || attempt.error))
    log('已下载 ' + humanSize((await readFile(archive)).length))
  } else {
    log('复用已下载的模板包 ' + archive)
  }
  step('解包模板')
  await rm(cacheDir, { recursive: true, force: true })
  await mkdir(cacheDir, { recursive: true })
  const extract = run('tar', ['xzf', archive, '--strip-components=1', '-C', cacheDir])
  if (extract.status !== 0) fail('解包失败：' + (extract.stderr || extract.error))
  const required = ['build-profile.json5', 'electron/src/main/module.json5', template.appDir]
  for (const rel of required) {
    if (!existsSync(join(cacheDir, rel))) fail('解包后缺少 ' + rel + '：模板结构变了，检查钉的 ref')
  }
  log('模板已解包')
}

function tail(text, lines) {
  const all = text.split('\n')
  return all.slice(Math.max(0, all.length - lines)).join('\n')
}

await main()
