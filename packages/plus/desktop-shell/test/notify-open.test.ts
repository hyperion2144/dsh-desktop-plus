/** #116 通知直通：协议解析与页面跳转脚本的边界。 */
import { describe, expect, it } from 'vitest'
import { parsePlusOpenUrl, plusFocusSessionScript } from '../src/notify-open.ts'

describe('parsePlusOpenUrl', () => {
	it('carries profile and session', () => {
		expect(parsePlusOpenUrl('dsh-plus://open?profile=work&session=abc-123')).toEqual({ profile: 'work', sessionId: 'abc-123' })
	})

	it('decodes percent-encoded values', () => {
		expect(parsePlusOpenUrl('dsh-plus://open?profile=my%20profile&session=a%2Fb')).toEqual({ profile: 'my profile', sessionId: 'a/b' })
	})

	it('treats a missing profile as the default profile', () => {
		expect(parsePlusOpenUrl('dsh-plus://open?session=abc')).toEqual({ profile: '', sessionId: 'abc' })
	})

	it('treats a missing session as focus-only', () => {
		expect(parsePlusOpenUrl('dsh-plus://open?profile=work')).toEqual({ profile: 'work', sessionId: '' })
	})

	it('accepts the bare legacy launch without any query', () => {
		expect(parsePlusOpenUrl('dsh-plus://open')).toEqual({ profile: '', sessionId: '' })
	})

	it('rejects other applications\' protocols', () => {
		expect(parsePlusOpenUrl('dsh://open')).toBeNull()
	})

	it('rejects hosts other than open', () => {
		expect(parsePlusOpenUrl('dsh-plus://approve?token=1')).toBeNull()
	})

	it('rejects malformed URLs', () => {
		expect(parsePlusOpenUrl('dsh-plus://')).toBeNull()
	})

	it('clips oversized ids', () => {
		const id = 'x'.repeat(300)
		expect(parsePlusOpenUrl(`dsh-plus://open?session=${id}`)?.sessionId).toHaveLength(200)
	})
})

describe('plusFocusSessionScript', () => {
	it('calls the page global with the id', () => {
		expect(plusFocusSessionScript('abc')).toBe('window.__dshPlusFocusSession?.("abc")')
	})

	it('escapes quotes so the id cannot break out of the call', () => {
		expect(plusFocusSessionScript('a"b')).toBe('window.__dshPlusFocusSession?.("a\\"b")')
	})

	it('escapes backslashes', () => {
		expect(plusFocusSessionScript('a\\b')).toBe('window.__dshPlusFocusSession?.("a\\\\b")')
	})

	it('escapes newlines', () => {
		expect(plusFocusSessionScript('a\nb')).toBe('window.__dshPlusFocusSession?.("a\\nb")')
	})

	it('keeps non-ASCII ids intact', () => {
		expect(plusFocusSessionScript('会话-1')).toBe('window.__dshPlusFocusSession?.("会话-1")')
	})
})
