import { socket } from '@kit.NetworkKit';

/**
 * 平台的 TCP 连接实现（`@ohos.net.socket`）。
 *
 * 预检只要「连得上」这个结论，所以连上就断开——**一个字节都不发**，
 * 更谈不上带凭证。
 *
 * 连接超时由平台自己兜（`TCPConnectOptions.timeout`），失败一律当不可达。
 */
export async function connectTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const tcp = socket.constructTCPSocketInstance();
  const address: socket.NetAddress = {
    address: host,
    port: port,
  };
  const options: socket.TCPConnectOptions = {
    address: address,
    timeout: timeoutMs,
  };
  try {
    await tcp.connect(options);
    return true;
  } catch (error) {
    return false;
  } finally {
    try {
      await tcp.close();
    } catch (error) {
      // 关闭失败不影响「连得上吗」这个结论。
    }
  }
}
