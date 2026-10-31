// 「登录自启」卡：macOS/Windows 登录项开关。开关立即写 OS 登录项；
// 显示状态以 get 时 OS 读回为准；平台不支持时明说降级（不许静默）。
import React, { useEffect, useState } from 'react'
import { SectionBox } from '../chrome.tsx'
import { NOTE_STYLE, ROW_STYLE, WARN_NOTE_STYLE } from '../styles.ts'
import { nsSave } from '../rpc.ts'
import type { DesktopData } from '../types.ts'
import { usePlusT } from '../../i18n/provider.tsx'

export function LoginItemCard({ desktop }: { desktop: DesktopData }): React.ReactElement {
  const t = usePlusT()
  const [enabled, setEnabled] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const supported = desktop.login_item?.supported === true

  // 与电源卡同拍：设置弹窗每次挂载都按壳报的 OS 读回状态回填。
  useEffect(() => {
    setEnabled(desktop.login_item?.enabled === true)
  }, [desktop])

  const handleToggle = (next: boolean): void => {
    setEnabled(next)
    void nsSave({ login_item_enabled: next })
      .then(() =>
        setNote(
          next
            ? t('已保存：登录时自动启动 DSH Desktop Plus。')
            : t('已保存：不再随登录自动启动。'),
        ),
      )
      .catch((e) => setNote(t('保存失败：{message}', { message: String(e) })))
  }

  return (
    <SectionBox title={t('登录自启')}>
      {supported ? (
        <div style={ROW_STYLE}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              data-desktop-settings="login-item"
              checked={enabled}
              onChange={(e) => handleToggle(e.target.checked)}
            />
            {t('登录时自动启动 DSH Desktop Plus')}
          </label>
        </div>
      ) : (
        <div style={WARN_NOTE_STYLE}>{t('当前平台不支持登录自启。')}</div>
      )}
      {note && <div style={NOTE_STYLE}>{note}</div>}
    </SectionBox>
  )
}
