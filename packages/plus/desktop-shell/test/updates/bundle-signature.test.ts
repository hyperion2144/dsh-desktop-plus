import { describe, expect, it } from 'vitest'
import { inspectMacosBundleSignature, parseMacosBundleSignature, resolveMacosUpdateInstallMode } from '../../src/updates/bundle-signature.ts'

const adhocCodesign = [
	'Executable=/Applications/DSH Desktop Plus.app/Contents/MacOS/DSH Desktop Plus',
	'Identifier=io.github.hyperion2144.dsh.plus',
	'CodeDirectory v=20500 size=640 flags=0x10002(adhoc,runtime) hashes=9+7 location=embedded',
	'Signature=adhoc',
	'TeamIdentifier=not set',
].join('\n')
const developerIdCodesign = [
	'Executable=/Applications/Example.app/Contents/MacOS/Example',
	'Identifier=com.example.app',
	'Authority=Developer ID Application: Example Ltd (ABCDEF1234)',
	'TeamIdentifier=ABCDEF1234',
].join('\n')

describe('parseMacosBundleSignature', () => {
	it('reads ad-hoc signatures from the flags and Signature lines', () => {
		expect(parseMacosBundleSignature(adhocCodesign)).toBe('ad-hoc')
	})
	it('reads a Developer ID TeamIdentifier as developer-id', () => {
		expect(parseMacosBundleSignature(developerIdCodesign)).toBe('developer-id')
	})
	it('treats an unsigned or unrecognized bundle as unknown', () => {
		expect(parseMacosBundleSignature('code object is not signed at all')).toBe('unknown')
		expect(parseMacosBundleSignature('')).toBe('unknown')
	})
})

describe('resolveMacosUpdateInstallMode', () => {
	it('sends ad-hoc and unknown macOS bundles to the manual installer', () => {
		expect(resolveMacosUpdateInstallMode('darwin', 'ad-hoc')).toBe('manual')
		expect(resolveMacosUpdateInstallMode('darwin', 'unknown')).toBe('manual')
	})
	it('keeps Developer-ID bundles and other platforms on the official ShipIt path', () => {
		expect(resolveMacosUpdateInstallMode('darwin', 'developer-id')).toBe('shipit')
		expect(resolveMacosUpdateInstallMode('win32', 'ad-hoc')).toBe('shipit')
		expect(resolveMacosUpdateInstallMode('linux', 'developer-id')).toBe('shipit')
	})
})

describe('inspectMacosBundleSignature', () => {
	it('parses combined stdout and stderr from a successful run', async () => {
		const signature = await inspectMacosBundleSignature('/Applications/App.app', async () => ({ stdout: '', stderr: adhocCodesign }))
		expect(signature).toBe('ad-hoc')
	})
	it('collapses a failing codesign process to unknown', async () => {
		const signature = await inspectMacosBundleSignature('/Applications/App.app', async () => { throw new Error('spawn codesign ENOENT') })
		expect(signature).toBe('unknown')
	})
	it('rejects a corrupted signature even when a TeamIdentifier is displayed', async () => {
		const signature = await inspectMacosBundleSignature('/Applications/App.app', async (args) => {
			if (args[0] === '--verify') throw new Error('invalid resource envelope')
			return { stdout: '', stderr: developerIdCodesign }
		})
		expect(signature).toBe('unknown')
	})
})
