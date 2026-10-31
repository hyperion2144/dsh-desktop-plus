/** Busy leases reported by host plugins; freshness-windowed so a dead host cannot hold sleep forever. */
//
// 宿主插件按 10s 心跳上报 busy-state；租约只在新鲜窗口内有效——宿主死掉后心跳
// 停止，租约过窗自动失效，防休眠断言随之释放。onChange 只在活跃集合变化时触发。

export interface BusyLeaseDeps {
	/** A lease older than this counts as stale; default 25s = 2.5× the 10s heartbeat. */
	staleMs?: number
	/** Clock seam for tests. */
	now?: () => number
	/** Fires only when the active (fresh + busy) profile set changes. */
	onChange: (active: ReadonlySet<string>) => void
}

export interface BusyLease {
	/** Record one heartbeat. `busy=false` keeps the profile known but inactive. */
	report(profile: string, busy: boolean): void
	/** Re-evaluate freshness (call from a timer to reap a dead host's leases). */
	sweep(): void
	/** Drop every lease (shutdown path) and emit the empty set if anything was active. */
	clear(): void
}

export function createBusyLease(deps: BusyLeaseDeps): BusyLease {
	const staleMs = deps.staleMs ?? 25_000
	const now = deps.now ?? Date.now
	const leases = new Map<string, { busy: boolean; at: number }>()
	let lastKey = ''
	const emit = (): void => {
		const stamp = now()
		const active = new Set<string>()
		for (const [profile, lease] of leases) {
			if (lease.busy && stamp - lease.at < staleMs) active.add(profile)
		}
		const key = [...active].sort().join('\n')
		if (key === lastKey) return
		lastKey = key
		deps.onChange(active)
	}
	return {
		report(profile, busy) {
			if (profile === '') return
			leases.set(profile, { busy, at: now() })
			emit()
		},
		sweep: emit,
		clear() {
			leases.clear()
			emit()
		},
	}
}
