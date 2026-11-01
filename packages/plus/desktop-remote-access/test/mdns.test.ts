// mDNS 服务广播（#57）：生命周期挂接 + 记录纪律（**不含任何授权令牌**）。
//
// 测试一律注入假广播器：不碰真实组播 socket（CI/沙箱里 5353 未必可用），
// 断言的是「lane 起 → 广播被发布；lane 停 → 广播被撤回」这条生命周期不变式。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  LANE_MDNS_SERVICE,
  LANE_MDNS_TYPE,
  buildLaneServiceRecord,
  buildLaneTxt,
  createLaneAdvertiser,
  defaultServiceName,
  type LaneServiceRecord,
} from '../src/host/mdns.js'
import { createRemoteAccessService, startLaneRuntime } from '../src/host/index.js'
import { createMemoryStorage } from '../src/host/pairing.js'

/** 假广播器：记录调用序列。 */
function fakePublisher() {
  const calls: { op: string; record?: LaneServiceRecord }[] = [];
  return {
    calls,
    publish(record: LaneServiceRecord) { calls.push({ op: 'publish', record }); },
    unpublish() { calls.push({ op: 'unpublish' }); },
  };
}

test('广播记录：服务类型 _dsh-lane._tcp，字段只有「在哪」类事实', () => {
  const record = buildLaneServiceRecord({
    name: defaultServiceName('My Mac'),
    host: 'my-mac',
    port: 3091,
    txt: buildLaneTxt({ host: 'my-mac', port: 3091 }),
  });
  assert.equal(record.type, LANE_MDNS_TYPE);
  assert.equal('_' + record.type + '._' + record.protocol + '.local', LANE_MDNS_SERVICE);
  assert.equal(LANE_MDNS_SERVICE, '_dsh-lane._tcp.local');
  assert.equal(record.port, 3091);
  assert.equal(record.host, 'my-mac');
  assert.deepEqual(record.txt, { host: 'my-mac', port: '3091', path: '/pair' });
  assert.equal(defaultServiceName('My Mac'), 'DSH Desktop Plus - my-mac');
});

test('广播记录不含任何授权令牌（发现 ≠ 授权）', () => {
  const token = 'f'.repeat(32);
  const record = buildLaneServiceRecord({
    name: defaultServiceName('host'),
    host: 'host',
    port: 3091,
    txt: buildLaneTxt({ host: 'host', port: 3091 }),
  });
  // 记录里根本没有承载凭据的位置
  assert.ok(!JSON.stringify(record).includes(token));
  for (const key of Object.keys(record.txt)) {
    assert.ok(!/token|session|cookie|secret|password|key/i.test(key), 'TXT 键不得像凭据: ' + key);
  }
  assert.deepEqual(Object.keys(record.txt).sort(), ['host', 'path', 'port']);
});

test('广播器生命周期：start 发布一次、stop 撤回一次（幂等）', async () => {
  const publisher = fakePublisher();
  const record = buildLaneServiceRecord({ name: 'x', host: 'h', port: 1, txt: {} });
  const advertiser = createLaneAdvertiser({ record, publisher });
  await advertiser.start();
  await advertiser.start();
  assert.equal(publisher.calls.filter((c) => c.op === 'publish').length, 1, '重复 start 不重复发布');
  assert.equal(advertiser.state.running, true);
  await advertiser.stop();
  await advertiser.stop();
  assert.equal(publisher.calls.filter((c) => c.op === 'unpublish').length, 1, '重复 stop 不重复撤回');
  assert.equal(advertiser.state.running, false);
});

test('广播器：发布失败不抛，状态可见（广播失败不得拖垮 lane）', async () => {
  const advertiser = createLaneAdvertiser({
    record: { name: 'x' },
    publisher: {
      publish() { throw new Error('no multicast'); },
      unpublish() { },
    },
  });
  await advertiser.start();
  assert.equal(advertiser.state.running, false);
  assert.match(advertiser.state.error ?? '', /no multicast/);
});

test('lane 生命周期：listen 即广播、close 即停（假广播器）', async () => {
  const publisher = fakePublisher();
  const svc = createRemoteAccessService({
    storage: createMemoryStorage(),
    upstreamPort: 3080,
    mdns: { enabled: true, publisher },
  });
  // 先铸一枚令牌：广播记录里绝不能出现它（mDNS 是明文组播）。
  const token = svc.store.mint();
  const lp = await svc.listen();
  try {
    assert.equal(publisher.calls.length, 1, 'lane 起来即广播一次');
    assert.equal(publisher.calls[0]!.op, 'publish');
    const record = publisher.calls[0]!.record!;
    assert.equal(record.port, lp, '广播的是 lane 实际端口');
    assert.equal(svc.mdns.running, true);
    assert.ok(!JSON.stringify(record).includes(token), '广播记录不含令牌');
    assert.ok(!JSON.stringify(record.txt).includes(token), '广播 TXT 不含令牌');
  } finally {
    await svc.close();
  }
  assert.equal(publisher.calls.length, 2, 'lane 关闭即撤回广播');
  assert.equal(publisher.calls[1]!.op, 'unpublish');
  assert.equal(svc.mdns.running, false);
});

test('lane 未开启广播时不发布（默认不广播）', async () => {
  const publisher = fakePublisher();
  const svc = createRemoteAccessService({
    storage: createMemoryStorage(),
    upstreamPort: 3080,
    mdns: { enabled: false, publisher },
  });
  await svc.listen();
  try {
    assert.equal(publisher.calls.length, 0, '未开启则不广播');
    assert.equal(svc.mdns.running, false);
  } finally {
    await svc.close();
  }
});

test('插件入口：lane 起来即广播、dispose 即停', async () => {
  const publisher = fakePublisher();
  const prevPort = process.env.DSH_REMOTE_LANE_PORT;
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_REMOTE_LANE_PORT = '0';   // 随机端口，避免撞上真实 lane
  process.env.DSH_HOME = '/tmp/dsh-mdns-test-' + Date.now();
  const ctx = {
    on() { /* dispose 由 runtime.dispose 显式调用 */ },
    get() { return undefined; },
    logger: { info() { }, warn() { }, error() { } },
    webServer: { port: 0 },
  };
  let runtime: ReturnType<typeof startLaneRuntime> | null = null;
  try {
    runtime = startLaneRuntime(ctx, { mdns: { enabled: true, publisher } });
    assert.ok(runtime, '运行时已启动');
    await runtime!.ready;
    assert.equal(publisher.calls.length, 1, 'lane 起来即广播');
    assert.equal(publisher.calls[0]!.op, 'publish');
    await runtime!.dispose();
    assert.equal(publisher.calls.length, 2, 'dispose 即撤回广播');
    assert.equal(publisher.calls[1]!.op, 'unpublish');
    assert.equal(runtime!.svc.mdns.running, false);
  } finally {
    if (runtime) await runtime.dispose().catch(() => { });
    if (prevPort === undefined) delete process.env.DSH_REMOTE_LANE_PORT;
    else process.env.DSH_REMOTE_LANE_PORT = prevPort;
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  }
});
