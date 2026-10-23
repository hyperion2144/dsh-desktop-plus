/** One-shot diagnostics bundle: every log file plus a diagnostics.json, as one sendable `.tar.gz`. */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTarGz, type TarEntry } from './tar.ts'

/** Inputs for the bundle's `diagnostics.json` member. */
export interface BundleInputs {
	/** Where the rotating logs live. */
	logDir: string
	/** Where to write the `.tar.gz`. */
	outFile: string
	/** Structured diagnostics embedded as `diagnostics.json`. */
	diagnostics: Record<string, unknown>
	/** Filename filter, default keeps every file in `logDir`. */
	match?: (name: string) => boolean
}

export interface BundleResult {
	/** Absolute path of the produced archive. */
	file: string
	/** Member count including `diagnostics.json`. */
	entries: number
}

/** Collect `logDir` files plus diagnostics into one `.tar.gz` at `outFile`. */
export function exportDiagnosticsBundle(inputs: BundleInputs): BundleResult {
	const match = inputs.match ?? (() => true)
	const entries: TarEntry[] = [{ name: 'diagnostics.json', data: JSON.stringify(inputs.diagnostics, null, 2) }]
	if (existsSync(inputs.logDir)) {
		for (const name of readdirSync(inputs.logDir).sort()) {
			const file = join(inputs.logDir, name)
			if (!match(name)) continue
			entries.push({ name, data: readFileSync(file) })
		}
	}
	const bundle = createTarGz(entries)
	writeFileSync(inputs.outFile, bundle)
	return { file: inputs.outFile, entries: entries.length }
}
