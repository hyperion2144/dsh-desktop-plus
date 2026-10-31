/** Download history persistence: atomic JSON writes, crash-tolerant reads. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { DownloadRecord } from './types.ts'

export interface HistoryStore {
	load(): DownloadRecord[]
	save(records: DownloadRecord[]): void
}

/** One store file per DSH profile directory; `downloads-history.json`. */
export function createFileHistoryStore(profileDir: string): HistoryStore {
	const file = join(profileDir, 'downloads-history.json')
	return {
		load(): DownloadRecord[] {
			try {
				const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
				return Array.isArray(parsed) ? parsed.filter(isRecord) : []
			} catch {
				// missing or corrupt history starts empty; downloads keep working
				return []
			}
		},
		save(records: DownloadRecord[]): void {
			mkdirSync(dirname(file), { recursive: true })
			const tmp = `${file}.tmp`
			writeFileSync(tmp, JSON.stringify(records), 'utf8')
			renameSync(tmp, file)
		},
	}
}

function isRecord(value: unknown): value is DownloadRecord {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Partial<DownloadRecord>
	return typeof candidate.id === 'string'
		&& typeof candidate.url === 'string'
		&& typeof candidate.filename === 'string'
		&& typeof candidate.savedPath === 'string'
		&& typeof candidate.state === 'string'
		&& typeof candidate.startedAt === 'number'
}
