/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { developmentRuntimeDirectory, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareDevelopmentProject } from './development-project.ts'
import { prepareDevelopmentApp } from './development-app.ts'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')

interface PackageManifest {
  readonly version?: string
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop')
  }
  await run(process.execPath, [packageManager, 'run', script], cwd)
}

async function launchElectron(): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  // 默认避开常用调试端口段（9229/9222/9230 与其它 Electron/Node 实例高冲突）；env 可覆盖。
  const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9349)
  const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9342)
  const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9350)
  const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = resolve(process.env.DSH_DESKTOP_USER_DATA_DIR ?? join(DEVELOPMENT_ROOT, 'electron-user-data'))
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_PRIMARY_RUNTIME_DIR: process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR ?? developmentRuntimeDirectory(),
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '0',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
    // 宿主进程（如 DSH 桌面壳）会带 ELECTRON_RUN_AS_NODE 启动终端；不清掉，Electron 二进制
    // 会以 node 模式启动并报 bad option 直接退 9。NO_ATTACH_CONSOLE 同属 node 态开关。
    ELECTRON_RUN_AS_NODE: '',
    ELECTRON_NO_ATTACH_CONSOLE: '',
  }
  // plus：开发态也要在关于窗口/托盘/诊断里显示 plus 版本。打包构建用 extraMetadata + 注入两层，
  // 开发态没有这两层（app.getVersion() 是官方版本号），所以从 plus 壳包 manifest 读一份写进注入变量。
  if (environment.DSH_DESKTOP_BUILD_VERSION === undefined || environment.DSH_DESKTOP_BUILD_VERSION === '') {
    // 注意 REPOSITORY_ROOT 是 vendored 的官方树（upstream/），plus 包在它上一层。
    const plusShellManifest = join(REPOSITORY_ROOT, '..', 'packages', 'plus', 'desktop-shell', 'package.json')
    if (existsSync(plusShellManifest)) environment.DSH_DESKTOP_BUILD_VERSION = packageVersion(plusShellManifest, 'plus shell package')
  }
  console.log(`desktop development: DSH_HOME=${home}`)
  console.log(`desktop development: userData=${userData}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  if (process.platform === 'darwin') {
    const executable = prepareDevelopmentApp({ electron, appRoot: APP_ROOT, directory: DEVELOPMENT_ROOT, home, userData,
      mainPort, rendererPort, hostPort, openDevtools: environment.DSH_DESKTOP_OPEN_DEVTOOLS! })
    await run(executable, [], APP_ROOT, environment)
    return
  }
  await run(electron, [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false } } })
  if (!values['skip-build']) {
    await runPackageScript('build:artifacts', REPOSITORY_ROOT)
    await runPackageScript('build', APP_ROOT)
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: execFileSync(createRequire(import.meta.url)('electron') as string, ['-p', 'process.versions.node'],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim(),
    pnpmVersion,
  }
  prepareDevelopmentProject({
    projectDir: resolve(process.env.DSH_DESKTOP_DEV_PROJECT_DIR ?? join(DEVELOPMENT_ROOT, 'project')),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
    target: resolveDesktopBuildTarget(),
  })
  await preparePrimaryRuntime()
  // 双开验证：后续实例复用首实例已准备好的 primary runtime（同代码同版本，纯只读分发）。
  if (process.env.DSH_DESKTOP_SKIP_RUNTIME_PREP !== '1') await preparePrimaryRuntime()
  await launchElectron()
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
