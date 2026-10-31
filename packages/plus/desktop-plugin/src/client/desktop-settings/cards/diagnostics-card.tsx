// 「日志与诊断」卡：一个按钮导出快照，用户报问题时直接发文件（#220）。
// 自带挂载读一次 + 导出结果，不碰面板其它状态。
import React, { useEffect, useState } from 'react'
import { PfBtn, SectionBox, showToast } from '../chrome.tsx'
import { LoggingSection } from './logging-controls.tsx'
import { NOTE_STYLE } from '../styles.ts'
import { invoke } from '../rpc.ts'
import { usePlusT } from '../../i18n/provider.tsx'

export function DiagnosticsCard(): React.ReactElement {
  const t = usePlusT()
  const [diagSummary, setDiagSummary] = useState<string | null>(null)
  const [diagLogPath, setDiagLogPath] = useState<string | null>(null)
  const [diagExport, setDiagExport] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // 失败只当没有——诊断读取不该挡住设置面板
    void invoke<{ diagnostics?: Record<string, unknown> }>('get_diagnostics')
      .then((r) => {
        if (cancelled) return
        const snapshot = r.diagnostics as { appVersion?: string; profile?: string; pid?: number; logDir?: string }
        if (typeof snapshot.appVersion === 'string' && snapshot.appVersion !== '') {
          setDiagSummary(t('版本 {version} · profile {profile} · pid {pid}', { version: snapshot.appVersion, profile: snapshot.profile ?? '—', pid: snapshot.pid ?? '—' }))
        }
        if (typeof snapshot.logDir === 'string' && snapshot.logDir !== '') setDiagLogPath(snapshot.logDir)
      })
      .catch((error: unknown) => {
              console.warn(`[dsh-desktop-plus] 读取诊断快照失败：${String(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SectionBox title={t('日志与诊断')}>
      <div style={NOTE_STYLE}>{diagSummary === null ? t('读取中…') : diagSummary}</div>
      {diagLogPath !== null && <div style={NOTE_STYLE}>{t('壳日志：')}{diagLogPath}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <PfBtn
          variant="ghost"
          onClick={() => {
            void invoke<{ path: string; bytes: number }>('export_diagnostics')
              .then((r) => {
                setDiagExport(r.path)
                showToast(t('诊断已导出：{path}', { path: r.path }), true)
              })
              .catch((e: unknown) => showToast(t('导出失败：{message}', { message: String(e) }), false))
          }}
        >
          {t('导出诊断')}
        </PfBtn>
        <PfBtn
          variant="ghost"
          onClick={() => {
            void invoke<{ diagnostics?: Record<string, unknown> }>('get_diagnostics')
              .then((r) => {
                const logDir = (r.diagnostics as { logDir?: unknown } | undefined)?.logDir
                if (typeof logDir === 'string' && logDir !== '') showToast(t('日志目录：{path}', { path: logDir }), true)
                else showToast(t('诊断里没有日志路径'), false)
              })
              .catch((e: unknown) => showToast(t('读取失败：{message}', { message: String(e) }), false))
              }}
        >
          {t('显示日志路径')}
        </PfBtn>
      </div>
      {diagExport !== null && <div style={NOTE_STYLE}>{t('上次导出：')}{diagExport}</div>}
            {/* #221 统一日志管理：级别 / 保留与清理 / 导出（子区段共用本卡唯一 SectionBox，M1） */}
            <LoggingSection />
        </SectionBox>
    )
}
