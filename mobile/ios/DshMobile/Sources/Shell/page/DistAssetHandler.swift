import Foundation

/// 本地资产处理器：把页面 origin 下的请求映射到壳内自带的 upstream dist。
///
/// 命中规则：页面路径去掉前导 `/` 后就是 dist 里的相对路径（dist 根 = App bundle 里的 `dist/`）。
/// 未命中返回 nil → 由调用方回退到「转发到 lane」。
final class DistAssetHandler {
    /// dist 目录在 App bundle 里的位置；产物没同步进来时为 nil。
    private let root: URL?

    init(bundle: Bundle = .main) {
        root = bundle.url(forResource: ShellSettings.distDirectoryName, withExtension: nil)
        if root == nil {
            ShellLog.warn("壳内没有 dist 产物：页面无法加载。跑 tools/sync-web-dist.sh 同步移动变体产物。")
        }
    }

    /// 取页面路径对应的本地文件。
    func file(for path: String) -> URL? {
        guard let root else { return nil }
        let relative = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !relative.isEmpty, !relative.contains("..") else { return nil }
        let candidate = root.appendingPathComponent(relative)
        // 只允许落在 dist 目录内的文件。
        let rootPath = root.standardizedFileURL.path
        guard candidate.standardizedFileURL.path.hasPrefix(rootPath) else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            return nil
        }
        return candidate
    }

    /// 猜一个文件的 MIME 类型（页面资源用）。
    static func mimeType(of path: String) -> String {
        switch path.lowercased() {
        case let name where name.hasSuffix(".html"): return "text/html; charset=utf-8"
        case let name where name.hasSuffix(".js") || name.hasSuffix(".mjs"): return "application/javascript; charset=utf-8"
        case let name where name.hasSuffix(".css"): return "text/css; charset=utf-8"
        case let name where name.hasSuffix(".json") || name.hasSuffix(".webmanifest"): return "application/json; charset=utf-8"
        case let name where name.hasSuffix(".map"): return "application/json; charset=utf-8"
        case let name where name.hasSuffix(".svg"): return "image/svg+xml"
        case let name where name.hasSuffix(".png"): return "image/png"
        case let name where name.hasSuffix(".jpg") || name.hasSuffix(".jpeg"): return "image/jpeg"
        case let name where name.hasSuffix(".webp"): return "image/webp"
        case let name where name.hasSuffix(".ico"): return "image/x-icon"
        case let name where name.hasSuffix(".woff2"): return "font/woff2"
        case let name where name.hasSuffix(".woff"): return "font/woff"
        case let name where name.hasSuffix(".ttf"): return "font/ttf"
        default: return "application/octet-stream"
        }
    }
}
