/**
 * `notify/*.ps1` 的两道门禁。
 *
 * 1. 字节编码（#142，跨平台）：Windows PowerShell 5.1 读无 BOM 的 `.ps1` 时按系统
 *    ANSI 码页解码（中文机器是 CP936）。文件里只要有一个非 ASCII 字节，`param()`
 *    块就可能解析失败，脚本一行都不执行，所有 toast 全灭。所以每个脚本要么纯
 *    ASCII，要么带 UTF-8 BOM——两者都没有就是缺陷。这道门不 skipIf：Linux CI 也跑。
 * 2. 语法（#117，仅 Windows）：脚本运行时才交给 PowerShell，本仓没有语法校验——
 *    多/少一个大括号只会在用户机器上炸。这里用 PowerShell 自己的解析器过一遍。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const notifyDir = join(import.meta.dirname, '..', '..', 'desktop-plugin', 'notify')
const scripts = readdirSync(notifyDir).filter((name) => name.endsWith('.ps1'))

describe('notify PowerShell scripts are decodable by Windows PowerShell 5.1 (#142)', () => {
	for (const script of scripts) {
		it(`${script} is pure ASCII or carries a UTF-8 BOM`, () => {
			const bytes = readFileSync(join(notifyDir, script))
			const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
			if (hasBom) return
			// 无 BOM 时 PowerShell 按 ANSI 码页解码：任何 >= 0x80 的字节都可能让解析器在
			// param() 块里报 MissingExpressionAfterToken，脚本一行不执行。
			const offenders = [...bytes].flatMap((byte, index) => (byte >= 0x80 ? [index] : []))
			expect(offenders, `non-ASCII byte at offset ${offenders[0]}`).toEqual([])
		})
	}
})

describe.skipIf(process.platform !== 'win32')('notify PowerShell scripts parse', () => {
	for (const script of scripts) {
		it(`${script} has no syntax errors`, () => {
			// 解析器是 PowerShell 内置类型；-Command 里只出现仓库内路径与转义后的单引号。
			const path = join(notifyDir, script).replace(/'/g, "''")
			const output = execFileSync('powershell.exe', [
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				`$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path}', [ref]$null, [ref]$errors); if ($errors.Count -eq 0) { 'OK' } else { $errors | ForEach-Object { $_.Message } }`,
			], { encoding: 'utf8', timeout: 30_000 }).trim()
			expect(output).toBe('OK')
		})
	}
})

describe.skipIf(process.platform !== 'win32')('win-toast builds valid XML for a real payload', () => {
	it('accepts profile + session (escaped ampersand) under -DryRun', () => {
		// 完整 payload 走一遍脚本的构造路径：语法（解析器）与 XML（LoadXml）两类
		// 只在真实参数上暴露的缺陷都被这道门挡住。
		const payload = Buffer.from(JSON.stringify({
			aumid: 'io.github.hyperion2144.dsh.plus',
			title: 'task complete',
			body: '<a> & "b"',
			tag: 'test-tag',
			profile: 'desktop',
			session: 'session-with-&-and-quotes"',
			sound: 'default',
		}), 'utf8').toString('base64')
		const output = execFileSync('powershell.exe', [
			'-NoProfile',
			'-NonInteractive',
			'-ExecutionPolicy', 'Bypass',
			'-File', join(notifyDir, 'win-toast.ps1'),
			'-Base64', payload,
			'-DryRun',
		], { encoding: 'utf8', timeout: 30_000 }).trim()
		expect(output).toBe('OK')
	})
})
