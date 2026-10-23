/** Startup diagnostics snapshot: what runtime, which host, where the logs. */

/** Facts the diagnostic line reports; every field is explicit caller input. */
export interface DiagnosticsInputs {
	/** Running DSH runtime version, when known. */
	runtimeVersion?: string
	/** Host process pid, when launched. */
	hostPid?: number | null
	/** Host loopback port, when known. */
	hostPort?: number | null
	/** Directory the rotating logs live in. */
	logDir: string
	/** Active profile name, when known. */
	profile?: string
	/** App version, when known. */
	appVersion?: string
	/** Machine description (official `readDeviceInfo()`), when available. */
	deviceInfo?: string
}

/** The diagnostics record embedded in bundles and written at startup. */
export type DiagnosticsSnapshot = Required<Pick<DiagnosticsInputs, 'logDir'>> & DiagnosticsInputs & { pid: number; capturedAt: string }

/** Build one diagnostics snapshot; `capturedAt` stamps the moment. */
export function collectDiagnostics(inputs: DiagnosticsInputs, now: () => Date = () => new Date()): DiagnosticsSnapshot {
	return {
		pid: process.pid,
		capturedAt: now().toISOString(),
		...inputs,
	}
}
