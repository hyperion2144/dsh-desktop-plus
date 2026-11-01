#!/usr/bin/env python3
"""本地假 lane（票 #65 验证用）。

模拟 lane 的最小行为面，供鸿蒙壳在没有真实桌面主机时自测：

- GET  /index.html              → 渲染好的 dsh 页面骨架 + 四类注入行
                                  （模块加载 facade / __DSH_BOOT__ 全局 / bootstrap script-src / READY）
- GET  /plugins/??…             → 插件 combo bundle（注册一个假的 __ModuleLoader__ 工厂）
- GET  /api/…                   → JSON 回显（验证壳的转发与 Cookie 附加）
- POST /api/…                   → JSON 回显（验证原生请求桥带 body 的转发）
- POST /__dsh-mobile/api/pair/accept → 接受配对，下发会话 cookie
- POST /__dsh-mobile/api/pair/renew  → 续期，下发会话 cookie
- GET  /__dsh-mobile/pair       → 状态探针（不需要凭证）
- WS   /api/remote.mux          → 最小帧回声（验证壳的 WS 中继与凭证）

用法：python3 tools/mock-lane.py [port=8091]
"""
import base64
import hashlib
import json
import struct
import sys
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
SESSION_COOKIE = "dsh_mobile_session=mock-session-0001"
DEVICE_ID = "mock-device-0001"

FACADE = """
<script>
window.__ModuleLoader__ = window.__ModuleLoader__ || [];
window.__ModuleLoader__.push = window.__ModuleLoader__.push || function () {};
</script>
"""

BOOT_GRAPH = """
<script>
globalThis["__DSH_BOOT__"] = {"rev":"mock-rev-0001","release":{"version":"0.0.0-mock","commit":"mock"},"entries":[]};
</script>
"""

BOOT_SCRIPT_SRC = """
<script src="plugins/??mock/client.js&rev=mock-rev-0001"></script>
"""

READY = """
<script>
(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve();
</script>
"""

COMBO = """
window.__ModuleLoader__ = window.__ModuleLoader__ || [];
window.__ModuleLoader__.push(function () { return Promise.resolve({ id: 'mock' }); });
"""

INDEX_HTML = (
    "<!doctype html><html><head><meta charset=\"utf-8\">"
    "<title>mock lane</title>"
    + FACADE + BOOT_GRAPH + BOOT_SCRIPT_SRC + READY +
    "</head><body><div id=\"root\"></div></body></html>"
)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):  # noqa: A002 - 覆写基类签名
        sys.stderr.write("mock-lane: " + (format % args) + "\n")

    def _send(self, status, body, content_type="application/json; charset=utf-8", extra=None):
        payload = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, status, value, extra=None):
        self._send(status, json.dumps(value, ensure_ascii=False), extra=extra)

    def handle_one_request(self):
        """在 HTTP 处理之前截获 WebSocket 升级请求。"""
        head = self.peek_head()
        if "upgrade: websocket" not in head.lower():
            super().handle_one_request()
            return
        key = ""
        for line in head.split("\r\n"):
            if line.lower().startswith("sec-websocket-key:"):
                key = line.split(":", 1)[1].strip()
        accept = base64.b64encode(
            hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.request.recv(len(head))
        self.request.sendall(
            ("HTTP/1.1 101 Switching Protocols\r\n"
             "Upgrade: websocket\r\nConnection: Upgrade\r\n"
             f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        websocket_echo(self.request)

    def peek_head(self):
        """不消费地读一段请求头（HTTP 升级请求的头不会太长）。"""
        head = ""
        self.request.settimeout(0.5)
        try:
            while "\r\n\r\n" not in head and len(head) < 8192:
                chunk = self.request.recv(1024, socket.MSG_PEEK)
                if not chunk:
                    break
                head += chunk.decode("latin-1")
        except OSError:
            pass
        finally:
            self.request.settimeout(None)
        return head

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler 的命名
        path, _, query = self.path.partition("?")
        if path == "/index.html":
            self._send(200, INDEX_HTML, "text/html; charset=utf-8")
        elif path.startswith("/plugins/"):
            self._send(200, COMBO, "application/javascript; charset=utf-8")
        elif path == "/__dsh-mobile/pair":
            self._json(200, {"ok": True})
        elif path.startswith("/api/"):
            self._json(200, {"ok": True, "echo": path, "query": query,
                              "cookie": self.headers.get("Cookie", "")})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler 的命名
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        if self.path == "/__dsh-mobile/api/pair/accept":
            self._json(200, {"deviceId": DEVICE_ID},
                       extra={"Set-Cookie": SESSION_COOKIE + "; HttpOnly; Path=/; SameSite=Lax"})
        elif self.path == "/__dsh-mobile/api/pair/renew":
            self._json(200, {"deviceId": DEVICE_ID},
                       extra={"Set-Cookie": SESSION_COOKIE + "; HttpOnly; Path=/; SameSite=Lax"})
        else:
            self._json(200, {"ok": True, "echo": self.path, "body": raw,
                              "cookie": self.headers.get("Cookie", "")})


def websocket_echo(client):
    """最小帧回声：收一帧，原样回一帧（掩码位清掉）。"""
    while True:
        header = client.recv(2)
        if len(header) < 2:
            return
        length = header[1] & 0x7F
        masked = header[1] & 0x80
        if length == 126:
            length = struct.unpack(">H", client.recv(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", client.recv(8))[0]
        mask = client.recv(4) if masked else b""
        payload = client.recv(length) if length else b""
        if masked and payload:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        client.sendall(bytes([0x81, len(payload)]) + payload)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    server = Server(("0.0.0.0", port), Handler)
    print(f"mock-lane 监听 http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
    main()
