// 「dsh 服务地址」卡：壳要连的 dsh 服务来源（本机 or 远程），可增删地址列表。
// 三个动作的语义各不相同：切换立即重启 dsh；新增/删除只改列表，重启后才生效。
import React, { useState } from 'react'
import { PfBtn, SectionBox } from '../chrome.tsx'
import { FLEX_1_STYLE, NOTE_STYLE, ROW_STYLE } from '../styles.ts'
import { invoke, nsSave } from '../rpc.ts'
import { normalizeRemote } from '../format.ts'
import type { DesktopData, Notify } from '../types.ts'
import { usePlusT } from '../../i18n/provider.tsx'

export function ServiceAddressCard({
  desktop,
  refreshData,
  notify,
}: {
  desktop: DesktopData
  refreshData: () => Promise<void>
  notify: Notify
}): React.ReactElement {
  const t = usePlusT()
  const [newRemoteUrl, setNewRemoteUrl] = useState('')
  const [renamingAddr, setRenamingAddr] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  // 地址 → 自定义名字。名字只是显示用，地址本身仍是唯一键（切换 profile 靠地址）。
  // 名字可能挂在两处：合并后的 remote_names，或壳原样回吐的 settings 段。
  const remoteNames = (desktop as unknown as {
    remote_names?: Record<string, string>
    settings?: { remote_names?: Record<string, string> }
  })
  const names = remoteNames.remote_names ?? remoteNames.settings?.remote_names ?? {}

  // 只做维护（新增/删除）。切到哪个地址是托盘里「Profile 管理」的事：一个远程地址就是一个 profile。

  const handleAddRemote = (): void => {
    const addr = normalizeRemote(newRemoteUrl)
    if (!addr) {
      notify({ ok: false, text: t('地址非法：需 dsh web 完整 URL（含 token）或 host[:port]') })
      return
    }
    void (async () => {
      try {
        const list = Array.isArray(desktop.remote_list) ? [...desktop.remote_list] : []
        if (!list.includes(addr)) list.push(addr)
        await nsSave({ remote_list: list })
        setNewRemoteUrl('')
        notify({ ok: true, text: t('已新增地址：{address}（到托盘 → Profile 管理里切换）', { address: addr }) })
        await refreshData()
      } catch (err) {
        notify({ ok: false, text: t('新增失败：{message}', { message: String(err) }) })
      }
    })()
  }

  const handleRemoveRemote = (addr: string): void => {
    void (async () => {
      try {
        const list = (desktop.remote_list ?? []).filter((a) => a !== addr)
        const patch: Record<string, unknown> = { remote_list: list }
        await nsSave(patch)
        notify({ ok: true, text: t('已删除：{address}', { address: addr }) })
      } catch (err) {
        notify({ ok: false, text: t('删除失败：{message}', { message: String(err) }) })
      }
      await refreshData()
    })()
  }

  const handleRenameRemote = (addr: string): void => {
    const name = renameDraft.trim()
    if (name === '') {
      notify({ ok: false, text: t('名字不能为空') })
      return
    }
    void (async () => {
      try {
        await nsSave({ remote_names: { ...names, [addr]: name } })
        setRenamingAddr('')
        notify({ ok: true, text: t('已重命名：{name}', { name }) })
        await refreshData()
      } catch (err) {
        notify({ ok: false, text: t('重命名失败：{message}', { message: String(err) }) })
      }
    })()
  }

  return (
    <SectionBox title={t('dsh 服务地址')}>
      {/* 这里不摆「选地址切换」：切换入口在托盘 → Profile 管理（一个远程地址 = 一个 profile）。 */}

      {/* 新增地址行 */}
      <div style={ROW_STYLE}>
        <input
          placeholder={t('新增：dsh web 打印的完整 URL（含 token）或 host[:port]')}
          className="pf-input"
          style={FLEX_1_STYLE}
          data-desktop-settings="remote-add"
          value={newRemoteUrl}
          onChange={(e) => setNewRemoteUrl(e.target.value.trim())}
        />
        <PfBtn variant="ghost" onClick={handleAddRemote}>{t('新增')}</PfBtn>
      </div>

      {/* 地址删除行 */}
      {desktop.remote_list.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {desktop.remote_list.map((addr) => (
            <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', width: '100%' }}>
              {renamingAddr === addr ? (
                <>
                  <input
                    className="pf-input"
                    style={{ width: 180 }}
                    aria-label={t('地址名称')}
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameRemote(addr)
                      if (e.key === 'Escape') setRenamingAddr('')
                    }}
                  />
                  <PfBtn variant="ghost" style={{ fontSize: 11 }} onClick={() => handleRenameRemote(addr)}>{t('保存')}</PfBtn>
                  <PfBtn variant="ghost" style={{ fontSize: 11 }} onClick={() => setRenamingAddr('')}>{t('取消')}</PfBtn>
                </>
              ) : (
                <>
                  <span
                    title={addr}
                    style={{
                      fontSize: 12,
                      flex: '1 1 220px',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                      {names[addr] || addr}
                  </span>
                  <PfBtn
                    variant="ghost"
                    style={{ fontSize: 11 }}
                      onClick={() => { setRenamingAddr(addr); setRenameDraft(names[addr] || '') }}
                  >
                    {t('重命名')}
                  </PfBtn>
                  <PfBtn
                    variant="danger"
                    style={{ fontSize: 11 }}
                    onClick={() => handleRemoveRemote(addr)}
                  >
                    {t('删除')}
                  </PfBtn>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={NOTE_STYLE}>
        {t('这里只维护地址列表；用哪个地址去「托盘 → Profile 管理」选（一个远程地址就是一个 profile）。')}
      </div>
      <div style={NOTE_STYLE}>
        {t('此处的地址是桌面壳连接的 dsh 服务来源（壳将直连该地址，不再拉起本地服务）；若要给手机/其它设备连接本机，请用「远程访问」。')}
      </div>
    </SectionBox>
  )
}
