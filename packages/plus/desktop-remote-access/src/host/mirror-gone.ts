//! 镜像「对方已删除」的确认。
//!
//! 对端说「找不到」不一定是真没了；就算对端的会话清单里没有，也未必是删了——对端正在停机的那几秒，
//! 会话库可能短暂返回一份空清单。只凭一次就注销镜像，会让正要被接管的镜像在瞬间消失（实测）。
//! 所以要连续两次、间隔不短于设定值都得到「不在清单里」才算；中途出现在清单里或清单问不到就重新计。

/** 一次核对的结论：`present` 在清单里；`absent` 不在清单里；`unknown` 清单没拿到。 */
export type GoneVerdict = 'present' | 'absent' | 'unknown'

/**
 * 建一个确认器。
 * @param options.gapMs 两次「不在清单里」之间至少隔多久，缺省 10 秒。
 * @param options.now 时钟。
 * @returns `(sessionId, verdict) => boolean`：返回 true 才表示可以认定对方已删除。
 */
export function createGoneConfirm(options: { gapMs?: number, now?: () => number } = {}): (sessionId: string, verdict: GoneVerdict) => boolean {
  const gapMs = options.gapMs ?? 10_000
  const now = options.now ?? ((): number => Date.now())
  const firstAbsentAt = new Map<string, number>()
  return (sessionId, verdict) => {
    if (verdict !== 'absent') {
      firstAbsentAt.delete(sessionId)
      return false
    }
    const at = now()
    const first = firstAbsentAt.get(sessionId)
    if (first === undefined || at - first < gapMs) {
      if (first === undefined) firstAbsentAt.set(sessionId, at)
      return false
    }
    firstAbsentAt.delete(sessionId)
    return true
  }
}
