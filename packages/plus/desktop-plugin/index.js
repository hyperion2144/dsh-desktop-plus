// dsh-desktop-plus bundle：注册「DSH 桌面壳」技能（SKILL.md 正文内联）。
// 页面半区插件（桌面 chrome + 技能）；壳半区在 packages/plus/desktop-shell/。
// 页面侧与壳侧的唯一通道：官方插件路由——页面半区 connection.rpc.call('/api', 'shell.invoke')，
// 宿主半区（本文件）connection.fetch.register exact 路由 /api/shell.invoke，经宿主 IPC（plus-shell-rpc）
// 转 Electron 壳 plusRpcRegistry（命令名与形状见 contracts/）。
// 移植自 dsh-desktop-bun 的 desktop-plugin（Electrobun 壳已换成本仓的 Electron 官方壳 fork）。

// 宿主加载器与静态 import 声明不兼容（实测：整插件加载失败，全部路由注册失效）——
// node 能力一律动态 import 惰性加载，加载失败时优雅降级（无声/不探测，不影响横幅本身）。
const nodeModules = {}
void Promise.all([
  import('node:child_process').then((m) => { nodeModules.cp = m }),
  import('node:fs').then((m) => { nodeModules.fs = m }),
  import('node:os').then((m) => { nodeModules.os = m }),
  import('node:path').then((m) => { nodeModules.path = m }),
]).catch(() => { /* 无模块能力：静默降级 */ })
// 宿主诊断走子进程标准流：stdout 行被壳收进 shell.log 的 info 级，stderr 行是 error 级
//（Node 里 console.error 走 stderr；console.warn 走 stdout 会被当 info，别用它打告警）。
const pluginLog = (line, level) => {
  if (level === 'error') console.error(`[dsh-desktop-plus] ${line}`)
  else console.log(`[dsh-desktop-plus] ${line}`)
}
export const name = 'dsh-desktop-plus'

// 注意：不可为 skills 声明 export const inject——skills 在本插件作用域不可见，
// 声明后 Cordis 会无限期挂起 apply（实测），技能与 RPC 桥接全部失效。

// skills 不可用走 apply 内探测降级：只跳过技能注册，面板通道不受影响。


// 桌面壳设置命名空间的 schema。
// 约束：--patch 插件的宿主文件禁止裸包导入（实测 Cannot find package），
// 因此不引 schemastery，而按 dsh-settings 的实际契约手写最小实现：
//   1) schema(value) 可调用 —— resolve() 用它归一合并值；
//   2) schema.toJSON() —— describe() 序列化用（缺方法会报 registration.schema.toJSON is not a function）；
//   3) type/dict/inner 结构 —— redactSecrets 的 walk() 遍历用。
const str = (def = '') => ({ type: 'string', default: def, toJSON: () => ({ type: 'string' }) })
const num = (def = 0) => ({ type: 'number', default: def, toJSON: () => ({ type: 'number' }) })
const bool = (def = false) => ({ type: 'boolean', default: def, toJSON: () => ({ type: 'boolean' }) })
const list = (def = []) => ({
  type: 'array',
  inner: { type: 'string' },
  default: def,
  toJSON: () => ({ type: 'array', inner: { type: 'string' } }),
})

/** 由字段表构造可调用的对象 schema（缺失键填默认值，未声明键丢弃）。 */
function objectSchema(dict) {
  const schema = (raw) => {
    const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const out = {}
    for (const [key, node] of Object.entries(dict)) out[key] = src[key] === undefined ? node.default : src[key]
    return out
  }
  schema.type = 'object'
  schema.dict = dict
  schema.toJSON = () => ({
    type: 'object',
    dict: Object.fromEntries(Object.entries(dict).map(([key, node]) => [key, node.toJSON()])),
  })
  return schema
}

const DesktopSettingsSchema = objectSchema({
  port: num(3080),
  active_profile: str('web'),
  remote_list: list([]),
  lane_port: num(3091),
  cloudflared_bin: str(''),
  proxy_mode: str('off'),
  proxy_url: str(''),
  no_proxy: str(''),
  proxy_user: str(''),
  proxy_pass: str(''),
  quarantine_first_party_protection: bool(true),
  quarantine_exclude: list([]),
  quarantine_max_retries: num(2),
  ai_provider: str('deepseek'),
  ai_model: str(''),
  ai_base_url: str(''),
  ai_key_env: str(''),
  tunnel_url: str(''),
  ws_keepalive_ms: num(15000),
  ws_pong_timeout_ms: num(10000),
})

const CONTENT = [
  '# DSH 桌面壳「DSH Desktop Plus」',
  '',
  '把 DeepSeek Harness Web GUI 封装成 Electron 桌面应用（macOS + Windows 双平台）：',
  '双击启动 → 自动拉起本地 `dsh web` → 窗口加载 Web GUI → 托盘常驻 → 退出回收子进程。',
  '壳 = 官方 deepseek-ai/dsh Electron 桌面壳（upstream/apps/desktop）的 plus fork（packages/plus/desktop-shell）。',
  '',
  '## 一、安装 DeepSeek Harness（前提，分平台）',
  '',
  'Node.js ≥ 20，然后 `npm i -g @deepseek-ai/dsh`（国内先 `npm config set registry https://registry.npmmirror.com`）。',
  'macOS：`brew install node@22` 或 nvm；验证 `dsh --version`、`which dsh` 指向全局 bin。',
  'Windows：nvm-windows（`winget install CoreyButler.NVMforWindows`）或官方 msi 任意盘符；',
  'PowerShell 执行策略 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`（拦 .ps1 shim）；',
  '首次 `dsh web` 约 4s 就绪，profile 在 ~/.dsh（mac）/ %USERPROFILE%\\.dsh（win）。',
  '',
  '## 二、国内镜像（Windows 新环境必做，否则所有下载卡死）',
  '',
  '- npm/pnpm：registry.npmmirror.com（`pnpm config set registry https://registry.npmmirror.com`）',
  '- Electron 二进制：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/',
  '- GitHub raw 被墙：用 gh-proxy.com 前缀（`https://gh-proxy.com/https://raw.githubusercontent.com/...`）',
  '- **subagent 哨兵**：重量级下载派 subagent，主 agent 按预期时长表轮询——单文件 30s、',
  '  npm 全局 2min、Electron 运行时下载 5min；超时=源未配好，中断→复核→换源→重派；',
  '  测速探针必须用 ≥10MB 大文件（小文件会误杀健康源）',
  '',
  '## 三、仓库骨架（Electron 官方壳的 plus fork）',
  '',
  '- `upstream/apps/desktop/`：官方 Electron 壳（dsh-app:// scheme、preload 暴露 dshDesktop、webview 宿主）',
  '- `packages/plus/desktop-shell/`：plus 侧壳服务（托盘/通知/下载/运行时/profile/日志诊断/守护进程/启动编排/devtools）',
  '- `packages/plus/desktop-plugin/`：页面半区插件（本包）——桌面 chrome + 「DSH 桌面壳」技能',
  '- 能力名与旧壳一一对应：托盘、任务完成通知、下载管理器、运行时安装/切换、profile 运维、',
  '  日志与诊断、应用更新与更新提醒、侧边栏浏览器 guest、桌面快捷键、防休眠、代理/隧道/隔离策略',
  '',
  '## 四、页面侧 ↔ 壳侧契约（75 条命令）',
  '',
  '页面半区只走一条通道：官方 /api 路由 connection.rpc.call(\'/api\', \'shell.invoke\', { method, params })，',
  '回执走官方 server-response 信封（失败必须让页面看见，不做静默降级）。',
  '- 命令名、参数与回执形状由 `packages/plus/desktop-plugin/contracts/` 唯一裁决（壳与页各自 import，互不 import）',
  '- 宿主半区用 connection.fetch.register 注册 exact 路由 /api/shell.invoke（业务插件模式），经宿主 IPC 转 Electron 壳',
  '- 页面用 `globalThis.dshDesktop`（官方 preload 契约）判断壳在场；普通浏览器里桌面 chrome 整体不激活',
  '- 首次握手用 `get_desktop_client_environment` 探活，回不出 platform/profile 时桌面 chrome 保持关闭',
  '',
  '## 五、构建与验收',
  '',
  '`pnpm install` → `pnpm --filter @deepseek-ai/dsh-desktop-plus-plugin build:client`（esbuild 打包页面半区到 lib/client.js）→',
  '`pnpm run typecheck:plus`（页面半区 strict typecheck）→ 壳侧 Electron 打包产出 .app/.dmg 与 .exe 安装包。',
  '验收三条路径：A 复用（3080 已有 dsh web，降级接入、退出不杀）、B 拉起+回收（端口空闲 spawn，退出 kill+端口释放）、',
  'C 受限 PATH（模拟双击，验证兜底探测）。**跑验收前先退出所有 dsh 实例**（单实例锁会静默拦截造成假通过）。',
  '',
  '## 六、已知坑',
  '',
  '- 插件通道只能 connection.fetch.register（exact 路由）：rpc.handle 会被 guard 拒（连接插件只注入 credentials、无 webServer），intercept(\'/api\') 是单槽且被官方网关占用',
  '- `contextBridge` 暴露的 dshDesktop 对象被冻结：壳能力只能走 preload 已有 API，插件不能自行追加字段',
  '- Electron 打包后丢弃 `NODE_OPTIONS`（macOS 父进程签名不同也会被丢），热补丁只能走仓库 hook',
  '- macOS 通知授权按应用 bundle id 走 tccutil，dev 与打包版 id 不同会各自授权',
  '- 产物 exe 名是 Electron 打包名（非「DSH Desktop Plus.exe」）；SmartScreen 只对带 MOTW 的下载触发',
  '',
  '## 七、桌面端与会话的关系',
  '',
  '桌面壳与浏览器/终端共用同一个 dsh web（单实例、同后端、同会话存储 ~/.dsh）；由桌面壳拉起的实例带桌面 overlay 启用桌面 chrome，复用的外部实例降级接入；托盘「重启 dsh 服务」可切换到桌面壳实例。避免两边同时操作同一会话。',
  '完整 SKILL.md 与实测审计见仓库 https://github.com/hyperion2144/dsh-desktop-plus',
].join('\n')

export function apply(ctx) {
  const skills = ctx.get('skills')
  // 技能注册与 RPC 桥接解耦：技能服务不可用不能阻断桥接（否则设置面板拿不到
  // provider/model——实测根因，见 #61）。
  if (skills !== undefined && typeof skills.register === 'function') {
    ctx.effect(() =>
      skills.register({
        name: 'dsh-desktop-plus',
        title: 'DSH 桌面壳「DSH Desktop Plus」',
        description:
          '把 DeepSeek Harness Web GUI 封装成 Electron 桌面应用（macOS + Windows 双平台），含托盘常驻、单实例、子进程生命周期、任务完成通知、下载管理器、日志与诊断、侧边栏浏览器 guest、桌面快捷键与防休眠；页面半区与壳半区用官方 /api/shell.invoke 路由对接（宿主 IPC 转壳），命令名与参数形状由 contracts/ 唯一裁决。当用户想把 DSH 做成桌面应用、配置桌面壳的 profile/日志/通知，或排查壳与页面桥接（通道不可用、命令名对不上）时使用。',
        whenToUse:
          '用户想把 DeepSeek Harness 或任意本地 Web 应用封装成 Electron 桌面应用；需要给桌面应用加托盘常驻、任务完成系统通知、下载管理与日志诊断；需要页面侧桌面 chrome（桌面设置面板/通知 tab/下载 tab/浏览器 guest/控制台镜像）接上壳；遇到插件通道（/api/shell.invoke）桥接失败、dsh-app:// scheme 跨源、dshDesktop 预加载契约、单实例锁或 Electron 打包踩坑时。',
        source: 'dsh-desktop-plus',
        content: CONTENT,
        invocation: { modelInvocable: true, userInvocable: true },
      }),
      'dsh-desktop-plus: skill',
    )
  } else {
    ctx.logger?.warn('dsh-desktop-plus: skills 服务不可用，跳过技能注册（RPC 桥接不受影响）')
  }

  // ── 壳命令桥（client→host 官方路径）：/api/shell.invoke exact 路径 ──
  // 页面 client 半区 rpc.call('/api', 'shell.invoke', { method, params })（认证与 wire
  // 全走官方 /api 路由），本半区经宿主 IPC（plus-shell-rpc）转 Electron 壳的
  // plusRpcRegistry，回包原路返回。注册用 ctx.connection.fetch.register——官方业务
  // 插件模式（media-references 同款），只写连接服务内存路由表，不触碰 webServer
  // （rpc.handle 那条会被 guard 拒）。注册失败只 warn——不能拖垮 apply。
  const pendingShellRpc = new Map()
  let nextShellRpcId = 1
  if (typeof process.on === 'function') {
    process.on('message', (message) => {
      if (!message || message.type !== 'plus-shell-rpc-result') return
      const settle = pendingShellRpc.get(message.requestId)
      if (typeof settle !== 'function') return
      pendingShellRpc.delete(message.requestId)
      settle(message)
    })
  }
  const callShell = (method, params) => new Promise((resolve) => {
    if (typeof process.send !== 'function') {
      // 复用外部 dsh 实例（非壳拉起）：无宿主 IPC，永远失败——面板退回壳 protocol 端点。
      resolve({ error: `shell ipc unavailable: ${method}` })
      return
    }
    const requestId = nextShellRpcId++
    const timer = setTimeout(() => {
      if (pendingShellRpc.delete(requestId)) resolve({ error: `shell rpc timeout: ${method}` })
    }, 30_000)
    if (typeof timer.unref === 'function') timer.unref()
    pendingShellRpc.set(requestId, (reply) => {
      clearTimeout(timer)
      resolve(reply && reply.error !== undefined ? { error: reply.error } : { value: reply?.value })
    })
    process.send({ type: 'plus-shell-rpc', requestId, method, params })
  })
  const registerShellRpc = (scope) => {
    const connection = scope?.connection
    if (connection?.fetch?.register === undefined) {
      ctx.logger?.warn?.('dsh-desktop-plus: connection.fetch 不可用，壳命令桥未注册（面板退回壳 protocol 端点）')
      return
    }
    connection.fetch.register({
      path: '/api/shell.invoke',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
          let rpcId = ''
          try {
            const body = await request.json()
            rpcId = String(body?.rpcId ?? '')
            const method = String(body?.payload?.method ?? '')
            const result = method === '' ? { error: 'empty method' } : await callShell(method, body?.payload?.params)
            const envelope = result && result.error !== undefined
              ? { ok: false, error: { code: 'shell-rpc-failed', message: typeof result.error === 'string' ? result.error : String(result.error?.message ?? JSON.stringify(result.error)), details: {} } }
              : { ok: true, value: result?.value }
            return Response.json({ type: 'server-response', rpcId, result: envelope })
          } catch (e) {
            return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'shell-rpc-failed', message: String(e?.message ?? e), details: {} } } })
          }
      },
    })
    pluginLog('routes registered: /api/shell.invoke')
  }
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['connection'], registerShellRpc)
    else registerShellRpc(ctx)
  } catch (error) {
    ctx.logger?.warn?.(`dsh-desktop-plus: 壳命令桥注册失败（${String(error)}）`)
  }

  // ── 纯插件侧通知（#116 重做，dsh-notify-me 同款架构，壳零改动）──
  // 页面半区订阅服务快照存储（sessions.list / uiSession.sessionStatus）的边沿，
  // 经宿主 webServer 路由投递：
  //   Windows：宿主 spawn PowerShell 原生 toast（系统音 + 协议点击，DND 由系统管控）；
  //   macOS/Linux：页面 Web Notification（系统横幅+系统音），点击页面手势跳会话。
  // 通知正文（回复摘要 / 回合终态）由宿主 session/event 累积（该事件只在宿主半区存在），
  // 页面经 /__dsh-plus/notify-summary 取用。
  // 设置决策（总开关/场景/免打扰时段/音效档）在宿主读 desktop-settings.json。
  // toast 的 AUMID 与空激活器 CLSID：未打包应用必须自己注册 AUMID（DisplayName + 指向空
  // CLSID 的 CustomActivator），否则 Windows 把激活交给同名 AUMID 的 COM 服务器吞掉点击
  // （dsh-notify-me #41）；CLSID 键空注册 = 无 COM 服务器，系统改走 XML 协议激活。
  const TOAST_AUMID = 'io.github.hyperion2144.dsh.plus'
  const TOAST_ACTIVATOR_CLSID = '{9C1D3E48-7A5B-4F62-B8E0-2D4C6A9F3B17}'
  // 会话通知正文累积（#116）：最后回复文本 + 回合终态；页面在 running 边沿时经
  // notify-summary 路由读取。条目在下一回合开始（turn/start）时清除——边沿与事件
  // 的相对时序不保证，保留到下回合开始对两边都安全。
  const notifyDigestBySession = new Map()
  const NOTIFY_DIGEST_MAX = 128
  const recordDigest = (sid, patch) => {
    if (typeof sid !== 'string' || sid === '') return
    const prev = notifyDigestBySession.get(sid) ?? {}
    notifyDigestBySession.delete(sid)
    notifyDigestBySession.set(sid, { ...prev, ...patch, at: Date.now() })
    if (notifyDigestBySession.size > NOTIFY_DIGEST_MAX) {
      notifyDigestBySession.delete(notifyDigestBySession.keys().next().value)
    }
  }
  const dshHomeDir = () => process.env.DSH_HOME || (nodeModules.path !== undefined && nodeModules.os !== undefined ? nodeModules.path.join(nodeModules.os.homedir(), '.dsh') : undefined)
  const readNotificationConfig = () => {
    const fallback = { enabled: true, dnd: { on: false, from: '22:00', to: '08:00', suppressFullscreen: true }, scenarios: {} }
    if (nodeModules.fs === undefined || nodeModules.path === undefined) return fallback
    try {
      const raw = JSON.parse(nodeModules.fs.readFileSync(nodeModules.path.join(dshHomeDir(), 'desktop-settings.json'), 'utf8'))
      const config = raw !== null && typeof raw === 'object' ? raw.notification_config : undefined
      if (config === null || typeof config !== 'object') return fallback
      return {
        enabled: config.enabled !== false,
        dnd: config.dnd !== null && typeof config.dnd === 'object' ? config.dnd : fallback.dnd,
        scenarios: config.scenarios !== null && typeof config.scenarios === 'object' ? config.scenarios : {},
      }
    } catch {
      return fallback // 读不到设置：按全开处理（fail-open）
    }
  }
  const inDndWindow = (dnd, now) => {
    if (dnd?.on !== true) return false
    const minutes = (value) => {
      const [h, m] = String(value ?? '').split(':').map(Number)
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
    }
    const start = minutes(dnd.from)
    const end = minutes(dnd.to)
    if (start === null || end === null || start === end) return false
    const current = now.getHours() * 60 + now.getMinutes()
    return start < end ? current >= start && current < end : current >= start || current < end
  }
  // 注册表同步读（Windows 探测用）：reg query 文本 / 二进制值。
  const regQueryTextSync = (key, args) => {
    if (nodeModules.cp === undefined) return null
    try {
      const r = nodeModules.cp.spawnSync('reg', ['query', key, ...args], { encoding: 'utf8', timeout: 3000 })
      return r.status === 0 ? (r.stdout ?? '') : null
    } catch {
      return null
    }
  }
  const regBinarySync = (key, value) => {
    const text = regQueryTextSync(key, ['/v', value])
    if (text === null) return null
    const m = /REG_BINARY\s+([0-9a-fA-F\s]+)/.exec(text)
    return m ? Buffer.from(m[1].replace(/\s+/g, ''), 'hex') : null
  }
  // 系统免打扰探测（自播音效压制用，三平台）：
  //   macOS：专注模式断言库；
  //   Windows：勿扰状态在 CloudStore 二进制里内嵌 UTF-16 文本（Microsoft.QuietHoursProfile.<模式>，
  //     实时翻转实测有效）。文本起点是奇信偏移（本机 29），只从 0 解码永远解不出——两个偏移各解一次。
  //     解不出 = 缺席，fail-open。
  const systemQuietActive = () => {
    if (process.platform === 'win32') {
      const raw = regBinarySync(
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.donotdisturb.quiethourssettings\\windows.data.donotdisturb.quiethourssettings',
        'Data',
      )
      if (raw === null || raw.length === 0) return false
      const text = `${raw.toString('utf16le')}${raw.subarray(1).toString('utf16le')}`
      const profile = /QuietHoursProfile\.(\w+)/.exec(text)?.[1]
      return profile !== undefined && profile !== 'Unrestricted'
    }
    if (process.platform !== 'darwin') return false
    if (nodeModules.cp === undefined || nodeModules.path === undefined || nodeModules.os === undefined) return false
    try {
      const assertions = nodeModules.path.join(nodeModules.os.homedir(), 'Library', 'DoNotDisturbDB', 'Assertions.json')
      const out = nodeModules.cp.spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', assertions], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).stdout ?? ''
      const parsed = JSON.parse(out)
      return (Array.isArray(parsed?.data) ? parsed.data : []).some((entry) => (entry?.storeAssertionRecords ?? []).length > 0)
    } catch {
      return false
    }
  }
  // 声音方案映射探测（Windows）：Notification.Default 的 .current 为空（企业镜像常见）时，
  // toast 隐式/显式默认音全部静默——default 档需回退自播系统通知音。
  const systemToastSoundAvailable = () => {
    if (process.platform !== 'win32') return true
    const text = regQueryTextSync('HKCU\\AppEvents\\Schemes\\Apps\\.Default\\Notification.Default\\.current', ['/ve'])
    if (text === null) return true // 读不到 = 不确定，按健全处理（不额外自播）
    // 值类型是 REG_EXPAND_SZ（系统默认 hive / ExpandString 写回均为此类型），只认 REG_SZ 会永不命中
    // → 健全映射被误判缺失 → default 档回退自播与系统 toast 声叠成两声（#117 实测回归）。
    const m = /REG_(?:EXPAND_)?SZ\s+(.*)/.exec(text)
    const value = m?.[1]?.trim() ?? ''
    return value !== '' && !value.includes('值不存在') && !value.includes('The system cannot find')
  }
  // 自播一个音频文件（绝对路径）；播放后端缺席时静默降级，不影响横幅本身。
  const playSoundFile = (file) => {
    if (nodeModules.cp === undefined || typeof file !== 'string' || file === '') return
    try {
      if (process.platform === 'win32') {
        nodeModules.cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', `$p = New-Object System.Media.SoundPlayer -ArgumentList '${file}'; $p.PlaySync()`], { stdio: 'ignore' })?.unref?.()
        return
      }
      if (process.platform === 'darwin') {
        nodeModules.cp.spawn('/usr/bin/afplay', [file], { stdio: 'ignore' })?.unref?.()
        return
      }
      nodeModules.cp.spawn('paplay', [file], { stdio: 'ignore' })?.unref?.()
    } catch {
      // 播放后端缺席：静默降级，不影响横幅本身。
    }
  }
  // 自定义音效自播：$DSH_HOME/sounds/<名>。
  const playNotificationSound = (sound) => {
    if (nodeModules.path === undefined) return
    if (sound === 'default' || sound === 'none' || sound === '') return
    playSoundFile(nodeModules.path.join(dshHomeDir(), 'sounds', sound))
  }
  // 通知决策：设置门 + 音效档（页面与宿主 toast 共用同一决策）。
  const decideNotify = (type) => {
    const settings = readNotificationConfig()
    // 场景 key 归一化：设置 UI 写点号（task.complete），通知类型传连字符（task-complete）——
    // 不归一化时场景开关与场景音效永远匹配不上（静默全开，#116 整改发现）。
    const scenario = settings.scenarios[type] ?? settings.scenarios[String(type).replace(/-/g, '.')]
    if (settings.enabled === false || scenario?.enabled === false) return { allow: false, sound: 'none' }
    const sound = inDndWindow(settings.dnd, new Date()) || scenario?.sound === 'none' ? 'none' : scenario?.sound ?? 'default'
    return { allow: true, sound }
  }

  // ── 通知路由（dsh-notify-me 同款）：页面同源 fetch 直达宿主 webServer（壳转发 dsh-app://app）──
  // 壳以 ELECTRON_RUN_AS_NODE=1 跑宿主（desktopNodeEnvironment），process.versions.electron 是 undefined——
  // 不能拿它当桌面宿主信号；宿主进程本身就是桌面宿主，win32 即可判定。
  const isWindowsDesktop = process.platform === 'win32'
  // Windows 10（build < 22000）不分发未打包应用的 toast 协议激活（microsoft-ui-xaml #1939，
  // 未回移 19041/19045 分支）：原生 toast 能弹但点击被吞。页面据 notify-config 的 native
  // 标志回退 Web Notification（Electron 渲染层 toast，点击走 onclick 手势，完整可用）。
  const isWindowsToastCapable = () => {
    if (!isWindowsDesktop) return false
    try {
      const build = Number(nodeModules.os?.release?.().split('.')[2])
      return Number.isFinite(build) ? build >= 22000 : true
    } catch {
      return true
    }
  }
  const notifyHelpersDir = () => {
    if (nodeModules.path === undefined || nodeModules.os === undefined) return undefined
    const local = process.env.LOCALAPPDATA || nodeModules.path.join(nodeModules.os.homedir(), 'AppData', 'Local')
    return nodeModules.path.join(local, 'dsh-desktop-plus', 'notify')
  }
  // 首次部署：asar 内脚本复制到磁盘（PowerShell 不能执行 asar 内文件）+ 注册 dsh-plus:// 协议。
  // 失败不缓存：目录/权限问题修好后下一次投递能重试，不必重启应用（#142）。
  let notifyHelpersReady = null
  const deployNotifyHelpers = () => {
    if (notifyHelpersReady !== null) return notifyHelpersReady
    const attempt = (async () => {
      if (!isWindowsDesktop || nodeModules.fs === undefined || nodeModules.path === undefined) return false
      const dir = notifyHelpersDir()
      if (dir === undefined) return false
      try {
        // 父目录首次部署时不存在：不建目录 writeFileSync 必 ENOENT，被下面 catch 吞成
        // helpers-unavailable（#142：Windows 通知全部 502 的根因）。
        nodeModules.fs.mkdirSync(dir, { recursive: true })
        for (const name of ['win-toast.ps1', 'icon.png']) {
          // icon.png 是二进制：不能用 utf8 文本读（会毁图）。
          const src = await nodeModules.fs.promises.readFile(new URL('./notify/' + name, import.meta.url))
          nodeModules.fs.writeFileSync(nodeModules.path.join(dir, name), src)
        }
        // #116 直通：协议命令指向应用本体（宿主 execPath = 应用 exe，已实测），
        // URL 完整进 argv → 单实例 second-instance → 壳路由窗口 + executeJavaScript。
        // 记录-消费整套（vbs / actions 目录 / 轮询）已退役。
        const command = '"' + process.execPath + '" "%1"'
        const reg = (args) => new Promise((resolve) => { nodeModules.cp.execFile('reg', args, () => resolve(true)) })
        await reg(['add', 'HKCU\\Software\\Classes\\dsh-plus', '/ve', '/d', 'URL:DSH Desktop Plus', '/f'])
        await reg(['add', 'HKCU\\Software\\Classes\\dsh-plus', '/v', 'URL Protocol', '/d', '', '/f'])
        await reg(['add', 'HKCU\\Software\\Classes\\dsh-plus\\shell\\open\\command', '/ve', '/d', command, '/f'])
        // toast 的应用身份（dsh-notify-me #41 教训）：AUMID 指向空 CLSID 的 CustomActivator，
        // Windows 11 才会把激活按 XML 协议分发；不注册则点击可能被同名 AUMID 的 COM 服务器吞掉。
        const aumidKey = 'HKCU\\Software\\Classes\\AppUserModelId\\' + TOAST_AUMID
        await reg(['add', aumidKey, '/v', 'DisplayName', '/d', 'DSH Desktop Plus', '/f'])
        await reg(['add', aumidKey, '/v', 'CustomActivator', '/d', TOAST_ACTIVATOR_CLSID, '/f'])
        await reg(['add', 'HKCU\\Software\\Classes\\CLSID\\' + TOAST_ACTIVATOR_CLSID, '/f'])
        // toast 图标：AUMID 不带 IconUri 时 ToastGeneric 左下角是空白（#117 实测）；file:/// 指向部署出的图标。
        const iconUri = 'file:///' + nodeModules.path.join(dir, 'icon.png').replace(/\\/g, '/')
        await reg(['add', aumidKey, '/v', 'IconUri', '/d', iconUri, '/f'])
        pluginLog('notify helpers deployed')
        return true
      } catch (e) {
        pluginLog(`helpers deploy failed: ${String(e?.message ?? e)}`, 'error')
        return false
      }
    })()
    // 只有成功才钉住结果；失败留 null，下一次投递重新尝试。
    notifyHelpersReady = attempt.then((ready) => {
      if (!ready) notifyHelpersReady = null
      return ready
    })
    return notifyHelpersReady
  }
  // PowerShell 的 stderr 是主机码页（中文 Windows 是 CP936），不是 UTF-8。直接按 UTF-8
  // 解码只会得到乱码，排障时看不出真实错误（#142 被这个坑耽误过一轮）。
  // 这里按平台码页解码：Windows 用 chcp 报告的代码页，其它平台退回 UTF-8。
  const decodeConsoleOutput = (buffer) => {
    if (buffer.length === 0) return ''
    if (process.platform !== 'win32') return buffer.toString('utf8')
    try {
      // 936 = GBK/CP936（中文），65001 = UTF-8；Node 的 TextDecoder 支持这些标签。
      const codePage = Number((process.env.DSH_DESKTOP_CONSOLE_CODEPAGE ?? '936'))
      const label = codePage === 65001 ? 'utf-8' : codePage === 936 ? 'gbk' : 'utf-8'
      return new TextDecoder(label).decode(buffer)
    } catch {
      return buffer.toString('utf8')
    }
  }
  const runNotifyPowerShell = (script, extraArgs) => new Promise((resolve) => {
    const dir = notifyHelpersDir()
    if (dir === undefined || nodeModules.cp === undefined || nodeModules.path === undefined) { resolve({ ok: false, detail: 'no-dir' }); return }
    const ps = nodeModules.path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    let child
    try {
      child = nodeModules.cp.spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', nodeModules.path.join(dir, script)].concat(extraArgs), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) { resolve({ ok: false, detail: 'spawn-failed' }); return }
    const stderrChunks = []
    let settled = false
    const timer = setTimeout(() => { if (settled) return; settled = true; try { child.kill() } catch { }; resolve({ ok: false, detail: 'timeout' }) }, 20000)
    child.stderr.on('data', (c) => { stderrChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)) })
    child.on('error', () => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok: false, detail: 'spawn-error' }) })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stderr = decodeConsoleOutput(Buffer.concat(stderrChunks)).trim()
      resolve({ ok: code === 0, detail: stderr.slice(0, 200) || ('exit-' + code) })
    })
  })
  let notifyTagSeq = 0
  const registerNotifyRoutes = (scope) => {
    const webServer = scope?.webServer
    if (webServer?.register === undefined) {
      pluginLog('webServer service unavailable; notify routes not registered')
      return
    }
    // 发送方的 profile 名（多 profile 通知路由用）：宿主知道自己是谁（busy 代码同源）。
    const notifyProfileName = (() => {
      try { return String(scope?.get?.('profileContext')?.name ?? '') } catch { return '' }
    })()
    const json = (res, status, body) => {
      const data = JSON.stringify(body)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) })
      res.end(data)
    }
    const readJsonBody = (req, limit) => new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => { size += c.length; if (size > limit) { resolve(null); return } chunks.push(c) })
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) } })
      req.on('error', () => resolve(null))
    })
    const INTENT = { 'x-dsh-plus-notify': '1' }
    webServer.register({
      kind: 'exact', path: '/__dsh-plus/notify-config',
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { ok: false }); return }
        const scenario = String(new URL(req.url ?? '/', 'http://x').searchParams.get('scenario') ?? '')
        const decision = decideNotify(scenario)
        json(res, 200, { ok: true, native: isWindowsToastCapable(), ...decision })
      },
    })
    webServer.register({
      kind: 'exact', path: '/__dsh-plus/notify',
      handler: (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
        if (req.headers['x-dsh-plus-notify'] !== '1') { json(res, 403, { ok: false }); return }
        if (!isWindowsToastCapable()) { json(res, 501, { ok: false, reason: isWindowsDesktop ? 'toast-activation-unsupported' : 'non-windows' }); return }
        void (async () => {
          const note = await readJsonBody(req, 16 * 1024)
          if (note === null || typeof note !== 'object' || typeof note.title !== 'string') { json(res, 400, { ok: false }); return }
          const decision = decideNotify(String(note.type ?? ''))
          if (!decision.allow) {
            pluginLog(`toast skipped: scenario disabled: ${String(note.type ?? '')}`)
            json(res, 200, { ok: true, delivered: false })
            return
          }
          const ready = await deployNotifyHelpers()
          if (!ready) {
            pluginLog('toast abort: notify helpers unavailable', 'error')
            json(res, 502, { ok: false, reason: 'helpers-unavailable' })
            return
          }
          notifyTagSeq += 1
          const payload = {
            aumid: TOAST_AUMID,
            title: String(note.title).slice(0, 200),
            body: String(note.body ?? '').slice(0, 1000),
            tag: 'dshp' + notifyTagSeq.toString(36),
            session: typeof note.sessionId === 'string' ? note.sessionId.slice(0, 200) : '',
            sound: typeof note.sound === 'string' && note.sound !== '' ? note.sound : decision.sound,
            // 发送方 profile：#116 直通路由用（哪条横幅跳哪个 profile 的窗口，不写死）。
            profile: notifyProfileName,
          }
          const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
          const result = await runNotifyPowerShell('win-toast.ps1', ['-Base64', encoded])
          const sound = payload.sound
          if (sound !== 'default' && sound !== 'none') {
            // 自定义档：toast 静音 + 自播，过系统勿扰闸（自播不受勿扰管辖，#117 实测）。
            if (!systemQuietActive()) playNotificationSound(sound)
          } else if (sound === 'default' && !systemQuietActive() && !systemToastSoundAvailable()) {
            // default 档回退：声音方案映射被清（企业镜像）时 toast 无声，自播系统通知音兑底。
            playSoundFile(nodeModules.path.join(process.env.SystemRoot || 'C:\\Windows', 'media', 'Windows Notify System Generic.wav'))
          }
          pluginLog(`toast: ${String(note.type ?? '')} sound=${sound} -> ${result.ok ? 'ok' : result.detail}`)
          json(res, result.ok ? 200 : 502, { ok: result.ok, delivered: result.ok })
        })()
      },
    })
    webServer.register({
      kind: 'exact', path: '/__dsh-plus/play-sound',
      handler: (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
        void (async () => {
          const body = await readJsonBody(req, 4096)
          const sound = body !== null && typeof body === 'object' ? String(body.sound ?? '') : ''
          const quiet = systemQuietActive()
          pluginLog(`play-sound: ${sound} quiet=${quiet}`)
          if (sound !== '' && sound !== 'default' && sound !== 'none' && !quiet) playNotificationSound(sound)
          json(res, 200, { ok: true, quiet })
        })()
      },
    })
    webServer.register({
      kind: 'exact', path: '/__dsh-plus/notify-summary',
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { ok: false }); return }
        const session = String(new URL(req.url ?? '/', 'http://x').searchParams.get('session') ?? '').slice(0, 200)
        const digest = session !== '' ? notifyDigestBySession.get(session) : undefined
        json(res, 200, { ok: true, summary: digest?.summary ?? '', kind: digest?.kind ?? '', error: digest?.error ?? '' })
      },
    })
    pluginLog('notify routes registered: /__dsh-plus/notify, notify-config, play-sound, notify-summary')
  }
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['webServer'], registerNotifyRoutes)
    else registerNotifyRoutes(ctx)
  } catch (error) {
    pluginLog(`notify routes registration failed: ${String(error)}`, 'error')
  }

  // ── dsh 原生事件桥（#142）：session/event → 桌面壳（宿主 IPC plus-shell-notify）──
  // 订阅宿主事件，经宿主 IPC 单向发给 Electron 壳（通知与防休眠都在壳侧落地）。
  // 事件映射：turn/end → task-complete；approval/asked → dsh-approval。
  // 防御性：无宿主 IPC（复用外部 dsh 实例）/ 无 ctx.on → 静默降级（不影响 dsh 启动）；
  // turn/end 按会话 10s 防抖（连环回合事件不刷屏）。
  if (typeof process.send !== 'function' || typeof ctx.on !== 'function') return

  const sendShellNotice = (notice) => {
    try { process.send({ type: 'plus-shell-notify', notice }) } catch { /* 壳不在：通知不是关键路径 */ }
  }
  const report = (type, body, extra) => {
    // busy 心跳走壳（托盘防休眠）；会话通知不再经壳——页面半区订阅事件后直接投递。
    if (type === 'busy-state') { sendShellNotice({ type, body, ...extra }); return }
  }

  // 摘要与通知触发已迁页面半区（#116 重做）：宿主只保留 busy 状态机。

  // ── 会话忙状态上报（#186）：驱动桌面壳的防休眠断言 ──
  // 口径（用户拍板）：正在跑的会话 = 有 turn 在跑，且**不在等人工**
  // （等审批 / 等 ask_user_question 回答不算在跑）。DOM 探针不能当判据（#185 调研：
  // `[data-state="ongoing"]` 是通用 spinner，20+ 处复用，假阳性一堆）。
  const busySessions = new Set()
  const waitingSessions = new Set()
  const questionCalls = new Map() // callId → sessionId（等用户回答的工具调用）
  const busyProfile = (() => {
    try { return ctx.get?.('profileContext')?.name || '' } catch { return '' }
  })()
  let lastBusy = null
  const reportBusy = (force) => {
    const busy = [...busySessions].some((sid) => !waitingSessions.has(sid))
    if (!force && busy === lastBusy) return
    lastBusy = busy
    sendShellNotice({ type: 'busy-state', profile: busyProfile, busy })
  }
  // 心跳：忙状态不变也重发（壳侧只看租约新鲜度，陈旧只告警、不释放）。
  const busyHeartbeat = setInterval(() => reportBusy(true), 10_000)
  busyHeartbeat?.unref?.()

  ctx.on(
    'session/event',
    (...args) => {
      try {
        // dsh 载荷两种形态：(session, event) 或 { session, event }
        let session
        let event
        if (args.length >= 2) {
          ;[session, event] = args
        } else if (args.length === 1 && args[0] && typeof args[0] === 'object') {
          ;({ session, event } = args[0])
        }
        if (!event || typeof event.type !== 'string') return
        if (event.type === 'assistant/message') {
          // 回复摘要（宿主事件，页面拿不到）：取最后一个 text block，入会话 digest。
          const sid = session?.id ?? ''
          const content = event.data?.message?.content
          if (sid !== '' && Array.isArray(content)) {
            for (let i = content.length - 1; i >= 0; i -= 1) {
              const block = content[i]
              if (block?.type !== 'text' || typeof block.text !== 'string') continue
              const text = block.text.replace(/\s+/g, ' ').trim()
              if (text !== '') { recordDigest(sid, { summary: text.slice(0, 500) }); break }
            }
          }
          return
        }

        // #186：忙状态转移（与通知解耦——busy-state 不投递通知，只驱动防休眠）
        if (event.type === 'turn/start') {
          if (session?.id) {
            busySessions.add(session.id)
            // 新回合开始：上一回合的 digest 作废（避免旧摘要配新完成）。
            notifyDigestBySession.delete(session.id)
          }
          reportBusy(false)
          return
        }
        if (event.type === 'approval/asked') {
          if (session?.id) waitingSessions.add(session.id)
          reportBusy(false)
          return
        }
        if (event.type === 'approval/decided') {
          if (session?.id) waitingSessions.delete(session.id)
          reportBusy(false)
          return
        }
        if (event.type === 'tool/call' && event.data?.name === 'ask_user_question') {
          const callId = event.data?.callId ?? ''
          if (session?.id && callId) {
            questionCalls.set(callId, session.id)
            waitingSessions.add(session.id)
          }
          reportBusy(false)
          return
        }
        if (event.type === 'tool/result') {
          // 回答交上去了：这个 callId 对应的等待结束
          const callId = event.data?.message?.toolCallId ?? event.data?.callId ?? ''
          const owner = callId ? questionCalls.get(callId) : undefined
          if (owner) {
            questionCalls.delete(callId)
            waitingSessions.delete(owner)
          }
          reportBusy(false)
          return
        }

        if (event.type === 'turn/end') {
          const sid = session?.id ?? ''
          // 忙状态先摘：防休眠要随回合立刻释放；通知触发在页面半区（#116 重做）。
          if (sid) {
            busySessions.delete(sid)
            waitingSessions.delete(sid)
          }
          const reason = event.data?.reason
          if (sid !== '') {
            recordDigest(sid, {
              kind: typeof reason?.kind === 'string' ? reason.kind : 'done',
              error: reason?.kind === 'error' && typeof reason?.error?.message === 'string' ? reason.error.message.slice(0, 500) : '',
            })
          }
          reportBusy(false)
        }
      } catch { /* 单个事件处理失败不影响 dsh */ }
    },
    { global: true },
  )

  // 补充信号：agent 自身在跑（含子代理会话）也算忙；与 session/event 互补。
  ctx.on(
    'agent/status',
    (payload = {}) => {
      try {
        const sid = payload?.agent?.session?.id ?? ''
        if (!sid) return
        if (payload.status === 'running') busySessions.add(sid)
        else if (payload.status === 'idle') busySessions.delete(sid)
        else return
        reportBusy(false)
      } catch { /* 忽略 */ }
    },
    { global: true },
  )

  ctx.on(
    'agent/error',
    (payload = {}) => {
      try {
        const sid = payload?.agent?.session?.id ?? ''
        const msg = typeof payload?.error === 'string' ? payload.error : (payload?.error?.message ?? '')
        // 错误情报入会话 digest（页面 running 边沿时取用）；不再走 report——它只放行
        // busy-state，旧调用是死代码（#116 整改）。
        if (sid !== '' && msg !== '') recordDigest(sid, { kind: 'error', error: String(msg).slice(0, 500) })
      } catch { /* 忽略 */ }
    },
    { global: true },
  )

}
