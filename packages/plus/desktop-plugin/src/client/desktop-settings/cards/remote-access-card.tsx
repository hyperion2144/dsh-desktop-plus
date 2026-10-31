// 「远程访问」卡：#144 网关心跳覆盖 + #147 路线 A 的手机端桌面布局开关。
//
// 两件事的来龙去脉不同，但原本就是同一张卡（#128 把布局开关从裸奔状态并进来），保持在一起。
// 心跳保存的回执写到「下载」卡的 note（onNote）——那是旧行为，本票不改，只在此注明。
import React, { useEffect, useRef, useState } from 'react'
import { PfBtn, SectionBox } from '../chrome.tsx'
import { INPUT_BASE_STYLE, LABEL_STYLE, NOTE_STYLE, ROW_STYLE } from '../styles.ts'
import { nsSave } from '../rpc.ts'
import type { DesktopData } from '../types.ts'
import { usePlusT } from '../../i18n/provider.tsx'

export function RemoteAccessCard({
  desktop,
  onNote,
}: {
  desktop: DesktopData
  onNote: (next: string | null) => void
}): React.ReactElement {
  const t = usePlusT()
  const [muxHeartbeatInput, setMuxHeartbeatInput] = useState<string>('30000')
  /** #175：移动端会话守卫的退避基数（壳键 mobile_guard_backoff_ms，缺省 10000）。 */
  const [guardBackoffInput, setGuardBackoffInput] = useState<string>('10000')
  const [guardBackoffNote, setGuardBackoffNote] = useState<string | null>(null)
  // #147 路线 A：布局开关的保存回执（就近显示；原先落在「下载」卡的共享 note 里，隔着一整张卡）

  // 壳键状态从持久化值回填（设置弹窗每次挂载都重读；只写不回填 = 关掉再进就丢）。
  // #175 真机反馈「输入多少都被重置成 2000」：原先两个字段共用一个依赖 `[desktop]` 的 effect，
  // 而壳每次刷新/重渲染都会换掉 desktop 对象（父层还有轮询与 refreshData），正在输入的值就被
  // 持久化值覆盖。现在按**标量**依赖分别回填，且焦点在输入框里时跳过——输入框不该由刷新节奏决定。
  const muxInputRef = useRef<HTMLInputElement>(null)
  const guardInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === muxInputRef.current) return
    const hb = desktop.mux_heartbeat_ms
    setMuxHeartbeatInput(typeof hb === 'number' ? String(hb) : '30000')
  }, [desktop.mux_heartbeat_ms])
  useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === guardInputRef.current) return
    const v = desktop.mobile_guard_backoff_ms
    setGuardBackoffInput(typeof v === 'number' && v > 0 ? String(v) : '10000')
  }, [desktop.mobile_guard_backoff_ms])

  /** #144：保存 dsh 网关心跳覆盖（mux_heartbeat_ms）。空/非数字→保留 30000；0 = 不覆盖。 */
  const handleSaveMuxHeartbeat = (): void => {
    const raw = muxHeartbeatInput.trim()
    const parsed = raw === '' ? 30000 : parseInt(raw, 10)
    if (Number.isNaN(parsed) || parsed < 0) {
      onNote(t('心跳间隔需为整数毫秒（0 = 不覆盖，回退 dsh 默认 2s）'))
      return
    }
    const v = Math.min(600000, parsed)
    void nsSave({ mux_heartbeat_ms: v })
      .then(() =>
        onNote(
          v === 0
            ? t('已保存：不覆盖心跳（dsh 默认 2s），重启 dsh 生效。')
            : t('已保存：mux 心跳 {value}ms（dsh 原生 2s），重启 dsh 生效。', { value: v }),
        ),
      )
      .catch((e) => onNote(t('保存失败：{message}', { message: String(e) })))
  }

  /** #175：保存移动端会话守卫退避基数；空/非数字 → 10000，区间 1s..600s（与壳侧 clamp 同口径）。 */
  const handleSaveGuardBackoff = (): void => {
    const raw = guardBackoffInput.trim()
    const parsed = raw === '' ? 10000 : parseInt(raw, 10)
    if (Number.isNaN(parsed) || parsed < 1000) {
      setGuardBackoffNote(t('退避基数需为 ≥1000 的整数毫秒（默认 10000）'))
      return
    }
    const v = Math.min(600000, parsed)
    void nsSave({ mobile_guard_backoff_ms: v })
      .then(() => setGuardBackoffNote(t('已保存：会话守卫退避基数 {value}ms，重启 dsh 生效。', { value: v })))
      .catch((e) => setGuardBackoffNote(t('保存失败：{message}', { message: String(e) })))
  }


  return (
    <SectionBox title={t('远程访问')}>
      <div style={ROW_STYLE}>
        <input
          placeholder="30000"
          ref={muxInputRef}
          data-desktop-settings="mux-heartbeat-ms"
          style={{ ...INPUT_BASE_STYLE, width: 100 }}
          value={muxHeartbeatInput}
          onChange={(e) => setMuxHeartbeatInput(e.target.value)}
        />
        <PfBtn variant="ghost" onClick={handleSaveMuxHeartbeat}>{t('保存')}</PfBtn>
      </div>
      <div style={NOTE_STYLE}>
        {t('dsh 网关对 ')}<code>/api/remote.mux</code>{t(' 的心跳间隔（毫秒）。dsh 原生 2s 且连丢 2 次即断开，移动端切后台/弱网会被秒判死（表现为「能发消息、收不到新消息」）；壳默认覆盖为 30000。填 0 = 不覆盖（回退 dsh 默认），改动重启 dsh 生效。')}
      </div>
      {/* #175：会话守卫的退避基数（弱网抖动容忍度）——与心跳同卡，语义不同，分开两段。 */}
      <div style={{ ...LABEL_STYLE, marginTop: 12 }}>{t('移动端会话守卫')}</div>
      <div style={ROW_STYLE}>
        <input
          placeholder="10000"
          data-desktop-settings="mobile-guard-backoff-ms"
          style={{ ...INPUT_BASE_STYLE, width: 100 }}
          value={guardBackoffInput}
          onChange={(e) => setGuardBackoffInput(e.target.value)}
          ref={guardInputRef}
        />
        <PfBtn variant="ghost" onClick={handleSaveGuardBackoff}>{t('保存')}</PfBtn>
      </div>
      <div style={NOTE_STYLE}>
        {t('移动端壳探测到会话失效时，第 2 次起按「基数 × 2^(n-2)」退避重连（封顶 30s）。默认 10000ms；调大能减少弱网下的「断—重连」抖动，代价是恢复变慢。改动重启 dsh 生效。')}
      </div>
      {guardBackoffNote && <div style={NOTE_STYLE}>{guardBackoffNote}</div>}
      <div style={NOTE_STYLE}>
        {t('手机上的卡顿来自宿主前端（会话整段挂载 + 逐块代码高亮），不是网络。勾选后手机走与 iPad 相同的桌面布局：明显更流畅，代价是排版更挤（可横屏缓解）。不勾选 = 移动布局。改动重启 dsh 生效。')}
      </div>
    </SectionBox>
  )
}
