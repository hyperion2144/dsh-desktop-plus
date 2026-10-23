/** Restart backoff: exponential growth with a cap and jitter, derived from config only. */

import type { BackoffConfig } from './types.ts'

/**
 * Delay before restart attempt `attempt` (1-based): `baseMs * factor^(attempt-1)`,
 * capped at `maxMs`, plus a fresh random jitter in `[0, jitterMs)`.
 */
export function restartDelayMs(config: BackoffConfig, attempt: number, random: () => number = Math.random): number {
	const clamped = Math.max(1, attempt)
	const exponential = config.baseMs * config.factor ** (clamped - 1)
	const capped = Math.min(exponential, config.maxMs)
	return Math.round(capped + random() * config.jitterMs)
}
