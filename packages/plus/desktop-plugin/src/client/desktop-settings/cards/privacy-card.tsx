// 「隐私」卡：官方遥测与桌面专属数据上报的总开关。
// 两处采集都在 web-app bundle 的同一份 patch 里（OTLP 上报 + 桌面专属采集），
// 壳按这个设置给宿主进程注入 DSH_PLUS_DISABLE_TELEMETRY=1，bundle 行看到即整行禁用；
// 改动重启 dsh 后生效（与端口/代理同一口径）。
import React, { useEffect, useState } from 'react'
import { SectionBox } from '../chrome.tsx'
import { NOTE_STYLE, ROW_STYLE } from '../styles.ts'
import { nsSave } from '../rpc.ts'
import type { DesktopData } from '../types.ts'
import { usePlusT } from '../../i18n/provider.tsx'

export function PrivacyCard({ desktop }: { desktop: DesktopData }): React.ReactElement {
  const t = usePlusT()
  const [optOut, setOptOut] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // 壳键状态从持久化值回填（设置文件里的 disable_telemetry；缺省=开着遥测）。
  useEffect(() => {
    setOptOut(desktop.settings?.disable_telemetry === true)
  }, [desktop])

  /** 遥测 opt-out：即时落盘；宿主进程要重启后才带上禁用变量。 */
  const handleToggle = (next: boolean): void => {
    setOptOut(next)
    void nsSave({ disable_telemetry: next })
      .then(() =>
        setNote(
          next
            ? t('已保存：遥测与数据上报将在 dsh 重启后完全关闭。')
            : t('已保存：遥测与数据上报恢复默认（重启 dsh 后生效）。'),
        ),
      )
      .catch((e) => setNote(t('保存失败：{message}', { message: String(e) })))
  }

  return (
    <SectionBox title={t('隐私与遥测')}>
      <div style={ROW_STYLE}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            data-desktop-settings="disable-telemetry"
            checked={optOut}
            onChange={(e) => handleToggle(e.target.checked)}
          />
          {t('关闭官方遥测与数据上报')}
        </label>
      </div>
      {note && <div style={NOTE_STYLE}>{note}</div>}
      <div style={NOTE_STYLE}>
        {t('关闭后一并停用桌面专属采集（环境探测与压缩事件上报）；改动重启 dsh 后生效。')}
      </div>
    </SectionBox>
  )
}
