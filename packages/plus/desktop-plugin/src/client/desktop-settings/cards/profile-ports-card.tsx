// 「Profile 端口」卡：每个 profile 一行（页面口展示 / lane 口按 profile 单独配置）。
// 页面口与上游口是壳/宿主随机分配的内部口：不展示、不可编辑；lane 口保存的是期望值，
// 重启对应 profile（或壳）后由宿主的 remote-access 插件按新口起 lane。
import React, { useEffect, useState } from 'react'
import { PfBtn, PortCell, SectionBox } from '../chrome.tsx'
import { DANGER_NOTE_STYLE, INPUT_BASE_STYLE, LABEL_STYLE, NOTE_STYLE, ROW_STYLE } from '../styles.ts'
import { invoke, nsSave } from '../rpc.ts'
import type { ProfilePortRow } from '../types.ts'
import { usePlusT } from '../../i18n/provider.tsx'

export function ProfilePortsCard(): React.ReactElement {
  const t = usePlusT()
  const [rows, setRows] = useState<ProfilePortRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [laneInputs, setLaneInputs] = useState<Record<string, string>>({})
  const [note, setNote] = useState<string | null>(null)


  // 端口表：mount 拉一次；壳侧给的是磁盘全量 profile 的真值（含未运行的）。
  useEffect(() => {
    let cancelled = false
    invoke<ProfilePortRow[]>('list_profile_ports')
      .then((r) => { if (!cancelled) { setRows(r); setLoadError(null) } })
      .catch((err) => { if (!cancelled) setLoadError(String(err)) })
    return () => { cancelled = true }
  }, [])

  const parsePortInput = (raw: string): number | null => {
    const v = Number(raw.trim())
    return raw.trim() !== '' && Number.isSafeInteger(v) && v > 0 && v < 65536 ? v : null
  }

  // lane 口覆盖是嵌套对象（profile_lane_ports）：读现值 → 合并 → 整对象保存（设置存储是浅合并）。
  const saveLanePort = (profile: string): void => {
    const value = parsePortInput(laneInputs[profile] ?? '')
    if (value === null) { setNote(t('端口必须是 1-65535 的整数')); return }
    const patch = (async (): Promise<Record<string, unknown>> => {
      const current = await invoke<{ settings?: Record<string, unknown> }>('get_desktop_settings_data')
      const saved = current.settings?.['profile_lane_ports']
      const merged = typeof saved === 'object' && saved !== null ? { ...(saved as Record<string, unknown>) } : {}
      merged[profile] = value
      return { profile_lane_ports: merged }
    })()
    void patch
      .then((p) => nsSave(p))
      .then(() => setNote(t('{profile} 的 lane 口已改为 {value}；重启该 profile 后生效。', { profile, value })))
      .catch((err) => setNote(t('保存失败：{message}', { message: String(err) })))
  }
  return (
    <SectionBox title={t('Profile 端口')}>
      {loadError !== null ? (
        <div style={DANGER_NOTE_STYLE}>{t('端口表加载失败：')}{loadError}</div>
      ) : rows === null ? (
        <div style={NOTE_STYLE}>{t('加载中…')}</div>
      ) : (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[t('Profile'), t('页面端口'), t('Lane 端口'), t('状态')].map((h) => (
                <th key={h} style={{ textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.profile}>
                <td>{r.profile}</td>
                <td style={{ opacity: 0.7 }}>{r.page_port === null ? '—' : String(r.page_port)}</td>
                <td>
                  <PortCell
                    testId={`profile-lane-port-${r.profile}`}
                    placeholder={String(r.lane_port)}
                    value={laneInputs[r.profile] ?? ''}
                    onChange={(v) => setLaneInputs((prev) => ({ ...prev, [r.profile]: v }))}
                    onEnter={() => saveLanePort(r.profile)}
                    onSave={() => saveLanePort(r.profile)}
                  />
                </td>
                <td style={{ color: r.running ? 'var(--dsw-alias-state-success-primary,#2fbf71)' : 'var(--dsw-alias-label-secondary,#9aa4b2)' }}>
                  {r.running ? `● ${t('运行中')}` : t('未运行')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note !== null && <div style={NOTE_STYLE}>{note}</div>}
      <div style={NOTE_STYLE}>
        {t('页面口与上游口由系统随机分配（内部口，不展示也不可改）；lane 口是手机代理的入口，按 profile 单独配置，输入框展示当前实际端口，改动保存后重启该 profile 生效。')}
      </div>
    </SectionBox>
  )
}
