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
// 宿主诊断走正规壳日志通道：log_diag 命令 → 壳日志内核 shell 源（shell.log，[diag] 前缀），
// 与壳/页面日志同一时间线；通道不在时静默（诊断不是关键路径）。
const pluginLog = (line) => {
  try {
    const rpc = globalThis.shellChannelRpc
    if (typeof rpc !== 'function') return
    const sent = rpc('log_diag', { msg: `dsh-desktop-plus: ${line}` })
    if (typeof sent?.catch === 'function') sent.catch(() => { })
  } catch { /* 通道不在：诊断不是关键路径 */ }
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
    connection.fetch.register({
      path: '/api/plus.notify-frame',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let rpcId = ''
        try {
          const body = await request.json()
          rpcId = String(body?.rpcId ?? '')
        } catch { /* 空 body：空 rpcId 回显 */ }
        const queued = notifyQueue.shift()
        if (queued !== undefined) return respondNotifyFrame(rpcId, queued)
        // 触发式长轮询：无帧时请求挂起在宿主，帧一入队立即唤醒返回；25s 无帧空手而归（页面重挂）。
        const frame = await new Promise((resolve) => {
          const waiter = (value) => { clearTimeout(timer); notifyWaiters.delete(waiter); resolve(value) }
          const timer = setTimeout(() => waiter(undefined), 25_000)
          notifyWaiters.add(waiter)
        })
        return respondNotifyFrame(rpcId, frame)
      },
    })
    connection.fetch.register({
      path: '/api/plus.play-sound',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let rpcId = ''
        try {
          const body = await request.json()
          rpcId = String(body?.rpcId ?? '')
          const sound = String(body?.payload?.sound ?? '')
          const quiet = systemQuietActive()
          pluginLog(`play-sound request: sound=${sound} quiet=${quiet}`)
          if (sound !== '' && sound !== 'none' && !quiet) playNotificationSound(sound)
          return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: true } })
        } catch (e) {
          return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'play-sound-failed', message: String(e?.message ?? e), details: {} } } })
        }
      },
    })
    pluginLog('routes registered: /api/shell.invoke, /api/plus.notify-frame, /api/plus.play-sound')
  }
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['connection'], registerShellRpc)
    else registerShellRpc(ctx)
  } catch (error) {
    ctx.logger?.warn?.(`dsh-desktop-plus: 壳命令桥注册失败（${String(error)}）`)
  }

  // ── 纯插件侧通知（#116，dsh-pet 照抄）：宿主单槽帧 + 设置决策 + 自播音效 ──
  // 显示与点击在页面半区（Web Notification + openSession/window.focus/dsh://open iframe——
  // toast 点击的用户手势落在页面上下文，Windows 前台限制拦不住）；busy 心跳仍走壳；
  // 设置（总开关/场景/免打扰时段）直接读 desktop-settings.json，不经壳。
  const NOTIFY_TITLES = {
    'task-complete': '任务已完成',
    'dsh-approval': '等待你的审批确认',
    'session-error': '会话出错',
  }
  const notifyQueue = []
  const notifyWaiters = new Set()
  const respondNotifyFrame = (rpcId, frame) => {
    if (frame !== undefined) pluginLog(`frame consumed by page: ${frame.type} sound=${frame.sound}`)
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: frame ?? null } })
  }
  let notifyFrameSeq = 0
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
  const systemQuietActive = () => {
    // 系统级免打扰/静音通知探不到时 fail-open：系统不管自播通道，只能自己探测。
    if (nodeModules.cp === undefined || nodeModules.path === undefined || nodeModules.os === undefined) return false
    try {
      if (process.platform === 'win32') {
        // Win11 免打扰（DND）状态存 CloudStore blob：键名前缀每台机器可能不同，
        // 枚举任意 *quiethourssettings* 键并解析 UTF-16LE 规则串——Unrestricted=关，其它规则=免打扰中。
        const ps = [
          "$base='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current'",
          "$keys = Get-ChildItem $base -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like '*windows.data.notifications.quiethourssettings*' }",
          "foreach ($k in $keys) {",
          "  foreach ($sub in @('', 'Current')) {",
          "    $p = if ($sub -eq '') { $k.PSPath } else { Join-Path $k.PSPath $sub }",
          "    $d = (Get-ItemProperty $p -Name Data -ErrorAction SilentlyContinue).Data",
          "    if ($d) { $s = [Text.Encoding]::Unicode.GetString($d); if ($s -match 'Microsoft\\.QuietHoursProfile\\.(\\w+)') { Write-Output ('rule=' + $Matches[1]); exit } }",
          "  }",
          "}",
          "Write-Output 'rule=none'",
        ].join('; ')
        const psOut = nodeModules.cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps], { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }).stdout ?? ''
        const ruleMatch = /rule=([A-Za-z]+)/.exec(psOut)
        const rule = ruleMatch === null ? 'none' : ruleMatch[1]
        pluginLog(`quiet probe: rule=${rule} -> ${rule === 'none' || rule === 'Unrestricted' ? 'sound allowed' : 'muted'}`)
        if (rule !== 'none' && rule !== 'Unrestricted') return true
        if (rule === 'Unrestricted') return false
        // 回退：Win10/旧版 QuietMode 信号（探不到则按非静音处理）
        const out = nodeModules.cp.spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\QuietHours', '/v', 'QuietMode'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).stdout ?? ''
        const match = /QuietMode\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(out)
        return match !== null && Number.parseInt(match[1], 16) !== 0
      }
      if (process.platform === 'darwin') {
        const assertions = nodeModules.path.join(nodeModules.os.homedir(), 'Library', 'DoNotDisturbDB', 'Assertions.json')
        const out = nodeModules.cp.spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', assertions], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).stdout ?? ''
        const parsed = JSON.parse(out)
        return (Array.isArray(parsed?.data) ? parsed.data : []).some((entry) => (entry?.storeAssertionRecords ?? []).length > 0)
      }
    } catch {
      return false
    }
    return false
  }
  const playNotificationSound = (sound) => {
    if (nodeModules.cp === undefined || nodeModules.path === undefined) return
    const home = dshHomeDir()
    try {
      if (process.platform === 'win32') {
        const file = sound === 'default' ? 'C:\\WINDOWS\\Media\\Windows Notify System Generic.wav' : nodeModules.path.join(home, 'sounds', sound)
        nodeModules.cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', `$p = New-Object System.Media.SoundPlayer -ArgumentList '${file}'; $p.PlaySync()`], { stdio: 'ignore' })?.unref?.()
        return
      }
      if (process.platform === 'darwin') {
        nodeModules.cp.spawn('/usr/bin/afplay', [sound === 'default' ? '/System/Library/Sounds/Ping.aiff' : nodeModules.path.join(home, 'sounds', sound)], { stdio: 'ignore' })?.unref?.()
        return
      }
      if (sound !== 'default') nodeModules.cp.spawn('paplay', [nodeModules.path.join(home, 'sounds', sound)], { stdio: 'ignore' })?.unref?.()
    } catch {
      // 播放后端缺席：静默降级，不影响横幅本身。
    }
  }
  const pushNotifyFrame = (frame) => {
    const settings = readNotificationConfig()
    const scenario = settings.scenarios[frame.type]
    if (settings.enabled === false || scenario?.enabled === false) return
    // 声音决策随帧下发，由页面在「确认要弹横幅」后回呼播放——声音与横幅严格同生同灭
    // （dsh-pet 语义：页面正看着就不弹，此时也不响；免打扰时段内横幅静默进通知中心）。
    const sound = inDndWindow(settings.dnd, new Date()) || scenario?.sound === 'none' ? 'none' : scenario?.sound ?? 'default'
    const entry = {
      id: ++notifyFrameSeq,
      type: frame.type,
      title: frame.title ?? NOTIFY_TITLES[frame.type] ?? 'DSH 桌面通知',
      body: frame.body ?? '',
      sessionId: frame.sessionId === '' ? undefined : frame.sessionId,
      sound,
    }
    if (notifyWaiters.size > 0) {
      const wake = notifyWaiters.values().next().value
      wake(entry)
    } else {
      notifyQueue.push(entry)
      if (notifyQueue.length > 8) notifyQueue.shift() // 防积压：页面长时间无响应时只留最新帧
    }
    pluginLog(`frame pushed: ${frame.type} sound=${sound} queue=${notifyQueue.length}`)
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
    // busy 心跳走壳（托盘防休眠）；三类会话通知走纯插件路径（dsh-pet 照抄）。
    if (type === 'busy-state') { sendShellNotice({ type, body, ...extra }); return }
    pushNotifyFrame({ type, title: extra?.title, body, sessionId: extra?.sessionId })
  }

  // #116：回复摘要缓存（会话 id → 最后一段 assistant 文本）。assistant/message 的
  // content[] 最后一个 text 块就是给用户看的回复；turn/end 时取出来当通知正文。
  const lastTextBySession = new Map()
  const MAX_SUMMARY_CHARS = 200
  const lastAssistantReplyText = (event) => {
    const content = event.data?.message?.content
    if (!Array.isArray(content)) return null
    for (let i = content.length - 1; i >= 0; i -= 1) {
      const block = content[i]
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const text = block.text.replace(/\s+/g, ' ').trim()
      if (text !== '') return text
    }
    return null
  }
  const lastTurnEndAt = new Map()
  const TURN_END_DEBOUNCE_MS = 10_000

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
        // #116：先攒回复摘要（通知正文用），再走忙状态/通知分发。
        if (event.type === 'assistant/message') {
          const sid = session?.id ?? ''
          const text = lastAssistantReplyText(event)
          if (sid !== '' && text !== null) lastTextBySession.set(sid, text)
          return
        }

        // #186：忙状态转移（与通知解耦——busy-state 不投递通知，只驱动防休眠）
        if (event.type === 'turn/start') {
          if (session?.id) busySessions.add(session.id)
          reportBusy(false)
          return
        }
        if (event.type === 'approval/asked') {
          if (session?.id) waitingSessions.add(session.id)
          reportBusy(false)
          report('dsh-approval', '等待你的审批确认', { sessionId: session?.id || undefined, profile: busyProfile || undefined, title: session?.title || undefined })
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
          // 忙状态先摘（不受下面的 10s 防抖影响：防休眠要随回合**立刻**释放）
          if (sid) {
            busySessions.delete(sid)
            waitingSessions.delete(sid)
          }
          reportBusy(false)
          const now = Date.now()
          const last = lastTurnEndAt.get(sid) ?? 0
          if (now - last < TURN_END_DEBOUNCE_MS) return
          lastTurnEndAt.set(sid, now)
          // event.data.reason.kind 区分结束原因（dsh-notifier 同源语义），
          // 文案不依赖 session.title（实测载荷中常不可用）。
          const kind = event.data?.reason?.kind ?? 'done'
          const kindText = {
            error: '回合异常结束',
            blocked: '回合被阻塞',
            'max-tokens': '回合达到 token 上限',
            interrupted: '回合被打断',
            done: '回合已结束',
          }[kind] ?? '回合已结束'
          const err = kind === 'error' ? (event.data?.reason?.error?.message ?? '') : ''
          const summary = lastTextBySession.get(sid) ?? ''
          lastTextBySession.delete(sid)
          const body = kind === 'error' && err !== ''
            ? `${kindText}：${err}`.slice(0, MAX_SUMMARY_CHARS)
            : (summary !== '' ? summary : kindText).slice(0, MAX_SUMMARY_CHARS)
          report('task-complete', body, { sessionId: sid || undefined, profile: busyProfile || undefined, title: session?.title || undefined })
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
        const agent = payload?.agent
        const msg = typeof payload?.error === 'string' ? payload.error : (payload?.error?.message ?? '')
        const title = agent?.session?.title ?? ''
        report('dsh-error', [title ? `「${title}」` : '', msg].filter(Boolean).join(' ').slice(0, 200))
      } catch { /* 忽略 */ }
    },
    { global: true },
  )

}
