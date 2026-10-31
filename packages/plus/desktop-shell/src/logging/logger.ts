/** Day-and-size rotating file logger with gzipped archives and retention pruning. */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

/** Logger configuration; every knob is an explicit option for tests and ops. */
export interface RotatingLoggerOptions {
	/** Directory holding the active log and its archives; created on first append. */
	dir: string
	/** File name prefix, default `plus`. */
	prefix?: string
	/** Active-file byte budget before rotation, default 2 MiB. */
	maxBytes?: number
	/** Archive retention in days, default 14. */
	maxAgeDays?: number
	/** Clock seam for tests. */
	now?: () => Date
}

export interface RotatingLogger {
	/** Append one line; a newline is added when missing. */
	append(line: string): void
	/** The active file for `now()`; switches when the day changes. */
	currentFile(): string
	/** Delete expired `.log` and `.log.gz` files under `dir`. */
	prune(): void
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Create a rotating logger writing `<dir>/<prefix>-<YYYY-MM-DD>.log`. */
export function createRotatingLogger(options: RotatingLoggerOptions): RotatingLogger {
	const prefix = options.prefix ?? 'plus'
	const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
	const maxAgeDays = options.maxAgeDays ?? 14
	const now = options.now ?? (() => new Date())

	const stamp = (date: Date): string => date.toISOString().slice(0, 10)
	const dayFile = (date: Date): string => join(options.dir, `${prefix}-${stamp(date)}.log`)

	const ensureDir = (): void => {
		if (!existsSync(options.dir)) mkdirSync(options.dir, { recursive: true })
	}

	const rotateIfLarge = (file: string): void => {
		if (!existsSync(file)) return
		if (statSync(file).size < maxBytes) return
		const archive = `${file}.${now().getTime()}.gz`
		writeFileSync(archive, gzipSync(readFileSync(file)))
		writeFileSync(file, '')
	}

	const prune = (): void => {
		if (!existsSync(options.dir)) return
		const cutoff = now().getTime() - maxAgeDays * DAY_MS
		for (const name of readdirSync(options.dir)) {
			if (!name.startsWith(`${prefix}-`)) continue
			if (!name.endsWith('.log') && !(name.includes('.log.') && name.endsWith('.gz'))) continue
			const file = join(options.dir, name)
			if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
		}
	}

	const append = (line: string): void => {
		ensureDir()
		const file = dayFile(now())
		rotateIfLarge(file)
		appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`)
	}

	return { append, currentFile: () => dayFile(now()), prune }
}
