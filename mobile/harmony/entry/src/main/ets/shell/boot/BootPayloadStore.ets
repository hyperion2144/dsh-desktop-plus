import { BootPayload } from './BootPayload';

/**
 * 当前生效的引导载荷。
 *
 * 页面在 document-start 通过壳自有端点取它；换主机时由
 * `shell/page/PageServer` 读出并返回。换主机的瞬间旧载荷会被新的替换——
 * 页面随后 reload，重新取到新载荷。
 */
export class BootPayloadStore {
  private current: BootPayload | null = null;

  set(payload: BootPayload | null): void {
    this.current = payload;
  }

  get(): BootPayload | null {
    return this.current;
  }
}
