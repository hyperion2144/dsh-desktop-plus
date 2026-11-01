import { InjectionRow } from './InjectionRow';
import { Json } from '../util/Json';

/**
 * 引导载荷：页面在 document-start 取的那份数据。
 *
 * 两块内容：
 *  - `rows`：从 lane 渲染结果里解析出的注入行（facade / `__DSH_BOOT__` / bootstrap script-src / …）
 *  - `transport`：`__DSH_TRANSPORT__` 的配置（streamBaseUrl / createWebSocket / ownsHost）
 */
export class BootPayload {
  hostId: string = '';
  hostLabel: string = '';
  laneOrigin: string = '';
  pageOrigin: string = '';
  /** 页面侧 WebSocket 的 base：**直连 lane**（`ws(s)://<lane>/__dsh_ws/<令牌>/`）。
   * 末尾斜杠必需：页面用相对解析拼 `api/remote.mux`。 */
  socketBaseUrl: string = '';
  rows: InjectionRow[] = [];

  /**
   * 序列化成页面消费的 JSON。
   *
   * 手写而不是走通用序列化：这份 JSON 是**壳与页面之间的契约**，
   * 键名要一眼可见、不能因为字段改名而漂移。
   */
  toJson(): string {
    const rows: string[] = [];
    for (const row of this.rows) {
      if (row.kind === 'script') {
        rows.push(`{"kind":"script","text":${Json.quote(row.text)}}`);
      } else if (row.kind === 'script-src') {
        rows.push(`{"kind":"script-src","src":${Json.quote(row.src)}}`);
      } else {
        rows.push(`{"kind":"script-preload","src":${Json.quote(row.src)}}`);
      }
    }
    const host = `{"id":${Json.quote(this.hostId)},"label":${Json.quote(this.hostLabel)},"origin":${Json.quote(this.laneOrigin)}}`;
    const transport = `{"ownsHost":true,"streamBaseUrl":${Json.quote(this.socketBaseUrl)},` +
      `"laneOrigin":${Json.quote(this.laneOrigin)},"pageOrigin":${Json.quote(this.pageOrigin)}}`;
    return `{"host":${host},"transport":${transport},"rows":[${rows.join(',')}]}`;
  }
}
