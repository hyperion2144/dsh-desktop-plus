import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PlusBrandMark, PlusBrandName } from './Brand.tsx'

/** Build profile injected at bundle time; `official` keeps the official brand package. */
declare const __PLUS_BUILD_PROFILE__: string | undefined

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Occupy the sidebar brand slots for the plus desktop build. The official brand
 * package keeps `official` builds; every other build profile (including unset,
 * which is what the plus packaging produces) shows the plus brand.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (__PLUS_BUILD_PROFILE__ === 'official') return
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function*() {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PlusBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, PlusBrandName)
    }))
}
