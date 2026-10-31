/** Minimal ustar writer producing a standard `.tar.gz` archive buffer. */

import { gzipSync } from 'node:zlib'

/** One archive member: path inside the archive plus its bytes. */
export interface TarEntry {
	/** Member path, e.g. `plus-2026-10-23.log` or `diagnostics.json`. */
	name: string
	/** Member content. */
	data: Buffer | string
}

const BLOCK = 512

const octal = (value: number, length: number): Buffer => {
	const text = value.toString(8).padStart(length - 1, '0')
	return Buffer.from(`${text}\0`, 'binary')
}

const text = (value: string, length: number): Buffer => Buffer.alloc(length, 0, 'binary').fill(value, 0, Math.min(value.length, length))

const padded = (data: Buffer): Buffer => {
	const rest = data.length % BLOCK
	return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(BLOCK - rest)])
}

const header = (entry: TarEntry): Buffer => {
	const head = Buffer.alloc(BLOCK, 0, 'binary')
	text(entry.name, 100).copy(head, 0)
	octal(0o644, 8).copy(head, 100)
	octal(0, 8).copy(head, 108)
	octal(0, 8).copy(head, 116)
	octal(Buffer.byteLength(entry.data), 12).copy(head, 124)
	octal(0, 12).copy(head, 136)
	head.write('        ', 148, 'binary')
	head.write('0', 156, 'binary')
	head.write('ustar\0', 257, 'binary')
	head.write('00', 263, 'binary')
	let sum = 0
	for (const byte of head) sum += byte
	octal(sum, 7).copy(head, 148)
	head.write(' ', 155, 'binary')
	return head
}

/** Build one uncompressed tar buffer from `entries`. */
export function createTar(entries: TarEntry[]): Buffer {
	const parts = entries.map((entry) => Buffer.concat([header(entry), padded(Buffer.from(entry.data))]))
	return Buffer.concat([...parts, Buffer.alloc(2 * BLOCK)])
}

/** Build one standard `.tar.gz` buffer: a ustar archive of `entries`, gzipped. */
export function createTarGz(entries: TarEntry[]): Buffer {
	return gzipSync(createTar(entries))
}
