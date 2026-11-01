// mDNS 服务广播：让手机壳在局域网内「发现」这台桌面（发现 ≠ 授权）。
//
// 铁律：广播记录**绝不携带任何授权令牌**——发现只回答「桌面在哪儿、端口多少」，
// 授权永远由桌面签发的一次性限时链接完成（配对入口见 README 的授权模型）。
//
// 实现选型：纯 JS（bonjour-service → multicast-dns + dns-packet），无原生模块、
// 无外部守护进程。macOS/Windows 自带 mDNS 解析；没有 mDNSResponder 的 Linux 静默
// 落空——发现不成还有 IP 候选（见 links.ts 的地址候选机制）。
//
// 分层：① 记录装配（纯函数，可单测）② 广播器（发布/撤回，可注入）③ 生命周期挂接
// （在 index.ts 的 lane listen/close 上）。
import { sanitizeLocalHostname } from './links.js'

/** 服务类型名（bonjour 形态：`<name>._<protocol>.local`）。 */
export const LANE_MDNS_TYPE = 'dsh-lane'

/** 服务类型全名（供文档/断言用）。 */
export const LANE_MDNS_SERVICE = '_dsh-lane._tcp.local'

/** 广播器可注入的错误回调（缺省吞掉错误：广播失败绝不能拖垮 lane）。 */
function noop(): void { }

/**
 * 广播记录里的元数据（TXT 记录）。
 *
 * **只放「在哪」类事实**：主机名、端口、配对入口路径。令牌、会话 cookie、设备 ID
 * 一律不得进广播——mDNS 是明文组播，整条局域网都看得见。
 */
export interface LaneTxt {
  host: string
  port: string
  path: string
  [key: string]: string
}

/** 一条广播记录（bonjour 发布用）。 */
export interface LaneServiceRecord {
  name: string
  type: string
  protocol: string
  port: number
  host: string
  txt: Record<string, string>
}

/**
 * 广播器（publisher）：发布 / 撤回一条服务记录。
 */
export interface Publisher<T = LaneServiceRecord> {
  publish(record: T): void | Promise<void>
  unpublish(): void | Promise<void>
}

/** 广播器生命周期状态。 */
export interface LaneAdvertiserState<T> {
  running: boolean
  error: string | null
  record: T
}

/** 广播器的生命周期包装（start 幂等、stop 幂等，状态可观测）。 */
export interface LaneAdvertiser<T> {
  state: LaneAdvertiserState<T>
  start(): Promise<LaneAdvertiserState<T>>
  stop(): Promise<LaneAdvertiserState<T>>
}

/** multicast-dns 的 socket 表面（就绪/错误监听）。 */
interface MdnsSocket {
  on(event: 'error', listener: (err: unknown) => void): void
  once(event: 'ready', listener: () => void): void
  once(event: 'error', listener: (err: unknown) => void): void
}

/** 广播记录（TXT 记录）的构造参数。 */
export function buildLaneTxt({ host, port, path = '/pair' }: { host?: unknown; port?: unknown; path?: unknown }): LaneTxt {
  return {
    host: String(host ?? ''),
    port: String(port ?? ''),
    path: String(path ?? ''),
  }
}

/**
 * 组装一条广播记录（纯函数）。
 *
 * @param opts 组装参数
 * @param opts.name 实例名（发现列表里显示）
 * @param opts.host 目标主机名（SRV 目标 → `<host>.local`）
 * @param opts.port lane 端口
 * @param opts.txt TXT 记录
 */
export function buildLaneServiceRecord({
  name,
  host,
  port,
  txt,
}: {
  name?: unknown
  host?: unknown
  port?: unknown
  txt?: Record<string, string>
}): LaneServiceRecord {
  return {
    name: String(name ?? ''),
    type: LANE_MDNS_TYPE,
    protocol: 'tcp',
    port: Number(port),
    host: String(host ?? ''),
    txt: { ...(txt ?? {}) },
  }
}

/** 默认实例名：`DSH Desktop Plus - <主机名>`（同网多台桌面可区分）。 */
export function defaultServiceName(host: unknown): string {
  const label = sanitizeLocalHostname(host)
  return label ? 'DSH Desktop Plus - ' + label : 'DSH Desktop Plus'
}

/**
 * 默认广播器：bonjour-service（纯 JS mDNS 实现）。
 *
 * 动态 import：依赖缺失时不拖垮 lane（调用方捕获并告警），也让单测可以在没有
 * node_modules 的环境里跑（测试注入假广播器，不碰真实组播）。
 */
export function createBonjourPublisher({ onError = noop }: { onError?: (error: unknown) => void } = {}): Publisher<LaneServiceRecord> {
  let instance: InstanceType<typeof import('bonjour-service')> | null = null
  return {
    async publish(record) {
      const mod = await import('bonjour-service')
      const Bonjour = mod.default ?? mod.Bonjour
      // 错误回调必须吞掉异常：multicast-dns 的 socket 错误默认会 throw，
      // 在 dsh 宿主进程里等于「广播失败 = 整个应用崩」。
      const inst = new Bonjour({}, (err: unknown) => { try { onError(err); } catch { /* noop */ } })
      instance = inst
      await waitForSocket(inst, onError)
      inst.publish({
        name: record.name,
        type: record.type,
        protocol: 'tcp',
        port: record.port,
        host: record.host,
        txt: record.txt,
        // 不做同名探测：探测会引入数百毫秒延迟与一次控制台噪声，
        // 而实例名已带主机名，撞名概率极低。
        probe: false,
      })
    },
    unpublish() {
      const inst = instance
      instance = null
      if (!inst) return
      return new Promise<void>((resolve) => {
        const done = () => { try { inst.destroy(() => resolve()); } catch { resolve(); } }
        try {
          // 先发「告别包」（TTL=0）再关 socket：顺序反了手机端会缓存旧记录。
          inst.unpublishAll(done)
        } catch {
          try { inst.destroy(); } catch { /* noop */ }
          resolve()
        }
      })
    },
  }
}

/**
 * 等 mDNS socket 真的绑上 5353（= 广播确实能发出去）。
 *
 * 两件事在这里顺手做完：① 给底层 mdns 挂 'error' 监听——bonjour-service 内部没有
 * 监听它，socket 错误会以未捕获异常冒泡（dsh 跑在宿主进程里，会把整个应用带崩）；
 * ② 绑定失败/超时 → 抛错，让调用方把广播标记为「未启动」而不是假装成功。
 */
async function waitForSocket(instance: unknown, onError: (error: unknown) => void): Promise<void> {
  // bonjour-service 的 `server` 字段在其类型声明里是 private（运行时可读）：
  // 这里只取它下面的 mdns socket 做就绪/错误监听，不做别的访问。
  const server = Reflect.get(Object(instance), 'server') as { mdns?: MdnsSocket } | undefined
  const mdns = server?.mdns
  if (!mdns || typeof mdns.on !== 'function') return;   // 内部结构变了 → 不阻断发布
  mdns.on('error', (err) => { try { onError(err); } catch { /* noop */ } });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mDNS socket 绑定超时')), 3000);
    mdns.once('ready', () => { clearTimeout(timer); resolve(); });
    mdns.once('error', (err) => { clearTimeout(timer); reject(err); });
  })
}

/**
 * 广播器的生命周期包装：start 幂等、stop 幂等，状态可观测。
 *
 * @param opts 包装参数
 * @param opts.record 广播记录（buildLaneServiceRecord 的产物）
 * @param opts.publisher 广播器实现（测试注入假实现）
 */
export function createLaneAdvertiser<T extends { name: string }>({
  record,
  publisher,
}: {
  record: T
  publisher: Publisher<T>
}): LaneAdvertiser<T> {
  const state: LaneAdvertiserState<T> = { running: false, error: null, record }
  return {
    state,
    async start() {
      if (state.running) return state
      try {
        await publisher.publish(record)
        state.running = true
        state.error = null
      } catch (e) {
        state.running = false
        state.error = String((e as { message?: unknown } | null | undefined)?.message ?? e)
      }
      return state
    },
    async stop() {
      if (!state.running) return state;   // 未发布过 → 无需撤回（幂等）
      try {
        await publisher.unpublish()
      } catch (e) {
        state.error = String((e as { message?: unknown } | null | undefined)?.message ?? e)
      }
      state.running = false
      return state
    },
  }
}
