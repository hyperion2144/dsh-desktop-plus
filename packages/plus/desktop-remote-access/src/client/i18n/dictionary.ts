/**
 * 远程访问设置页词典：key 就是源码里的中文原文，英文按 key 查。
 *
 * 与 desktop-plugin 同一口径：官方 locale 服务查表 miss 时回退 key 本身，
 * 所以 zh 字典是恒等映射，英文表里还没收的文案在英文界面保持中文原文。
 *
 * key 必须与 `client/client.source.jsx` 里的字面量逐字一致（含标点与 `{name}` 占位符）。
 */
export const en = {
  // ── 页面外框 ──
  '远程访问': 'Remote access',
  '三个通道独立维护配对二维码：扫码/打开链接即可配对（一次性令牌 + 会话 Cookie）。此页面供手机/其它设备连接本机；若要切换桌面壳自身连接的 dsh 服务来源，请用桌面设置的「dsh 服务地址」。': 'Each channel keeps its own pairing QR code: scan the code or open the link to pair (one-time token plus a session cookie). This page connects phones and other devices to this machine; to change the dsh service the desktop shell itself connects to, use “dsh service address” in the desktop settings.',

  // ── 局域网通道 ──
  '局域网': 'LAN',
  '手机连同一 WiFi，扫此码直连（仅局域网可达）。': 'Connect the phone to the same Wi-Fi and scan this code to connect directly (LAN only).',
  '铸造局域网令牌': 'Mint LAN token',
  '无法确定局域网地址': 'Cannot determine the LAN address',

  // ── 通道通用 ──
  '{label} 配对二维码': '{label} pairing QR code',
  '复制链接': 'Copy link',
  '已复制 ✓': 'Copied ✓',
  '10 分钟有效 · 一次性 · 扫码/打开即配对': 'Valid for 10 minutes · single use · scanning or opening pairs right away',
  '铸造失败：{message}': 'Minting failed: {message}',

  // ── 第三方隧道（cpolar 等） ──
  '第三方隧道（cpolar 等）': 'Third-party tunnel (cpolar and similar)',
  '隧道需指向改写代理端口 127.0.0.1:{port}；粘贴地址校验可达后，用此地址生成自己的配对二维码。': 'The tunnel must point at the rewrite proxy port 127.0.0.1:{port}. Paste the address, verify that it is reachable, then mint a pairing QR code for it.',
  '校验并保存': 'Verify and save',
  '校验中…': 'Verifying…',
  '请输入隧道地址': 'Enter the tunnel address',
  '✓ 可达已保存（HTTP {status}）': '✓ Reachable and saved (HTTP {status})',
  '✗ 不可达：{reason}': '✗ Unreachable: {reason}',
  '校验失败：{message}': 'Verification failed: {message}',
  '铸造隧道令牌': 'Mint tunnel token',
  '请先校验并保存隧道地址': 'Verify and save a tunnel address first',

  // ── cloudflared 公网隧道 ──
  'cloudflared 公网隧道': 'cloudflared public tunnel',
  'PATH 有 cloudflared 就直接用；否则 ~/.dsh/bin 缓存命中复用；都没有就一键从 GitHub/ghproxy 等多镜像下载到缓存。': 'If cloudflared is on PATH it is used directly; otherwise a cached copy in ~/.dsh/bin is reused; if neither exists, one click downloads it from several mirrors (GitHub, ghproxy and others) into the cache.',
  'cloudflared 完整路径（留空 = 一键启动）': 'Full path to cloudflared (leave empty for one-click start)',
  '运行中 · {url}': 'Running · {url}',
  '运行中 · 等待隧道地址…': 'Running · waiting for the tunnel URL…',
  '启动失败：{message}': 'Start failed: {message}',
  'cloudflared 无法启动': 'cloudflared could not start',
  '下载中 · {detail}': 'Downloading · {detail}',
  '解析中 · {detail}': 'Resolving · {detail}',
  '启动中…': 'Starting…',
  '已配置 · 未运行': 'Configured · not running',
  '未配置 · 未运行': 'Not configured · not running',
  '一键启动（无依赖）': 'One-click start (no dependencies)',
  '解析中 · 检查 PATH 与本地缓存…': 'Resolving · checking PATH and the local cache…',
  '一键启动失败：{message}': 'One-click start failed: {message}',
  '停止': 'Stop',
  '已停止': 'Stopped',
  '停止失败：{message}': 'Stop failed: {message}',
  '应用并启动': 'Apply and start',
  '应用中…': 'Applying…',
  '应用失败：{message}': 'Apply failed: {message}',
  '隧道未运行或无地址，请先启动 cloudflared': 'The tunnel is not running or has no URL; start cloudflared first',
  '查询失败：{message}': 'Query failed: {message}',

  // ── 已配对设备 ──
  '已配对设备': 'Paired devices',
  '配对服务不可达：{message}': 'The pairing service is unreachable: {message}',
  '暂无配对设备': 'No paired devices yet',
  '在线': 'online',
  '离线': 'offline',
  '设备信息待补全（该设备下次访问时刷新）': 'Device details will be filled in the next time this device connects',
  '移除': 'Remove',
  '移除失败：{message}': 'Remove failed: {message}',
} satisfies Record<string, string>

/** 词典 key 联合：中文原文即 key。 */
export type RemoteAccessCopyKey = keyof typeof en

/** 中文词典：key 恒等映射（中文界面就是把原文原样显示）。 */
export const zh: Record<RemoteAccessCopyKey, string> = Object.fromEntries(
  Object.keys(en).map((key) => [key, key]),
) as Record<RemoteAccessCopyKey, string>
