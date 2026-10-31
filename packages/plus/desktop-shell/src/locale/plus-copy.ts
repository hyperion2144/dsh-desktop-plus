/** Plus 壳侧文案表：与 DSH 官方共用同一次语言判定（`currentDesktopLocale().id`），不再各处写死。 */
export type PlusShellCopy = {
  /** 是否中文；调用方用它挑同一份字典，避免与官方 messages 混排。 */
  readonly zh: boolean
  readonly manageProfiles: string
  readonly show: string
  readonly hide: string
  readonly restart: string
  readonly restartRemote: string
  readonly quit: string
  readonly startProfile: string
  readonly deleteProfile: string
  readonly newProfile: string
  readonly status: string
  readonly appVersion: string
  readonly builtinDsh: string
  readonly hostPort: string
  readonly runningProfiles: string
  readonly logDir: string
  readonly none: string
  readonly unknown: string
  readonly notStarted: string
  readonly checkUpdates: string
  readonly installCli: string
  readonly openLogs: string
  readonly developerTools: string
  readonly restartApp: string
  readonly quitApp: string
  readonly noProfile: string
  readonly deleteConfirmTitle: string
  readonly deleteConfirmDetail: string
  readonly delete: string
  readonly cancel: string
  readonly deleteFailed: string
  readonly ok: string
  readonly createProfileTitle: string
  readonly openLink: string
  readonly copyLink: string
  readonly reloadPage: string
  readonly openDevTools: string
}

const en: PlusShellCopy = {
  zh: false,
  manageProfiles: 'Profiles',
  show: 'Show',
  hide: 'Hide',
  restart: 'Restart',
  restartRemote: 'Restart remote desktop',
  quit: 'Quit',
  startProfile: 'Start',
  deleteProfile: 'Delete…',
  newProfile: 'New Profile…',
  status: 'Status',
  appVersion: 'App version',
  builtinDsh: 'Built-in dsh',
  hostPort: 'Host port',
  runningProfiles: 'Running profiles',
  logDir: 'Log directory',
  none: 'None',
  unknown: 'Unknown',
  notStarted: 'Not started',
  checkUpdates: 'Check for Updates…',
  installCli: 'Install dsh Command…',
  openLogs: 'Open Log Folder',
  developerTools: 'Developer Tools',
  restartApp: 'Restart App and Host',
  quitApp: 'Quit Application',
  noProfile: '(no profiles)',
  deleteConfirmTitle: 'Delete profile “{name}”?',
  deleteConfirmDetail: 'The profile directory is removed and cannot be restored.',
  delete: 'Delete',
  cancel: 'Cancel',
  deleteFailed: 'Delete failed',
  ok: 'OK',
  createProfileTitle: 'New Profile',
  openLink: 'Open Link in Browser',
  copyLink: 'Copy Link Address',
  reloadPage: 'Reload Page',
  openDevTools: 'Developer Tools',
}

const zh: PlusShellCopy = {
  zh: true,
  manageProfiles: 'Profile 管理',
  show: '显示',
  hide: '隐藏',
  restart: '重启',
  restartRemote: '重启远程桌面',
  quit: '退出',
  startProfile: '启动',
  deleteProfile: '删除…',
  newProfile: '新建 Profile…',
  status: '状态',
  appVersion: '应用版本',
  builtinDsh: '内置 dsh',
  hostPort: '宿主端口',
  runningProfiles: '运行中 profile',
  logDir: '日志目录',
  none: '无',
  unknown: '未知',
  notStarted: '未启动',
  checkUpdates: '检查更新…',
  installCli: '安装 dsh 命令…',
  openLogs: '打开日志目录',
  developerTools: '开发者工具',
  restartApp: '重启应用与宿主',
  quitApp: '退出应用',
  noProfile: '（没有 profile）',
  deleteConfirmTitle: '删除 Profile「{name}」？',
  deleteConfirmDetail: '会整目录删除该 profile，且无法恢复。',
  delete: '删除',
  cancel: '取消',
  deleteFailed: '删除失败',
  ok: '好',
  createProfileTitle: '新建 Profile',
  openLink: '在浏览器中打开链接',
  copyLink: '复制链接地址',
  reloadPage: '重新加载页面',
  openDevTools: '开发者工具',
}

/**
 * Picks the plus shell dictionary for one resolved Desktop locale.
 * @param id - `currentDesktopLocale().id`, the same value official copy uses.
 * @returns the shell copy for that language.
 */
export function plusShellCopy(id: string): PlusShellCopy {
  // 上游把桌面语言括到 8 种；我们只有中/英两套字典，非中文一律英文。
  return id.toLowerCase().startsWith('zh') ? zh : en
}

/** Fills `{name}` placeholders in one copy string. */
export function plusFormat(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}
