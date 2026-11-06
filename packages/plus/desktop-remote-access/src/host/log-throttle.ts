//! 失败日志节流：同一条失败在一个窗口内只报一次。
//!
//! 轮询型任务（镜像同步每 800ms 一轮）遇到对端掉线时，同一条失败会连续出现；逐条打日志会把日志刷爆，
//! 也让真正的原因淹没在重复里。这里只做判定：调用方拿到要打的文本再自己去打。

/** 一次失败日志节流器的表面。 */
export interface FailureThrottle {
  /**
   * 登记一次失败。
   * @param key 失败的主体（如会话 id），不同主体互不影响。
   * @param message 失败原因。
   * @returns 这次应当写进日志的文本；返回 undefined 表示窗口内的重复，应当抑制。
   */
  report: (key: string, message: string) => string | undefined
  /** 主体成功时清掉记录，下一次失败重新算首次。 */
  clear: (key: string) => void
}

/**
 * 建一个失败日志节流器。
 * @param intervalMs 同一条失败的汇总间隔（毫秒）。
 * @param now 取当前时间的函数；可注入以便测试。
 * @returns 节流器。
 */
export function createFailureThrottle(intervalMs: number, now: () => number = Date.now): FailureThrottle {
  const seen = new Map<string, { message: string, at: number, suppressed: number }>()
  return {
    report(key, message) {
      const previous = seen.get(key)
      const at = now()
      if (previous === undefined || previous.message !== message) {
        seen.set(key, { message, at, suppressed: 0 })
        return message
      }
      if (at - previous.at < intervalMs) {
        previous.suppressed += 1
        return undefined
      }
      const text = `${message}（这一分钟又重复了 ${String(previous.suppressed)} 次，已抑制）`
      seen.set(key, { message, at, suppressed: 0 })
      return text
    },
    clear(key) {
      seen.delete(key)
    },
  }
}
