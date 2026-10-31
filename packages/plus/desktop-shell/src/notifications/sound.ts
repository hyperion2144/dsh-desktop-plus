/** Whitelist validation for custom notification sounds: format, size, duration caps. */

/** Sound formats plus will load; anything else is rejected before reading. */
export const SOUND_ALLOWED_EXTENSIONS = ['.wav', '.mp3', '.ogg'] as const

/** Hard caps: a notification sound must stay small and short. */
export const SOUND_MAX_BYTES = 5 * 1024 * 1024
export const SOUND_MAX_SECONDS = 30

/** The facts validateSoundFile checks; caller supplies them from the file. */
export interface SoundFileFacts {
	extension: string
	sizeBytes: number
	durationSeconds: number
}

export type SoundValidation = { ok: true } | { ok: false; reason: string }

/** @returns ok, or a user-readable reason naming the violated cap. */
export function validateSoundFile(facts: SoundFileFacts): SoundValidation {
	const extension = facts.extension.toLowerCase()
	if (!(SOUND_ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
		return { ok: false, reason: `Unsupported sound format ${extension}; allowed: ${SOUND_ALLOWED_EXTENSIONS.join(', ')}` }
	}
	if (facts.sizeBytes > SOUND_MAX_BYTES) {
		return { ok: false, reason: `Sound file exceeds the ${Math.round(SOUND_MAX_BYTES / 1024 / 1024)} MB limit` }
	}
	if (facts.durationSeconds > SOUND_MAX_SECONDS) {
		return { ok: false, reason: `Sound file exceeds the ${SOUND_MAX_SECONDS} second limit` }
	}
	return { ok: true }
}
