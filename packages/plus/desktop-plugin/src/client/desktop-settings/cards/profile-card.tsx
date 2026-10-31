// 「Profile」卡：新建/删除 profile；desktop 是默认项，不提供切换。
import React from 'react'
import { usePlusT } from '../../i18n/provider.tsx'
import { PfBtn, SectionBox } from '../chrome.tsx'
import { INPUT_BASE_STYLE, NOTE_STYLE, ROW_STYLE } from '../styles.ts'
import { invoke, nsSave } from '../rpc.ts'
import type { DesktopData, Notify } from '../types.ts'

export function ProfileCard({
  desktop,
  notify,
}: {
  desktop: DesktopData
  notify: Notify
}): React.ReactElement {
  const t = usePlusT()


  // 新建/删除 profile：走壳侧 RPC（官方 initProfile 脚手架 / 受保护的整目录删除）。
  const [newProfileName, setNewProfileName] = React.useState('')
  const [profileBusy, setProfileBusy] = React.useState(false)

  const runProfileMutation = (method: 'create_profile' | 'delete_profile', name: string, done: string): void => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      notify({ ok: false, text: t('Profile 名只能用小写字母、数字与连字符') })
      return
    }
    setProfileBusy(true)
    void (async () => {
      try {
        const result = await invoke<{ ok: boolean; reason?: string }>(method, { name })
        if (!result.ok) throw new Error(result.reason ?? t('未知原因'))
        setNewProfileName('')
        notify({ ok: true, text: done })
      } catch (err) {
        notify({ ok: false, text: t('{action} Profile 失败：{message}', { action: method === 'create_profile' ? t('新建') : t('删除'), message: String(err) }) })
      } finally {
        setProfileBusy(false)
      }
    })()
  }

  const handleCreateProfile = (): void => {
    const name = newProfileName.trim()
    runProfileMutation('create_profile', name, t('已新建 Profile「{name}」', { name }))
  }

  const handleDeleteProfile = (): void => {
    const name = newProfileName.trim()
    if (name === '') {
      notify({ ok: false, text: t('先输入要删除的 profile 名') })
      return
    }
    runProfileMutation('delete_profile', name, t('已删除 Profile「{name}」', { name }))
  }

  return (
    <SectionBox title={t('Profile')}>
      <div style={ROW_STYLE}>
        <input
          placeholder={t('新 profile 名（小写/数字/-）')}
          data-desktop-settings="profile-new-name"
          style={{ ...INPUT_BASE_STYLE, flex: 1 }}
          value={newProfileName}
          onChange={(e) => { setNewProfileName(e.target.value) }}
        />
        <PfBtn variant="ghost" disabled={profileBusy} onClick={handleCreateProfile}>{t('新建')}</PfBtn>
      </div>
      <div style={ROW_STYLE}>
        <PfBtn variant="ghost" disabled={profileBusy} onClick={handleDeleteProfile}>{t('删除 Profile')}</PfBtn>
      </div>
      <div style={NOTE_STYLE}>{t('新建会在 $DSH_HOME/profiles 下建独立 profile；删除会整目录移除，desktop 为默认项不可删。')}</div>
    </SectionBox>
  )
}
