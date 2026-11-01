#!/usr/bin/env python3
"""本地假 lane（票 #64 的 iOS 壳自测用）。

模拟 lane 的最小行为面，供 iOS 壳在没有真实桌面主机时自测。与
`mobile/android/tools/mock-lane.py` 同构（同一份 lane 契约），额外补上
**配对门禁**与**控制面**，好让「降级链」也能在假 lane 上走通：

- GET  /index.html          → 渲染好的 dsh 页面骨架 + 四类注入行
                              （模块加载 facade / __DSH_BOOT__ 全局 / bootstrap script-src / READY）
                              **带有效会话 cookie 才放行**，否则 401 {"error":"unpaired"}
- GET  /plugins/??…         → 插件 combo bundle（注册一个假的 __ModuleLoader__ 工厂）
- GET  /api/…               → JSON 回显（验证壳的转发与 Cookie 附加）
- POST /api/…               → JSON 回显（验证原生请求桥带 body 的转发）
- POST /__dsh-mobile/api/pair/renew  → 200 + Set-Cookie（deviceId 已知）/ 403 unknown-device
- POST /__dsh-mobile/api/pair/accept → 200 + Set-Cookie + {deviceId} / 403 invalid-token
- GET  /__dsh-mobile/api/pair/probe  → 200 {ok, status, reason}
- POST /__dsh-mobile/api/pair/ws-token → 200 {token}（带有效会话 cookie）/ 401 unpaired
- WS   任意路径              → 最小帧回声（手工验证用）

假凭证（自测专用）：
- 会话 cookie：`dsh_mobile_session=mock-session-token`
- 设备 ID：`mock-device`
- 配对令牌：`mock-token`
- 直连令牌：`mock-ws-token`（签发后放进 `ws://<lane>/__dsh_ws/<令牌>/`）

用法：python3 tools/mock-lane.py [port=8092]
"""
import base64
import hashlib
import json
import os
import struct
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

SESSION_VALUE = "mock-session-token"
DEVICE_ID = "mock-device"
PAIR_TOKEN = "mock-token"
WS_TOKEN = "mock-ws-token"

BOOT_GRAPH = {
    "rev": "mock-rev-0001",
    "release": {"version": "0.0.0-mock", "commit": "mock"},
    "entries": [
        {
            "id": "@deepseek-ai/dsh-client-modules",
            "url": "plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=mock",
            "rev": "mock",
            "external": [],
        }
    ],
    "batches": [
        {
            "phase": "bootstrap",
            "url": "plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=mock",
            "entries": ["@deepseek-ai/dsh-client-modules"],
        }
    ],
}

FACADE = """<script>(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    const index=pendingQueue.findIndex(registration=>registration.id==="@deepseek-ai/dsh-client-modules")
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("mock: bootstrap bundle missing")
    pendingQueue.splice(index,1)
    return registration.factory(()=>{throw new Error("mock: external module requested")})
  }
}
})()</script>"""

BOOT_GLOBAL = (
    '<script>globalThis["__DSH_BOOT__"] = '
    + json.dumps(BOOT_GRAPH, ensure_ascii=False)
    + "</script>"
)

BOOTSTRAP_SRC = (
    '<script src="plugins/??@deepseek-ai/dsh-client-modules/client.js&amp;rev=mock"></script>'
)

READY = "<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>"

BUNDLE = """window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-modules",
  factory: function () {
    return {
      createClientModuleSystem: function () {
        return { manifest: { plugins: [] }, prefetch: function () {} }
      },
      apply: function () {}
    }
  }
});
"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, body, content_type="application/json", headers=None):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def _session_ok(self):
        """会话 cookie 是否有效（门禁只看这一对）。"""
        return f"dsh_mobile_session={SESSION_VALUE}" in (self.headers.get("Cookie", "") or "")

    def _gated(self):
        self._send(401, json.dumps({"error": "unpaired"}))

    def _index(self):
        html = (
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<title>mock lane</title>"
            + FACADE
            + BOOT_GLOBAL
            + BOOTSTRAP_SRC
            + "</head><body><div id=\"root\"></div>"
            + READY
            + "</body></html>"
        )
        self._send(200, html, "text/html; charset=utf-8")

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode() if length else ""
        try:
            return json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        if self.path.startswith("/index.html"):
            if not self._session_ok():
                self._gated()
                return
            self._index()
            return
        if self.path.startswith("/plugins/"):
            self._send(200, BUNDLE, "application/javascript")
            return
        if self.path.startswith("/__dsh-mobile/api/pair/probe"):
            self._send(200, json.dumps({"ok": True, "status": 200, "reason": "mock"}))
            return
        if self.path.startswith("/api/"):
            self._send(
                200,
                json.dumps(
                    {
                        "ok": True,
                        "path": self.path,
                        "cookie": self.headers.get("Cookie", "(none)"),
                        "via": "mock-lane",
                    },
                    ensure_ascii=False,
                ),
            )
            return
        self._send(404, json.dumps({"error": "not found", "path": self.path}))

    def do_POST(self):
        if self.path.startswith("/__dsh-mobile/api/pair/renew"):
            payload = self._read_json()
            if payload.get("deviceId") == DEVICE_ID:
                self._send(
                    200,
                    json.dumps({"ok": True}),
                    headers={"Set-Cookie": f"dsh_mobile_session={SESSION_VALUE}; Path=/; HttpOnly"},
                )
            else:
                self._send(403, json.dumps({"error": "unknown-device"}))
            return
        if self.path.startswith("/__dsh-mobile/api/pair/accept"):
            payload = self._read_json()
            if payload.get("token") == PAIR_TOKEN:
                self._send(
                    200,
                    json.dumps({"ok": True, "deviceId": DEVICE_ID}),
                    headers={"Set-Cookie": f"dsh_mobile_session={SESSION_VALUE}; Path=/; HttpOnly"},
                )
            else:
                self._send(403, json.dumps({"error": "invalid-token"}))
            return
        if self.path.startswith("/__dsh-mobile/api/pair/ws-token"):
            # 直连令牌：把会话 cookie 换成可以放进 URL 的签名令牌（WS 带不了请求头）。
            # 请求体要先读干净：keep-alive 连接的下一条请求会把残留字节当成请求行。
            self._read_json()
            if not self._session_ok():
                self._gated()
                return
            self._send(200, json.dumps({"token": WS_TOKEN}))
            return
        payload = self._read_json()
        self._send(
            200,
            json.dumps(
                {
                    "ok": True,
                    "path": self.path,
                    "body": payload,
                    "cookie": self.headers.get("Cookie", "(none)"),
                },
                ensure_ascii=False,
            ),
        )

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def _handshake(self):
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()

    def _read_frame(self):
        header = self.rfile.read(2)
        if len(header) < 2:
            return None, None
        length = header[1] & 0x7F
        if length == 126:
            length = struct.unpack(">H", self.rfile.read(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self.rfile.read(8))[0]
        payload = self.rfile.read(length) if length else b""
        return header[0] & 0x0F, payload

    def _send_text(self, text):
        payload = text.encode()
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(length)
        elif length < 65536:
            header.append(126)
            header += struct.pack(">H", length)
        else:
            header.append(127)
            header += struct.pack(">Q", length)
        self.wfile.write(bytes(header) + payload)

    def handle_one_request(self):
        # 自己解析请求头：BaseHTTPRequestHandler.handle_one_request 会先 parse_request，
        # 那样才有 self.headers / self.command（WS 升级请求不走 do_* 分支，故在此分派）。
        # 每次调用都读一行**新**的请求行（keep-alive 连接会再次进入本方法；
        # 若沿用旧行，同一个请求会被处理两次，于是客户端会在下一次请求里
        # 读到上一次多出来的应答——那会让自检结果看起来像“服务端行为不稳”）。
        self.raw_requestline = self.rfile.readline(65537)
        if not self.raw_requestline:
            self.close_connection = True
            return
        if len(self.raw_requestline) > 65536:
            self.requestline = ""
            self.request_version = ""
            self.command = ""
            self.send_error(414)
            return
        if not self.parse_request():
            return
        method = "do_" + (self.command or "")
        if not hasattr(self, method):
            self.send_error(501, "不支持的方法")
            return
        # 升级请求走 WS 回声，其余交给 do_* 分支。
        if self.headers.get("Upgrade", "").lower() == "websocket":
            self._handshake()
            while True:
                opcode, payload = self._read_frame()
                if opcode is None or opcode == 0x08:
                    break
                if opcode in (0x01, 0x02):
                    self._send_text("mock-echo:" + (payload or b"").decode("utf-8", "replace"))
            return
        getattr(self, method)()
        self.wfile.flush()

    def log_message(self, format, *args):
        print("[mock-lane]", format % args, flush=True)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8092
    print(f"mock lane on http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
