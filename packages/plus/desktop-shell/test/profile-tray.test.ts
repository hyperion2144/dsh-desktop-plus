/** Tray menu: the per-profile primary entry follows the window's live visibility. */

import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
	const built: { template: unknown[] }[] = []
	const constructed: unknown[] = []
	const tray = {
		setToolTip: vi.fn(),
		setContextMenu: vi.fn(),
		removeAllListeners: vi.fn(),
		on: vi.fn(),
		popUpContextMenu: vi.fn(),
		destroy: vi.fn(),
	}
	class Tray {
		constructor(icon: unknown) {
			constructed.push(icon)
			return tray as unknown as Tray
		}
	}
	const Menu = {
		buildFromTemplate: (template: unknown[]): { template: unknown[] } => {
			const menu = { template }
			built.push(menu)
			return menu
		},
	}
	return { built, constructed, tray, Tray, Menu }
})

vi.mock('electron', () => ({ Tray: electron.Tray, Menu: electron.Menu }))

import { createProfileTray } from '../src/tray/profile-tray.ts'

type MenuItem = { label?: string, submenu?: MenuItem[], click?: () => void }

/** The live window fact the menu renders from; tests mutate it to model hide/minimize. */
const state = { visible: true, focused: false }

function deps() {
	const actions = {
		showOrFocus: vi.fn(),
		startProfile: vi.fn(),
		hide: vi.fn(),
		restart: vi.fn(),
		quit: vi.fn(),
		restartApp: vi.fn(),
		quitApp: vi.fn(),
	}
	const trayDeps = {
		icon: 'icon.png',
		getStates: () => [{ name: 'work', running: true }],
		getWindowState: () => ({ ...state }),
		labels: {
			manage: 'Profiles',
			restartApp: 'Restart app',
			quitApp: 'Quit app',
			show: 'Show',
			hide: 'Hide',
			restart: 'Restart',
			restartRemote: 'Restart remote',
			quit: 'Quit',
			startProfile: 'Start',
			newProfile: 'New Profile…',
			migrateProfile: 'Migrate Profile…',
		},
		actions,
		clickBehavior: () => 'menu' as const,
	}
	return { actions, trayDeps }
}

/** The per-profile primary entry of the most recently built menu. */
function primary(): MenuItem {
	const template = electron.built.at(-1)!.template as MenuItem[]
	const profiles = template.find((item) => item.label === 'Profiles')
	return profiles!.submenu![0]!.submenu![0]!
}

describe('profile tray menu', () => {
	it('renders hide while the window is visible and hides on click', () => {
		state.visible = true
		const { actions, trayDeps } = deps()
		createProfileTray(trayDeps)
		expect(primary().label).toBe('Hide')
		primary().click!()
		expect(actions.hide).toHaveBeenCalledWith('work')
	})

	it('renders show after the window hid and refresh rebuilds the menu', () => {
		state.visible = true
		const { actions, trayDeps } = deps()
		const tray = createProfileTray(trayDeps)
		expect(primary().label).toBe('Hide')

		// The window hid itself (close→hide): nothing about the menu changed yet.
		state.visible = false
		expect(primary().label).toBe('Hide')

		// The visibility observer refreshes the tray; the entry now matches the window.
		tray.refresh()
		expect(primary().label).toBe('Show')
		primary().click!()
		expect(actions.showOrFocus).toHaveBeenCalledWith('work')
		expect(actions.hide).not.toHaveBeenCalled()
	})

	it('keeps one Tray instance and only rebuilds its menu', () => {
		state.visible = true
		const { trayDeps } = deps()
		const before = electron.constructed.length
		const tray = createProfileTray(trayDeps)
		const builds = electron.built.length
		tray.refresh()
		tray.refresh()
		expect(electron.constructed.length).toBe(before + 1)
		expect(electron.built.length).toBe(builds + 2)
	})
})
