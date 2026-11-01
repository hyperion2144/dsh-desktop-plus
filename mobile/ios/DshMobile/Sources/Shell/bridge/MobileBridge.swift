import Foundation
import WebKit

/// `window.dshMobile` 壳桥的宿主契约。
///
/// 页面内的主机切换器（移动端专属 upstream 补丁）只认这三个方法，不碰壳的其它实现。
@MainActor
protocol MobileBridgeHost: AnyObject {
    /// 切换到指定主机：壳改代理目标 + 重载页面。
    func switchHost(id: String) -> Bool
}

/// `window.dshMobile` 壳桥。
///
/// 契约（spec #55「UI」与票 #60）：
/// - `dshMobile.hosts()` → 主机列表（不含凭证）
/// - `dshMobile.current()` → 当前主机
/// - `dshMobile.switchHost(id)` → 壳切代理目标并重载页面
///
/// 凭证（会话 cookie）**永不出壳**（spec #55「凭证与安全」第 17 条）。
///
/// iOS 侧的实现与 Android 同构但机制不同：`webkit.messageHandlers` 是**单向**的（没有返回值），
/// 所以壳在每次装载页面前把主机快照**内联**进页面脚本（`BridgeScript.snapshotScript`），
/// `hosts()` / `current()` 直接读快照；`switchHost(id)` 发消息给壳并返回「有没有这台主机」。
final class MobileBridge: NSObject, WKScriptMessageHandler {
    private let host: MobileBridgeHost

    init(host: MobileBridgeHost) {
        self.host = host
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let method = payload["method"] as? String else { return }
        switch method {
        case "switchHost":
            guard let id = payload["id"] as? String else { return }
            _ = host.switchHost(id: id)
        default:
            break
        }
    }
}

/// 壳桥脚本的生成：把主机快照内联进页面。
enum BridgeScript {
    /// 生成 `window.dshMobile` 的定义脚本（document-start 注入）。
    ///
    /// 快照里只有主机名与 origin，**没有凭证**：页面拿不到会话 cookie。
    static func snapshotScript(hosts: [HostEntry], current: HostEntry?) -> String {
        let hostList: [[String: Any]] = hosts.map { host in
            [
                "id": host.id,
                "label": host.displayName,
                "origin": host.laneOrigin,
                "current": host.id == current?.id,
            ]
        }
        let currentObject: [String: Any] = current.map { host in
            [
                "id": host.id,
                "label": host.displayName,
                "origin": host.laneOrigin,
            ]
        } ?? [:]
        let listJson = json(hostList)
        let currentJson = json(currentObject)
        return """
        (function () {
          'use strict';
          var g = globalThis;
          var HOSTS = \(listJson);
          var CURRENT = \(currentJson);
          g.dshMobile = {
            hosts: function () { return JSON.stringify(HOSTS); },
            current: function () { return JSON.stringify(CURRENT); },
            switchHost: function (id) {
              var known = HOSTS.some(function (host) { return host.id === id; });
              if (!known) return false;
              var handler = g.webkit && g.webkit.messageHandlers && g.webkit.messageHandlers.dshMobile;
              if (!handler) return false;
              handler.postMessage({ method: 'switchHost', id: id });
              return true;
            }
          };
        })();
        """
    }

    private static func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return text
    }
}
