// 「下载」卡：并发上限（#72）。
//
// ⚠️ 本卡渲染的 note **不只**由自己写：远程访问卡保存 mux 心跳时也往这里回执（见 remote-access-card.tsx 的 onNote）。
// 这是 2024 年就有的耦合——用户在上方那张卡点了保存，回执出现在下面这张卡里。#144 要求行为零变化，
// 所以这里原样保留，由面板把同一条 note 状态同时喂给两张卡。要修的话另开一张票，两边各自持有 note。
import React, { useEffect, useRef, useState } from 'react'
import { PfBtn, SectionBox } from '../chrome.tsx'
import { INPUT_BASE_STYLE, NOTE_STYLE, ROW_STYLE } from '../styles.ts'
import { invoke, nsSave } from '../rpc.ts'
import { usePlusT } from '../../i18n/provider.tsx'

export function DownloadCard({
  note,
  onNote,
}: {
  note: string | null
  onNote: (next: string | null) => void
}): React.ReactElement {
  const t = usePlusT()
  const [concurrencyInput, setConcurrencyInput] = useState<string>('3')
  const concurrencyTouchedRef = useRef(false)

  // ── 下载并发上限：mount 拉一次，未触摸前用 IPC 值覆盖默认。──
  useEffect(() => {
    invoke<{ concurrency: number }>('get_download_settings')
      .then((s) => {
        if (!concurrencyTouchedRef.current) setConcurrencyInput(String(s.concurrency))
      })
      .catch(() => { /* 无 IPC 保持默认 3 */ })
  }, [])

  const handleSaveConcurrency = (): void => {
    const v = Math.max(1, Math.min(32, parseInt(concurrencyInput, 10) || 3))
    void nsSave({ download_concurrency: v })
      .then(() => invoke('set_download_concurrency', { value: v }))
      .then(() => onNote(t('已保存：并发上限 {value}', { value: v })))
      .catch(() => onNote(t('保存失败（无 Tauri IPC？）')))
  }

  return (
    <SectionBox title={t('下载')}>
      <div style={ROW_STYLE}>
        <input
          placeholder="1-32"
          data-desktop-settings="download-concurrency"
          style={{ ...INPUT_BASE_STYLE, width: 80 }}
          value={concurrencyInput}
          onChange={(e) => {
            concurrencyTouchedRef.current = true
            setConcurrencyInput(e.target.value)
          }}
        />
        <PfBtn variant="ghost" onClick={handleSaveConcurrency}>{t('保存')}</PfBtn>
      </div>
      {note && <div style={NOTE_STYLE}>{note}</div>}
      <div style={NOTE_STYLE}>{t('同时进行的下载数上限，超出排队；改动立即生效。')}</div>
    </SectionBox>
  )
}
