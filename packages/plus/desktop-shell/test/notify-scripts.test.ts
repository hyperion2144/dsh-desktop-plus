/**
 * `notify/*.ps1` 的语法门禁（#117）：脚本运行时才交给 PowerShell，本仓没有任何
 * 语法校验——多/少一个大括号只会在用户机器上炸（win-toast.ps1 曾因此让所有 toast
 * 投递失败）。这里用 PowerShell 自己的解析器在 Windows 上把每个脚本过一遍。
 * 非 Windows 主机跳过：仓库的 shell 测试在 macOS/Linux 也跑，那里没有 powershell.exe。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const notifyDir = join(import.meta.dirname, '..', '..', 'desktop-plugin', 'notify')
const scripts = readdirSync(notifyDir).filter((name) => name.endsWith('.ps1'))

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
