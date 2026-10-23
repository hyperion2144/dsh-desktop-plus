import { Menu, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import {
  dispatchApplicationClick,
  trayMenuOrder,
  dispatchProfileClick,
  resolveProfileClick,
  type TrayProfileActions,
  type TrayWindowState,
} from './menu-model.ts'

/** one profile row as the tray renders it. */
export type ProfileTrayRow = {
  name: string
  running: boolean
  /** 宿主/页面端口，运行中才有；拿不到就不显示。 */
  port?: number | null
  /** 远程 profile：入口来自 desktop-settings 的 remote_list，重启经 lane 代理下发。 */
  remote?: boolean
}

/** sources the tray reads on every refresh; all getters re-read live state. */
export type ProfileTrayDeps = {
  /** absolute path of the tray icon image. */
  /** 托盘图标：路径或已处理好的 nativeImage（macOS 传模板图，避免放大发糊）。 */
  icon: string | NativeImage
  /** ordered live profile entries: name, running flag, port, remote marker. */
  getStates: () => ProfileTrayRow[]
  /** live window facts for one profile; missing profile reads as hidden. */
  getWindowState: (name: string) => TrayWindowState
  /** localized labels; `manage` names the top-level profile section. */
  labels: {
    manage: string
    restartApp: string
    quitApp: string
    /** 窗口可见时菜单项写「隐藏」，不可见时写「显示」。 */
    show: string
    hide: string
    restart: string
    restartRemote: string
    quit: string
    startProfile: string
    newProfile?: string
    migrateProfile?: string
  }
  /** injected click operations. */
  actions: TrayProfileActions
  /** 新建/迁移入口：没接就不出现在菜单里，不摆点了没反应的项。 */
  onNewProfile?: (() => void) | undefined
  onMigrateProfile?: (() => void) | undefined
  /** 删除单个 profile 的入口：挂在该 profile 子菜单里，确认与护栏归壳负责。 */
  onDeleteProfile?: ((name: string) => void) | undefined
  /** 托盘左键行为：show-hide=切默认 profile 窗口；menu=弹菜单（默认）。设置里可改并持久化。 */
  clickBehavior?: (() => 'show-hide' | 'menu') | undefined
  /** 左键切窗口时的目标 profile（默认 desktop）。 */
  clickTargetProfile?: (() => string) | undefined
  /** 动作完成后重建菜单（隐藏/显示后文案要翻转）。 */
  onAfterAction?: (() => void) | undefined
  /** 应用级条目（状态/更新/命令等，与官方应用菜单对齐）：由壳提供，托盘只负责插在 Profile 管理下面。 */
  extraItems?: (() => MenuItemConstructorOptions[]) | undefined
}

/** live handle of the plus profile tray. */
export type ProfileTray = {
  /** rebuilds the menu from current state without recreating the Tray. */
  refresh: () => void
  /** removes the tray icon; safe to call again. */
  destroy: () => void
}

/**
 * Creates the tray whose top level is 「Profile 管理」.
 *
 * 一级菜单只有两块：Profile 管理（每个 profile 一个子菜单：显示/隐藏、重启、退出，
 * 远程 profile 的重启就是「重启远程桌面」）+ 应用级的重启/退出。托盘不另列「远程地址」，
 * 一个远程地址就是一个 profile。
 *
 * @param deps icon, live state getters, localized labels, and click actions.
 * @returns the tray handle; `refresh` re-reads state on every call.
 */
export function createProfileTray(deps: ProfileTrayDeps): ProfileTray {
  const tray = new Tray(deps.icon)
  tray.setToolTip('DSH Desktop Plus')
  const build = (): void => {
    const profileItems: MenuItemConstructorOptions[] = deps.getStates().map((state) => {
      const suffix = state.running ? (state.port == null ? '' : ` · ${String(state.port)}`) : '（未运行）'
      const head = `${state.remote === true ? '远程 · ' : ''}${state.name}${suffix}`
      return {
        label: head,
        submenu: [
          (() => {
            // 菜单项文案就是这次点击的语义：写「隐藏」就隐藏，写「显示」就显示/聚焦。
            // 旧写法在点击时再按现场聚焦状态重新判定，窗口在菜单弹出的瞬间失焦，
            // 就会变成「点了隐藏却只是聚焦」——文案与实际行为对不上。
            // 远程未开窗与本地未运行同义：菜单项是「启动」；开着窗口才切「显示/隐藏」。
            if (!state.running || (state.remote === true && !deps.getWindowState(state.name).visible)) {
              return {
                label: deps.labels.startProfile,
                click: () => { deps.actions.startProfile(state.name); deps.onAfterAction?.() },
              }
            }
            const visible = deps.getWindowState(state.name).visible
            return {
              label: visible ? deps.labels.hide : deps.labels.show,
              click: () => {
                if (visible) deps.actions.hide(state.name)
                else deps.actions.showOrFocus(state.name)
                deps.onAfterAction?.()
              },
            }
          })(),
          {
            label: state.remote === true ? deps.labels.restartRemote : deps.labels.restart,
            enabled: state.running,
            click: () => { dispatchProfileClick(state.name, 'restart', deps.getWindowState(state.name), deps.actions) },
          },
          {
            label: deps.labels.quit,
            enabled: state.running,
            click: () => { dispatchProfileClick(state.name, 'quit', deps.getWindowState(state.name), deps.actions) },
          },
          // 删除挂在具体 profile 下：远程地址与运行中的 profile 不给入口，不给点不动的项。
          ...(deps.onDeleteProfile === undefined || state.remote === true || state.running ? [] : [{
            label: '删除',
            click: () => { deps.onDeleteProfile?.(state.name) },
          }]),
        ],
      }
    })
    if (profileItems.length === 0) {
      profileItems.push({ label: '（没有 profile）', enabled: false })
    }
    const profileExtras: MenuItemConstructorOptions[] = []
    if (deps.onNewProfile !== undefined) {
      profileExtras.push({ type: 'separator' }, {
        label: deps.labels.newProfile ?? 'New Profile…',
        click: () => { deps.onNewProfile?.() },
      })
    }
    if (deps.onMigrateProfile !== undefined) {
      profileExtras.push({
        label: deps.labels.migrateProfile ?? 'Migrate Profile…',
        click: () => { deps.onMigrateProfile?.() },
      })
    }
    // 应用级条目由壳提供（状态/更新/注册命令/开发者工具）：托盘只负责摆位置，不实现它们。
    const applicationItems: MenuItemConstructorOptions[] = deps.extraItems?.() ?? []
    const template: MenuItemConstructorOptions[] = trayMenuOrder({ applicationItemCount: applicationItems.length })
      .flatMap((slot): MenuItemConstructorOptions[] => {
        switch (slot) {
          case 'profiles': return [{ label: deps.labels.manage, submenu: [...profileItems, ...profileExtras] }]
          case 'application': return applicationItems
          case 'separator': return [{ type: 'separator' }]
          case 'restart-app': return [{ label: deps.labels.restartApp, click: () => { dispatchApplicationClick('restart-app', deps.actions) } }]
          case 'quit-app': return [{ label: deps.labels.quitApp, click: () => { dispatchApplicationClick('quit-app', deps.actions) } }]
        }
      })
    const menu = Menu.buildFromTemplate(template)
    // 左键行为交给设置：show-hide 时左键切窗口、菜单挂右键；menu 时就保持系统默认。
    if (deps.clickBehavior?.() === 'show-hide') {
      tray.setContextMenu(null)
      tray.removeAllListeners('right-click')
      tray.on('right-click', () => { tray.popUpContextMenu(menu) })
    } else {
      tray.removeAllListeners('right-click')
      tray.setContextMenu(menu)
    }
  }
  // 左键：show-hide 才接管，否则交回系统（带 ContextMenu 时系统自己弹）。
  tray.on('click', () => {
    if (deps.clickBehavior?.() !== 'show-hide') return
    const name = deps.clickTargetProfile?.() ?? deps.getStates()[0]?.name
    if (name === undefined) return
    const window = deps.getWindowState(name)
    dispatchProfileClick(name, resolveProfileClick(window), window, deps.actions)
  })
  build()
  return {
    refresh: build,
    destroy: () => { tray.destroy() },
  }
}
