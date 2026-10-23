/** Ensure every shipped profile composes the plus bundles through the official layer list. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

/**
 * The plus bundles every desktop profile composes, in layer order. Both ship
 * inside the installation (`dsh/node_modules` via the cli dependency closure),
 * so listing them here is exactly how official bundles mount: the host layers
 * each bundle's own `cordis.patch.yml` over the profile composition.
 */
export const PLUS_BUNDLE_NAMES: readonly string[] = [
  '@deepseek-ai/dsh-desktop-plus-plugin',
    '@deepseek-ai/dsh-desktop-plus-remote-access',
    '@deepseek-ai/dsh-desktop-plus-brand',
]

interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: readonly string[] } }
}

/**
 * Ensure every shipped profile composes the plus bundles through the official layer list.
 *
 * @param dirs - Profile directories (each holding `package.json`).
 * @param baseBundles - The shipped template layer list a created manifest starts from.
 * @param log - Progress sink for appended/created lines.
 */
export function ensurePlusProfileBundles(
  dirs: readonly string[], baseBundles: readonly string[], log: (line: string) => void,
): void {
  for (const dir of dirs) {
    const manifestPath = join(dir, 'package.json')
    let manifest: ProfileManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
    } catch {
      // 未初始化的 profile：按宿主 initProfile 的落盘形状预建，宿主 loadProfile 直接采用。
      const base = manifestPath.split(sep).at(-2) ?? 'profile'
      manifest = { name: `dsh-profile-${base}`, private: true, dependencies: {}, dsh: { profile: { bundles: [...baseBundles] } } }
      log(`profile bundles: created ${dir}`)
    }
    const bundles = manifest.dsh?.profile?.bundles
    if (bundles === undefined) continue
    const missing = PLUS_BUNDLE_NAMES.filter((name) => !bundles.includes(name))
    if (missing.length === 0) continue
    manifest.dsh = { ...manifest.dsh, profile: { bundles: [...bundles, ...missing] } }
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    log(`profile bundles: +${missing.join(', ')} (${dir})`)
  }
}
