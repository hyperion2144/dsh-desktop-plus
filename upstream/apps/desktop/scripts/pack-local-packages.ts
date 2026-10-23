/** Stage local-branded DSH packages for unsigned Desktop builds without a publication record. */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
} from '../../../scripts/client-build-environment.ts'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import { runConcurrent } from '../../../scripts/release/process.ts'
import { packFamilyMembers, parsePackConcurrency } from '../../../scripts/release/pack.ts'
import { releaseFamily, tarballName } from '../../../scripts/release/families.ts'

async function main(): Promise<void> {

  const { values } = parseArgs({
    options: { out: { type: 'string' }, concurrency: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.out === undefined) throw new Error('desktop local pack: --out must name the package staging directory')
  const concurrency = parsePackConcurrency(values.concurrency)
  const root = process.cwd()
  const environment = resolveClientBuildEnvironment(repositoryClientBuildEnvironment(root), 'local')
  readClientBuildRecord(root, environment)
  const destination = resolve(root, values.out)
  const packed = await packFamilyMembers(root, releaseFamily('dsh'), destination, concurrency)
  // plus 桌面内置插件：cli dependencies 闭包引用它们，tarball 必须出现在同一
  // packed 目录供 package set 捕获。复用官方打包机制（pnpm pack 按 files 白名单
  // 取内容）；版本已与 dsh 家族对齐，无需副本归一。
  // plus 包在仓库根 packages/（upstream 的上一级），不在 upstream 内。
  const plusSources = ['../packages/plus/desktop-plugin', '../packages/plus/desktop-remote-access', '../packages/plus/desktop-brand']
  let plusCount = 0
  for (const source of plusSources) {
    const sourceDir = resolve(root, source)
    const manifestPath = join(sourceDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; version?: string }
    if (typeof manifest.name !== 'string' || manifest.name === '' || typeof manifest.version !== 'string' || manifest.version === '') {
      throw new Error(`desktop local pack: ${source} manifest needs name and version`)
    }
    const member = { directory: sourceDir, name: manifest.name, version: manifest.version, manifest }
    const invocation = pnpmInvocation(['--dir', sourceDir, 'pack', '--pack-destination', destination])
    await runConcurrent(invocation.command, invocation.args)
    const tarball = join(destination, tarballName(member))
    if (!existsSync(tarball)) throw new Error(`desktop local pack: ${member.name} produced no tarball at ${tarball}`)
    plusCount += 1
  }
  console.log(`desktop local pack: ${String(packed.length + plusCount)} tarball(s) in ${destination}`)
}

await main()
