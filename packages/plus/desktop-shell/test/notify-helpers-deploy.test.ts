/**
 * 通知辅助脚本部署的门禁（#142）：`deployNotifyHelpers()` 把 `notify/*.ps1` 与
 * `icon.png` 复制到 `%LOCALAPPDATA%\dsh-desktop-plus\notify`，但首次部署时该目录
 * 不存在——不先建目录，`writeFileSync` 必抛 ENOENT，被 catch 吞成
 * `helpers deploy failed`，宿主 `/__dsh-plus/notify` 一律回 502 `helpers-unavailable`，
 * Windows 上所有原生 toast 全部失效。
 *
 * 插件是单文件 `index.js`（宿主加载器与静态 import 不兼容，全部能力惰性加载），
 * 没有可注入的模块边界，所以这里按源码门禁校验两条不变量：
 *   1. 部署前先建目录；
 *   2. 失败不写进 `notifyHelpersReady` 缓存，下一次投递能重试。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pluginSource = readFileSync(
	join(import.meta.dirname, '..', '..', 'desktop-plugin', 'index.js'),
	'utf8',
)

/** `deployNotifyHelpers` 的函数体（从声明到下一个同缩进的 `}`）。 */
function deployBody(): string {
	const start = pluginSource.indexOf('const deployNotifyHelpers = () => {')
	expect(start).toBeGreaterThan(-1)
	const end = pluginSource.indexOf('\n  }', start)
	expect(end).toBeGreaterThan(start)
	return pluginSource.slice(start, end)
}

describe('notify helper deployment (#142)', () => {
	it('creates the helper directory before writing into it', () => {
		const body = deployBody()
		const mkdir = body.indexOf('mkdirSync(dir, { recursive: true })')
		const write = body.indexOf('writeFileSync(')
		expect(mkdir).toBeGreaterThan(-1)
		expect(write).toBeGreaterThan(-1)
		expect(mkdir).toBeLessThan(write)
	})

	it('does not cache a failed deployment, so the next delivery retries', () => {
		const body = deployBody()
		// 失败分支必须把缓存清回 null；否则一次 ENOENT 会让进程生命周期内永不重试。
		expect(body).toContain('if (!ready) notifyHelpersReady = null')
	})
})
