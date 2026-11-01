// 壳内引导脚本（内联进页面文档的 <head> 第一处）。
//
// 职责（对应票 #65「注入行四类」与「__DSH_TRANSPORT__ 钩子」）：
//   1. 造出上游客户端等待的就绪信号 `__DSH_BOOT_READY__`（上游 boot.ts 会 await 它）；
//   2. 向壳自有端点取当前主机的引导载荷（注入行 + 传输配置）；
//   3. 逐条执行注入行：模块加载 facade（`__ModuleLoader__`）、启动图全局（`__DSH_BOOT__`）、
//      bootstrap 的插件 combo（script-src）、以及其余主机侧注入；
//   4. 装 `__DSH_TRANSPORT__`：`streamBaseUrl` 指向直连 lane 的 WS base、`createWebSocket` 走同一 base、
//      `ownsHost: true`、`fetch` 走原生请求桥；
//   5. 注入行全部就位后 resolve 就绪信号，页面随后启动。
//
// 脚本本身是静态的：主机信息不内嵌，一律现取。换主机时页面 reload 即可拿到新载荷。
(function() {
  'use strict';

  var g = globalThis;
  var PAYLOAD_URL = '/__dsh-mobile-shell/boot.json';
  // 原生 WebSocket 构造器：lane 的「回环改写」补丁会替换全局 WebSocket，
  // 页面直连 lane 的 WS base 必须绕开那层改写（见 protectLaneSocket）。
  var nativeWebSocket = g.WebSocket;
  // 页面侧 WS 的 base：直连 lane 的地址（令牌在路径里）。
  var socketBase = '';

  function createDeferred() {
    if (typeof Promise.withResolvers === 'function') return Promise.withResolvers();
    var resolve;
    var reject;
    var promise = new Promise(function(onResolve, onReject) {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise: promise, resolve: resolve, reject: reject };
  }

  // 上游客户端入口会 await `__DSH_BOOT_READY__.promise`：就绪信号由壳掌管。
  if (!g.__DSH_BOOT_READY__) g.__DSH_BOOT_READY__ = createDeferred();
  var ready = g.__DSH_BOOT_READY__;

  function encodeBase64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  }

  function decodeBase64(text) {
    var binary = atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function scriptHost() {
    return g.document.head || g.document.documentElement;
  }

  function runInlineScript(text) {
    var element = g.document.createElement('script');
    element.textContent = text;
    scriptHost().appendChild(element);
  }

  function loadExternalScript(src) {
    return new Promise(function(resolve, reject) {
      var element = g.document.createElement('script');
      element.src = src;
      // 动态插入的脚本默认 async，会打乱注入行的先后顺序；关掉它保序。
      element.async = false;
      element.onload = function() { resolve(); };
      element.onerror = function() { reject(new Error('加载注入脚本失败：' + src)); };
      scriptHost().appendChild(element);
    });
  }

  function addPreloadHint(src) {
    var element = g.document.createElement('link');
    element.rel = 'preload';
    element.as = 'script';
    element.href = src;
    scriptHost().appendChild(element);
  }

  // 带请求体的请求交给壳原生发起：ArkWeb 的请求拦截拿不到 body（平台限制），
  // 一律走同源 fetch：壳内回环服务是真实 HTTP 服务，POST body 由 ArkWeb 网络栈完整送达，
  // 再由壳转发到 lane——与浏览器直接加载 lane 的路径完全等价（POST/SSE 都不例外）。
  // 早期版本把非流式请求交给 JSProxy 桥（dshMobile.request），但桥的结果回传
  // （ArkWeb GetJavaScriptResultV2）是主线程同步 binder：页面 RPC 一多，主线程就
  // 卡死在结果回传上（THREAD_BLOCK_6S，真机堆栈实锤）。桥只保留注册，不再作为通道。
  function shellFetch(input, init) {
    return g.fetch(input, init || {});
  }

  function installTransport(transport) {
    var existing = g.__DSH_TRANSPORT__ || {};
    var pageOrigin = String(transport.pageOrigin || '');
    // 页面侧 WS 的 base：直连 lane（令牌在路径里，凭证不经壳）。
    socketBase = String(transport.streamBaseUrl || '');
    g.__DSH_TRANSPORT__ = Object.assign({}, existing, {
      // 能力位：对齐桌面载体与 lane 远程页面先例，只开特权 UI 面（服务端设置），
      // 不放宽传输层鉴权（spec #55「服务端设置特权面」）。
      ownsHost: transport.ownsHost === true,
      // 网关 mux 与通用 WS 的 base：指向直连 lane 的地址（令牌在路径里）。
      streamBaseUrl: socketBase,
      createWebSocket: function(url) {
        var target = String(url);
        // 页面 origin 上的 WS 一律改写到 lane（页面 origin 的 URL 里没有令牌段）。
        if (pageOrigin && target.indexOf(pageOrigin) === 0) {
          target = socketBase + target.slice(pageOrigin.length);
        }
        return new g.WebSocket(target);
      },
      fetch: shellFetch
    });
  }

  // lane 的「回环改写」补丁会把 ws://127.0.0.1:<port>/… 也改写成 /_loopback/<port>/…——
  // 那套改写是为「页面由 lane 伺服」准备的，在壳里会劫持直连 lane 的 WS base。
  // 故在注入行生效后，把这个 base 从改写里摘出来（其余 URL 仍走 lane 的改写）。
  function protectLaneSocket() {
    var Current = g.WebSocket;
    if (!nativeWebSocket || !Current || Current === nativeWebSocket) return;
    if (!socketBase) return;
    var Wrapper = function(url, protocols) {
      var target = String(url);
      var useNative = target.indexOf(socketBase) === 0;
      var Ctor = useNative ? nativeWebSocket : Current;
      return protocols === undefined ? new Ctor(target) : new Ctor(target, protocols);
    };
    Wrapper.prototype = nativeWebSocket.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function(key) {
      Wrapper[key] = nativeWebSocket[key];
    });
    g.WebSocket = Wrapper;
  }

  function applyRows(rows) {
    var chain = Promise.resolve();
    (rows || []).forEach(function(row) {
      chain = chain.then(function() {
        if (row.kind === 'script') {
          runInlineScript(row.text);
          return undefined;
        }
        if (row.kind === 'script-src') return loadExternalScript(row.src);
        if (row.kind === 'script-preload') {
          addPreloadHint(row.src);
          return undefined;
        }
        return undefined;
      });
    });
    return chain;
  }

  g.fetch(PAYLOAD_URL, { credentials: 'omit' })
    .then(function(response) {
      if (!response.ok) throw new Error('引导载荷不可用：HTTP ' + response.status);
      return response.json();
    })
    .then(function(payload) {
      installTransport(payload.transport);
      return applyRows(payload.rows).then(function() {
        protectLaneSocket();
        ready.resolve();
      });
    })
    .catch(function(error) {
      ready.reject(error instanceof Error ? error : new Error(String(error)));
    });
})();
