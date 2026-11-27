// 撤销配对的查表（#157）：两边都记着「本机在对端的设备 id」与「对端在本机 lane 上的设备记录 id」，
// 任一端发起撤销，另一端都能据此找到自己那边的记录；本机删设备时也能反查到对应的主机记录。
import { describe, expect, it } from 'vitest'
import { createMemoryRemoteHostStorage, findHostByDeviceId, findHostByLaneDevice, RemoteHostStore, type RemoteHostRecord } from '../src/host/remote-hosts.js'

function record(hostId: string, deviceId: string, laneDeviceId?: string): RemoteHostRecord {
  return { hostId, origin: `http://${hostId}.local:3091`, deviceId, cookie: 'c', name: hostId, pairedAt: 1, lastSeen: 1, ...(laneDeviceId === undefined ? {} : { laneDeviceId }) }
}

describe('撤销配对时按设备 id 反查主机记录', () => {
  const hosts = [record('b@http://a', 'me-on-b', 'b-on-me'), record('c@http://a', 'me-on-c')]

  it('对端发来撤销通知时只知道自己那边的「本机设备 id」：按 deviceId 找到本机对它的记录', () => {
    expect(findHostByDeviceId(hosts, 'me-on-b')?.hostId).toBe('b@http://a')
    expect(findHostByDeviceId(hosts, 'nope')).toBeNull()
    expect(findHostByDeviceId(hosts, '')).toBeNull()
  })

  it('本机从门禁里删掉一台设备时：按它在本机 lane 上的记录 id 反查主机记录；没记这个 id 的旧记录查不到', () => {
    expect(findHostByLaneDevice(hosts, 'b-on-me')?.hostId).toBe('b@http://a')
    expect(findHostByLaneDevice(hosts, 'me-on-c')).toBeNull()
    expect(findHostByLaneDevice(hosts, '')).toBeNull()
  })
})

describe('主机记录里的 laneDeviceId 落盘', () => {
  it('upsert 带上 laneDeviceId 的记录后，重新读表仍在', () => {
    const storage = createMemoryRemoteHostStorage()
    const store = new RemoteHostStore({ storage })
    store.upsert(record('b@http://a', 'me-on-b'))
    store.upsert({ ...record('b@http://a', 'me-on-b'), hostId: 'b@http://a', laneDeviceId: 'b-on-me' })
    const reloaded = new RemoteHostStore({ storage })
    expect(reloaded.get('b@http://a')?.laneDeviceId).toBe('b-on-me')
  })
})
