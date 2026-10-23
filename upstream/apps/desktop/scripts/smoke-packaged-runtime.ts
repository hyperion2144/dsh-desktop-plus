/** Validate the assembled application, including native Office conversion outside ASAR. */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopArtifactOutput, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'skip-notarization': { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const artifacts = desktopArtifactOutput(paths, { unsigned: values.unsigned, skipNotarization: values['skip-notarization'] }).directory
const linux = target === 'linux-x64'
const macBundle = (): string => {
  // electron-builder 的 .app 名跟着 productName / executableName 变，硬编码会在改名时断链。
  const root = join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac')
  const found = readdirSync(root).find((entry) => entry.endsWith('.app'))
  if (found === undefined) throw new Error(`smoke: no .app bundle under ${root}`)
  return join(root, found, 'Contents')
}
const application = windows ? join(artifacts, 'win-unpacked')
  : linux ? join(artifacts, 'linux-unpacked')
  : macBundle()
const resources = join(application, windows || linux ? 'resources' : 'Resources')
// 可执行名随 productName/executableName 变：三个平台都按目录内容发现，改名不断链。
const firstExecutable = (directory: string, accept: (entry: string) => boolean): string => {
  const found = readdirSync(directory).find(accept)
  if (found === undefined) throw new Error(`smoke: no executable in ${directory}`)
  return join(directory, found)
}
const executable = windows
  ? firstExecutable(application, (entry) => entry.endsWith('.exe') && !/helper|elevate|crashpad/i.test(entry))
  : linux
    ? firstExecutable(application, (entry) => /^(dsh|deepseek|harness)/i.test(entry) && !entry.includes('.'))
    : firstExecutable(join(application, 'MacOS'), (entry) => !entry.endsWith('.dylib'))
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
if (windows && !values.unsigned) await verifyWindowsCode(application)
await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
