#!/usr/bin/env python3
"""本地假 lane（票 #60 验证用）。

模拟 lane 的最小行为面，供安卓壳在没有真实桌面主机时自测：

- GET  /index.html        → 渲染好的 dsh 页面骨架 + 四类注入行
                            （模块加载 facade / __DSH_BOOT__ 全局 / bootstrap script-src / READY）
- GET  /plugins/??…       → 插件 combo bundle（注册一个假的 __ModuleLoader__ 工厂）
- GET  /api/…             → JSON 回显（验证壳的转发与 Cookie 附加）
- POST /api/…             → JSON 回显（验证原生请求桥带 body 的转发）
- POST /__dsh-mobile/api/pair/ws-token → 200 {"token":"mock-ws-token"}（壳换取直连令牌的入口）
- WS   /__dsh_ws/<令牌>/api/remote.mux → 最小帧回声（页面带令牌直连，壳不再中继）

用法：python3 tools/mock-lane.py [port=8091]
自检：python3 tools/selftest.py [port=8091]（起假 lane 并断言请求面）
"""
import base64
import hashlib
import json
import os
import struct
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

#: 假 lane 签发的直连令牌（真实 lane 会验签，假 lane 不校验）。
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

    def do_GET(self):
        if self.path.startswith("/index.html"):
            self._index()
            return
        if self.path.startswith("/plugins/"):
            self._send(200, BUNDLE, "application/javascript")
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
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode() if length else ""
        if self.path.startswith("/__dsh-mobile/api/pair/ws-token"):
            # 直连令牌：壳拿会话 cookie 换一个能放进 URL 的令牌（真实 lane 会验签）。
            self._send(200, json.dumps({"token": WS_TOKEN}, ensure_ascii=False))
            return
        self._send(
            200,
            json.dumps(
                {
                    "ok": True,
                    "path": self.path,
                    "body": body,
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

    def _is_websocket_upgrade(self):
        """请求是不是 WebSocket 升级（只看 Upgrade 头，与既有行为一致）。"""
        return self.headers.get("Upgrade", "").lower() == "websocket"

    def _serve_websocket(self):
        """WS 回声：握手后收一帧、回一帧，直到对端关闭。"""
        self._handshake()
        while True:
            opcode, payload = self._read_frame()
            if opcode is None or opcode == 0x08:
                break
            if opcode in (0x01, 0x02):
                self._send_text("mock-echo:" + (payload or b"").decode("utf-8", "replace"))
        # WS 会话结束即终结这条连接：它不再承载 HTTP 请求。
        self.close_connection = True

    def handle_one_request(self):
        """自己读请求行 + 解析请求头，再分派到 do_* / WS 回声。

        为什么不能直接 `super().handle_one_request()`：WS 升级请求不走 do_* 分支，
        得在应答前拦下来。可一旦覆写本方法，基类那段「读请求行 → parse_request()」
        也就不在这里了——而 self.headers / self.command / self.path 都要 parse_request()
        之后才被填上，直接读 self.headers 每请求必抛 AttributeError（票 #67）。

        keep-alive：同一条连接上的第二个请求会再次进入本方法，所以每次都读**新**的
        请求行；沿用旧行会把同一个请求处理两次，客户端于是在下一个请求里读到多出来
        的应答，看起来像“服务端行为不稳”。
        """
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
            # 错误码已经发出去了，直接收工。
            return
        method = getattr(self, "do_" + (self.command or ""), None)
        if method is None:
            self.send_error(501, "不支持的方法")
            return
        # 升级请求走 WS 回声，其余交给 do_* 分支。
        if self._is_websocket_upgrade():
            self._serve_websocket()
            return
        method()
        self.wfile.flush()

    def log_message(self, format, *args):
        print("[mock-lane]", format % args, flush=True)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    print(f"mock lane on http://0.0.0.0:{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
