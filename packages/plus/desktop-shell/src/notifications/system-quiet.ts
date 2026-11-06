/** 系统级免打扰/静音通知探测（#116）：自播音效必须尊重系统的静音状态。 */
//
// 背景：Windows 兜底提示音（PowerShell SoundPlayer）与自定义音效文件走的是「应用自播」
// 通道，Windows 静音通知 / macOS 专注模式只能压制「系统通知通道」的横幅与声音，管不到
// 自播。本模块探测系统静音状态，命中时投递层把自播音效按「免打扰」处理（横幅行为仍交给
// 系统：Windows 直接折叠横幅，macOS 送进通知中心）。
//
// 探针按平台 best-effort，探不到（注册表键不存在 / 断言库缺失 / 解析失败）一律返回 false
// （fail-open：宁可多响一声，也不静掉用户想听的通知）；结果带 TTL 缓存，避免每次投递都
// 同步起子进程。

import { execFileSync } from 'node:child_process'
import { homedir as osHomedir } from 'node:os'
import { join } from 'node:path'

export interface SystemQuietGateOptions {
	/** 目标平台；缺省取当前进程平台。 */
	platform?: NodeJS.Platform
	/** 同步命令执行缝（测试注入）；缺省 execFileSync，3 秒超时、丢弃 stderr。 */
	execSync?: (file: string, args: string[]) => string
	/** 用户主目录缝（darwin 断言库路径用）；缺省 os.homedir()。 */
	homedir?: () => string
	/** 探测结果缓存时长（毫秒）；缺省 10 秒。 */
	ttlMs?: number
}

export interface SystemQuietGate {
	/** 系统级免打扰/静音通知是否生效（自播音效应被压制）。探不到按 false。 */
	isQuiet(): boolean
}

/** 解析 `reg query ... /v QuietMode` 输出：REG_DWORD 非 0 = 静音生效（0=关、1=仅优先、2=仅闹钟）。 */
export function quietModeFromRegOutput(stdout: string): boolean {
	const match = /QuietMode\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(stdout)
	if (match === null) return false
	const value = Number.parseInt(match[1] ?? '0', 16)
	return Number.isFinite(value) && value !== 0
}

/** 解析 macOS DoNotDisturbDB 断言库 JSON：存在生效的 Focus 断言 = 静音生效；结构异常 = false。 */
export function focusAssertionsFromPlutilJson(stdout: string): boolean {
	try {
		const parsed = JSON.parse(stdout) as { data?: Array<{ storeAssertionRecords?: unknown[] }> }
		const records = parsed.data?.flatMap((entry) => entry.storeAssertionRecords ?? []) ?? []
		return records.length > 0
	} catch {
		return false
	}
}

const WIN_QUIET_MODE_ARGS = ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\QuietHours', '/v', 'QuietMode'] as const

export function createSystemQuietGate(options: SystemQuietGateOptions = {}): SystemQuietGate {
	const platform = options.platform ?? process.platform
	const ttlMs = options.ttlMs ?? 10_000
	const execSync = options.execSync ?? ((file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] }) as string)
	const home = options.homedir ?? (() => osHomedir())
	let memo: { quiet: boolean; at: number } | undefined
	const probe = (): boolean => {
		try {
			if (platform === 'win32') {
				return quietModeFromRegOutput(execSync('reg', [...WIN_QUIET_MODE_ARGS]))
			}
			if (platform === 'darwin') {
				const stdout = execSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(home(), 'Library', 'DoNotDisturbDB', 'Assertions.json')])
				return focusAssertionsFromPlutilJson(stdout)
			}
			return false
		} catch {
			// 键缺失 / 断言库不存在 / 命令缺席 = 探不到，fail-open 不压制。
			return false
		}
	}
	return {
		isQuiet(): boolean {
			const now = Date.now()
			if (memo === undefined || now - memo.at >= ttlMs) memo = { quiet: probe(), at: now }
			return memo.quiet
		},
	}
}
