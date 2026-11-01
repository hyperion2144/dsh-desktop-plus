#!/usr/bin/env python3
"""假 lane 自检（票 #67）。

为什么有它：假 lane 是安卓壳在**没有桌面主机**时唯一的联调对象。假 lane 一坏
（票 #67：覆写 `handle_one_request` 时直接读 `self.headers`，每请求抛 AttributeError），
壳侧就分不清是壳坏了还是 lane 坏了。这个脚本把「lane 该有的行为面」钉成断言：
起真假 lane、打真请求、逐条断言。

覆盖面：

- GET  /index.html     → 200 + 四类注入行（facade / __DSH_BOOT__ / script-src / READY）
- GET  /plugins/??…    → 200 + combo bundle
- GET  /api/…          → 200 + JSON 回显（ok / path / cookie / via）
- POST /api/…          → 200 + JSON 回显（ok / path / body / cookie）
- 未知路径              → 404
- keep-alive           → 一条连接上连发多个请求，各拿各的应答
- POST /__dsh-mobile/api/pair/ws-token → 200 + {"token":…}（壳换取直连令牌）
- WS   /api/remote.mux 与 /__dsh_ws/<令牌>/api/remote.mux → 101 握手（Sec-WebSocket-Accept 正确）
用法：python3 tools/selftest.py [port=8091]
（端口省略时由系统挑一个空闲端口，跑完即收，不留后台进程。）
"""
import base64
import hashlib
import importlib.util
import json
import os
import socket
import sys
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

# 载入 mock-lane.py 会写 __pycache__；自检是一次性工具，不该在仓库里留下字节码。
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
MOCK_LANE = os.path.join(HERE, "mock-lane.py")

#: WebSocket 握手常量（与 mock-lane.py 里的 GUID 一致）。
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

#: 壳附加的会话 cookie（整对 name=value）——用来验证 lane 回显了凭证。
SESSION_COOKIE = "dsh_mobile_session=mock-session-token"


def load_mock_lane():
    """按路径载入 mock-lane.py。

    文件名带连字符，不是合法模块名，只能走 importlib 按文件路径载入。
    """
    spec = importlib.util.spec_from_file_location("mock_lane", MOCK_LANE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"载入假 lane 失败：{MOCK_LANE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Lane:
    """在后台线程里跑假 lane（端口 0 = 让系统挑一个空闲端口）。"""

    def __init__(self, port=0):
        module = load_mock_lane()
        self.server = ThreadingHTTPServer(("127.0.0.1", port), module.Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_exc):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def request(port, method, path, body=None, headers=None):
    """打一个请求，返回 (状态码, 响应体文本, 响应头字典)。"""
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        return response.status, response.read().decode(), dict(response.getheaders())
    finally:
        conn.close()


def check_index(port):
    """页面骨架：四类注入行齐（壳的引导载荷就是从这页里解析注入行的）。"""
    status, body, _ = request(port, "GET", "/index.html")
    if status != 200:
        return False, f"状态 {status}（期望 200）"
    marks = {
        "facade": "__ModuleLoader__",
        "boot 全局": "__DSH_BOOT__",
        "bootstrap script-src": "plugins/??",
        "READY": "__DSH_BOOT_READY__",
    }
    missing = [name for name, mark in marks.items() if mark not in body]
    if missing:
        return False, "缺注入行：" + "、".join(missing)
    return True, f"200，四类注入行齐（{len(body)} 字节）"


def check_plugins(port):
    """插件 combo bundle：壳转发的 /plugins/ 请求要拿到可执行的 JS。"""
    status, body, headers = request(port, "GET", "/plugins/??mock/client.js&rev=mock")
    if status != 200:
        return False, f"状态 {status}（期望 200）"
    if "javascript" not in headers.get("Content-Type", ""):
        return False, f"Content-Type 不是 JS：{headers.get('Content-Type')}"
    if "__ModuleLoader__.load" not in body:
        return False, "bundle 没注册模块"
    return True, "200，combo bundle 正常"


def check_api_get(port):
    """GET /api/… 的回显形状：ok / path / cookie / via。"""
    status, body, _ = request(
        port, "GET", "/api/echo?x=1", headers={"Cookie": SESSION_COOKIE}
    )
    if status != 200:
        return False, f"状态 {status}（期望 200）"
    payload = json.loads(body)
    if payload.get("path") != "/api/echo?x=1":
        return False, f"path 回显不对：{payload.get('path')}"
    if payload.get("cookie") != SESSION_COOKIE:
        return False, f"cookie 回显不对：{payload.get('cookie')}"
    if payload.get("ok") is not True or payload.get("via") != "mock-lane":
        return False, f"字段不对：{payload}"
    return True, "200，JSON 回显四字段正确"


def check_api_post(port):
    """POST /api/… 的回显形状：ok / path / body / cookie（body 原样回显）。"""
    payload = json.dumps({"hello": "lane", "n": 7})
    status, body, _ = request(
        port,
        "POST",
        "/api/rpc?x=1",
        body=payload,
        headers={"Content-Type": "application/json", "Cookie": SESSION_COOKIE},
    )
    if status != 200:
        return False, f"状态 {status}（期望 200）"
    echoed = json.loads(body)
    if echoed.get("body") != payload:
        return False, f"body 回显不对：{echoed.get('body')}"
    if echoed.get("path") != "/api/rpc?x=1":
        return False, f"path 回显不对：{echoed.get('path')}"
    if echoed.get("cookie") != SESSION_COOKIE:
        return False, f"cookie 回显不对：{echoed.get('cookie')}"
    return True, "200，body 原样回显"


def check_ws_token(port):
    """直连令牌：壳用会话 cookie 换一个能放进 URL 的令牌。"""
    status, body, _ = request(
        port,
        "POST",
        "/__dsh-mobile/api/pair/ws-token",
        body="{}",
        headers={"Content-Type": "application/json", "Cookie": SESSION_COOKIE},
    )
    if status != 200:
        return False, f"状态 {status}（期望 200）"
    token = json.loads(body).get("token", "")
    if not token:
        return False, f"没拿到令牌：{body}"
    return True, f"200，令牌 {token}"

def check_not_found(port):
    """未知路径 → 404（别把未知路径盲转给主机）。"""
    status, body, _ = request(port, "GET", "/nope")
    if status != 404:
        return False, f"状态 {status}（期望 404）"
    if json.loads(body).get("error") != "not found":
        return False, f"body 不对：{body}"
    return True, "404，未知路径不误转"


def check_keep_alive(port):
    """keep-alive：一条连接上连发多个请求，每个都拿到自己的应答。

    这条是票 #67 的正题——请求处理若沿用旧请求行，同一个请求会被处理两次，
    客户端于是读到多出来的应答（看起来像“服务端行为不稳”）。
    """
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        seen = []
        for index in range(3):
            path = f"/api/keepalive?seq={index}"
            conn.request("GET", path, headers={"Cookie": SESSION_COOKIE})
            response = conn.getresponse()
            payload = json.loads(response.read().decode())
            seen.append((response.status, payload.get("path")))
        alive = conn.sock is not None
    finally:
        conn.close()
    expected = [(200, f"/api/keepalive?seq={index}") for index in range(3)]
    if seen != expected:
        return False, f"应答错位：{seen}（期望 {expected}）"
    if not alive:
        return False, "连接被服务端提前关闭（keep-alive 没生效）"
    return True, "一条连接 3 个请求各自对上，连接保持"


def check_websocket(port, path="/api/remote.mux"):
    """WS 升级：101 + 正确的 Sec-WebSocket-Accept。

    只断言握手：帧回声是既有行为，不在本次修复范围内（见票 #67）。
    """
    key = base64.b64encode(os.urandom(16)).decode()
    raw = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
        sock.sendall(raw.encode())
        sock.settimeout(5)
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
    head = data.decode("latin-1")
    if not head.startswith("HTTP/1.1 101"):
        return False, f"握手不是 101：{head.splitlines()[:1]}"
    expected = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
    if expected not in head:
        return False, "Sec-WebSocket-Accept 不对"
    return True, "101 握手，Sec-WebSocket-Accept 正确"


#: 断言清单：名字 → 检查函数。
CHECKS = (
    ("页面骨架 / 注入行", check_index),
    ("插件 combo bundle", check_plugins),
    ("GET /api/ 回显", check_api_get),
    ("POST /api/ 回显", check_api_post),
    ("未知路径 404", check_not_found),
    ("keep-alive 多请求", check_keep_alive),
    ("WS 握手", check_websocket),
    ("直连令牌 ws-token", check_ws_token),
    (
        "WS 握手（直连前缀）",
        lambda port: check_websocket(port, "/__dsh_ws/mock-ws-token/api/remote.mux"),
    ),
)


def main(argv):
    """跑完整清单；返回进程退出码（全过 0，有失败 1）。"""
    port = int(argv[1]) if len(argv) > 1 else 0
    with Lane(port) as lane:
        print(f"假 lane 监听 127.0.0.1:{lane.port}")
        failed = 0
        for name, check in CHECKS:
            try:
                ok, detail = check(lane.port)
            except Exception as error:  # noqa: BLE001 - 自检要把异常当失败报出来
                ok, detail = False, f"异常：{error!r}"
            print(f"  [{'通过' if ok else '失败'}] {name}：{detail}")
            if not ok:
                failed += 1
    print(f"合计 {len(CHECKS)} 项，失败 {failed} 项")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
