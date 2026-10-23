// 运行时候选的提醒记账（#23）。官方更新栈服务于壳整包替换；运行时候选走独立的
// 通知呈现（复用 #18 的 Electron Notification 通道与文案基调），但忽略/拉黑记账
// 沿用官方 update-attention 的语义 —— 每个版本只提醒一次，用户明确拒绝后拉黑，
// 数据刷新出新的候选版本时重新判断。壳更新链路完全不感知本模块。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Ledger shape persisted next to the shell's own update state in userData. */
export interface RuntimeAttentionLedger {
  /** version → epoch ms of the last dismissal; a fresh candidate set re-arms them. */
  dismissed: Record<string, number>
  /** Versions the user explicitly rejected; never prompted again. */
  blocked: string[]
}

export const EMPTY_RUNTIME_LEDGER: RuntimeAttentionLedger = { dismissed: {}, blocked: [] }

/** Reads the ledger; any malformed file resets it (the reminder is best-effort). */
export function loadRuntimeLedger(userDataDir: string): RuntimeAttentionLedger {
  const file = join(userDataDir, 'runtime-attention.json')
  if (!existsSync(file)) return { ...EMPTY_RUNTIME_LEDGER, dismissed: {}, blocked: [] }
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return { ...EMPTY_RUNTIME_LEDGER, dismissed: {}, blocked: [] }
    const ledger = raw as Partial<RuntimeAttentionLedger>
    return {
      dismissed: typeof ledger.dismissed === 'object' && ledger.dismissed !== null ? { ...ledger.dismissed } : {},
      blocked: Array.isArray(ledger.blocked) ? [...ledger.blocked] : [],
    }
  } catch {
    return { ...EMPTY_RUNTIME_LEDGER, dismissed: {}, blocked: [] }
  }
}

/** Persists the ledger atomically enough for a best-effort reminder file. */
export function saveRuntimeLedger(userDataDir: string, ledger: RuntimeAttentionLedger): void {
  writeFileSync(join(userDataDir, 'runtime-attention.json'), `${JSON.stringify(ledger, null, 2)}\n`)
}

/**
 * Decides whether a runtime candidate should be surfaced now.
 * `candidateFingerprint` changes when the candidate set changes, which re-arms
 * previously dismissed versions; blocked versions stay silent regardless.
 */
export function shouldPresentRuntimeCandidate(
  version: string,
  candidateFingerprint: string,
  ledger: RuntimeAttentionLedger,
  now: number = Date.now(),
): boolean {
  if (ledger.blocked.includes(version)) return false
  const dismissedAt = ledger.dismissed[version]
  if (dismissedAt === undefined) return true
  return dismissedAt < now && candidateFingerprint !== fingerprintAtDismissal(ledger, version)
}

function fingerprintAtDismissal(ledger: RuntimeAttentionLedger, version: string): string {
  const stored = (ledger.dismissed as Record<string, number | string>)[`fp:${version}`]
  return typeof stored === 'string' ? stored : ''
}

/** Records a dismissal; the version may be re-armed by a changed candidate fingerprint. */
export function dismissRuntimeCandidate(userDataDir: string, version: string, candidateFingerprint: string, now: number = Date.now()): RuntimeAttentionLedger {
  const ledger = loadRuntimeLedger(userDataDir)
  ledger.dismissed[version] = now
    ; (ledger.dismissed as Record<string, number | string>)[`fp:${version}`] = candidateFingerprint
  saveRuntimeLedger(userDataDir, ledger)
  return ledger
}

/** Records an explicit rejection; the version is never prompted again. */
export function blockRuntimeCandidate(userDataDir: string, version: string): RuntimeAttentionLedger {
  const ledger = loadRuntimeLedger(userDataDir)
  if (!ledger.blocked.includes(version)) ledger.blocked.push(version)
  delete ledger.dismissed[version]
  delete (ledger.dismissed as Record<string, number | string>)[`fp:${version}`]
  saveRuntimeLedger(userDataDir, ledger)
  return ledger
}

/** Notification seam (Electron Notification in the shell, fake in tests). */
export interface RuntimeCandidateNotifier {
  show(input: { title: string; body: string }): void
}

/** Presents the candidate as its own notification, visually distinct from shell updates. */
export function presentRuntimeCandidate(
  notifier: RuntimeCandidateNotifier,
  version: string,
  currentVersion: string | undefined,
): void {
  notifier.show({
    title: 'DSH runtime update available',
    body: currentVersion === undefined
      ? `Version ${version} is available for this desktop.`
      : `Version ${version} is available (current: ${currentVersion}). Manage runtimes in desktop settings.`,
  })
}
