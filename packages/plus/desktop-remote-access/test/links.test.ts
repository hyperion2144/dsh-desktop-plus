import { test } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeRemote, selectLanIPv4, selectLanIPv4s, buildPairLink, buildHttpPairLink, sanitizeLocalHostname, localHostnameCandidate, buildBaseCandidates, resolveBaseCandidates } from '../src/host/links.js'
import { laneRoutePath } from '../src/host/lane-routes.js'

test('normalizeRemote：去 scheme、默认端口、拒绝非法', () => {
  assert.equal(normalizeRemote('http://192.168.1.10:8080'), '192.168.1.10:8080');
  assert.equal(normalizeRemote('192.168.1.10'), '192.168.1.10:3080');
  assert.equal(normalizeRemote('  https://x.y.cn '), 'x.y.cn:3080');
  assert.equal(normalizeRemote('x/path'), null);
  assert.equal(normalizeRemote('user@h'), null);
  assert.equal(normalizeRemote(''), null);
  assert.equal(normalizeRemote('h:70000'), null);
});

test('selectLanIPv4：RFC1918 优先、物理网卡加分、VPN 减分', () => {
  const ifaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    'Radmin VPN': [{ address: '26.3.9.8', family: 'IPv4', internal: false }],
    en0: [{ address: '169.254.9.9', family: 'IPv4', internal: false }, { address: '192.168.1.23', family: 'IPv4', internal: false }],
  };
  assert.equal(selectLanIPv4(ifaces), '192.168.1.23');
  const noLan = { en0: [{ address: '26.3.9.8', family: 'IPv4', internal: false }] };
  assert.equal(selectLanIPv4(noLan), '26.3.9.8');
  assert.equal(selectLanIPv4({}), null);
});

test('buildPairLink / buildHttpPairLink 编码', () => {
  const a = buildPairLink(['192.168.1.23:3091'], 'tok_1');
  assert.match(a, /^dsh-mobile:\/\/pair\?token=tok_1&base=192\.168\.1\.23%3A3091$/);
  const b = buildHttpPairLink('x.cn:3091', 't2');
  // 浏览器兜底链接**刻意用历史形态 /pair**：已安装的旧壳解析器只认裸 /pair（命名空间形态
  // 会被当目录拼错 → 401，实机踩过）；lane 两种形态都服务，旧形态对新旧客户端都安全。
  assert.equal(b, 'http://x.cn:3091/pair?token=t2');
  assert.equal(laneRoutePath('/pair'), '/pair', '旧链接路径仍是 lane 路由（冻结别名）');
});

test('selectLanIPv4s：多网卡候选按可达性排序，首元素与单选一致', () => {
  const ifaces = {
    en0: [{ address: '192.168.1.23', family: 'IPv4', internal: false }],
    en1: [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
    'Radmin VPN': [{ address: '26.3.9.8', family: 'IPv4', internal: false }],
  };
  const all = selectLanIPv4s(ifaces);
  assert.equal(all[0], '192.168.1.23', '首元素与旧单选一致（既有行为不变）');
  assert.deepEqual(all, ['192.168.1.23', '10.0.0.5', '26.3.9.8'], '其余网卡候选一并保留');
  assert.deepEqual(selectLanIPv4s({}), []);
});

test('sanitizeLocalHostname：非法字符净化、过长截断、非法主机名返回 null', () => {
  assert.equal(sanitizeLocalHostname('My MacBook Pro'), 'my-macbook-pro');
  assert.equal(sanitizeLocalHostname('Foo.local'), 'foo-local');
  assert.equal(sanitizeLocalHostname('my_host'), 'my-host');
  assert.equal(sanitizeLocalHostname('a'.repeat(100)).length, 63, 'DNS 标签长度上限');
  assert.equal(sanitizeLocalHostname(''), null);
  assert.equal(sanitizeLocalHostname('   '), null);
  assert.equal(sanitizeLocalHostname('!!!'), null, '非法字符净化后为空 → null');
  assert.equal(sanitizeLocalHostname('---'), null);
  assert.equal(sanitizeLocalHostname(null), null);
});

test('localHostnameCandidate：主机名 → <主机名>.local', () => {
  assert.equal(localHostnameCandidate('My Mac'), 'my-mac.local');
  assert.equal(localHostnameCandidate('!!!'), null);
  // 主机名本身已带 .local：只净化首标签，名字必须与机器真实的 mDNS 名逐字对应
  assert.equal(localHostnameCandidate('Foo.local'), 'foo.local');
  assert.equal(localHostnameCandidate('My Mac.local'), 'my-mac.local');
});

test('buildBaseCandidates：`.local` 与多网卡 IP 并存', () => {
  const ifaces = {
    en0: [{ address: '192.168.1.23', family: 'IPv4', internal: false }],
    en1: [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
  };
  assert.deepEqual(
    buildBaseCandidates({ hostname: 'My Mac', interfaces: ifaces, port: 3091 }),
    ['my-mac.local:3091', '192.168.1.23:3091', '10.0.0.5:3091'],
    '.local 候选在前，IP 候选并存',
  );
  // 非法主机名 → 该候选缺席，IP 候选仍在
  assert.deepEqual(
    buildBaseCandidates({ hostname: '!!!', interfaces: ifaces, port: 3091 }),
    ['192.168.1.23:3091', '10.0.0.5:3091'],
  );
  // 无主机名、无网卡 → 空数组（调用方负责回退）
  assert.deepEqual(buildBaseCandidates({ interfaces: {}, port: 3091 }), []);
});

test('resolveBaseCandidates：无候选时回退到回环（回退行为不变）', () => {
  assert.deepEqual(resolveBaseCandidates({ interfaces: {}, port: 3091 }), ['127.0.0.1:3091']);
  assert.deepEqual(
    resolveBaseCandidates({ hostname: '!!!', interfaces: {}, port: 3091 }),
    ['127.0.0.1:3091'],
    '主机名非法 + 无网卡 → 回环',
  );
  assert.deepEqual(
    resolveBaseCandidates({ hostname: 'host', interfaces: {}, port: 3091 }),
    ['host.local:3091'],
    '有主机名就不回退',
  );
});

test('buildHttpPairLink：候选列表随链接下发（与 dsh-mobile:// 同名字段）', () => {
  const withBases = buildHttpPairLink('192.168.1.23:3091', 't3', ['my-mac.local:3091', '192.168.1.23:3091']);
  assert.equal(withBases, 'http://192.168.1.23:3091/pair?token=t3&base=my-mac.local%3A3091%2C192.168.1.23%3A3091');
  assert.equal(buildHttpPairLink('x.cn:3091', 't2'), 'http://x.cn:3091/pair?token=t2', '无候选时链接形态不变');
});
