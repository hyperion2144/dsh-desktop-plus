import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Plus build version injected at bundle time by the packaging chain (esbuild define). */
declare const __PLUS_BUILD_VERSION__: string

/**
 * Render the plus mark: the harness fish, matching the official mark geometry.
 * @param props - Host-supplied mark presentation.
 * @returns the plus brand mark.
 */
export function PlusBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/**
 * Render the plus product name with the plus build version badge beneath it,
 * mirroring the local-build fallback's two-line layout.
 * @returns the plus brand name block.
 */
export function PlusBrandName() {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 1, height: 24, whiteSpace: 'nowrap', userSelect: 'none' }}>
      <span style={{ fontSize: 12, lineHeight: '13px', letterSpacing: 0, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' }}>DSH Desktop Plus</span>
      {__PLUS_BUILD_VERSION__ !== '' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', height: 10, padding: '0 3px', borderRadius: 2, color: 'var(--dsw-alias-label-primary-inverted)', background: 'var(--dsw-alias-label-primary)', fontFamily: 'var(--ds-font-family-code)', fontSize: 6, fontWeight: 500, lineHeight: '10px', whiteSpace: 'nowrap' }}>{__PLUS_BUILD_VERSION__}</span>
      )}
    </span>
  )
}
