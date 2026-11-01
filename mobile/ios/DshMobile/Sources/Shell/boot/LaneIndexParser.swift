import Foundation

/// 从 lane 渲染好的 index.html 里解析出注入行。
///
/// 为什么解析 HTML 而不是让页面直接加载 lane 的 index.html：
/// - 页面文档必须是**壳内自带的 upstream dist**（spec #55：内置 UI 产物直接耦合 upstream web 构建）；
/// - 但 boot graph（`__DSH_BOOT__`）与插件 bundle URL 是**主机侧运行时才有**的东西，
///   只能从 lane 渲染结果里取（`docs/agents/research/upstream-bundle-and-plugin-injection.md` §2.4）。
///
/// 解析规则（与上游渲染规则对齐，见 `upstream/packages/host/webserver/src/injections.ts`）：
/// - `<script>` 无 src → 内联行（facade / 全局赋值 / lane 补丁）
/// - `<script src=…>` 无 type → 外部脚本行（上游 script-src 行不带 type；
///   页面自己的入口模块带 `type=module`，被排除）
/// - `<link rel=preload as=script>` → 预载提示行
/// - 含 `__DSH_BOOT_READY__` 的行不取：就绪信号由壳自己掌管（见 boot.js 的 deferred）。
struct LaneIndexParser {
    /// 解析入口。返回按文档顺序排列的注入行。
    func parse(_ html: String) -> [InjectionRow] {
        var rows: [InjectionRow] = []
        var cursor = html.startIndex
        while cursor < html.endIndex {
            guard let open = html.range(of: "<", range: cursor..<html.endIndex) else { break }
            guard let tagEnd = html.range(of: ">", range: open.upperBound..<html.endIndex) else { break }
            let tag = String(html[open.lowerBound...tagEnd.lowerBound])
            switch tagName(tag) {
            case "script":
                let attributes = attributesOf(tag)
                let body = scriptBody(html, from: tagEnd.upperBound)
                cursor = body.endIndex
                if let src = attributes["src"], attributes["type"] == nil {
                    rows.append(.scriptSrc(src: decodeEntities(src)))
                } else if !body.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                          !body.text.contains(Self.readyMark) {
                    rows.append(.script(text: body.text))
                }
            case "link":
                let attributes = attributesOf(tag)
                if attributes["rel"]?.lowercased() == "preload",
                   attributes["as"]?.lowercased() == "script",
                   let href = attributes["href"] {
                    rows.append(.scriptPreload(src: decodeEntities(href)))
                }
                cursor = tagEnd.upperBound
            default:
                cursor = tagEnd.upperBound
            }
        }
        return rows
    }

    /// 一段脚本正文与其结束位置。
    private struct ScriptBody {
        let text: String
        let endIndex: String.Index
    }

    private func scriptBody(_ html: String, from index: String.Index) -> ScriptBody {
        let closeRange = html.range(of: "</script>", options: .caseInsensitive, range: index..<html.endIndex)
        guard let closeRange else {
            return ScriptBody(text: String(html[index...]), endIndex: html.endIndex)
        }
        return ScriptBody(text: String(html[index..<closeRange.lowerBound]), endIndex: closeRange.upperBound)
    }

    private func tagName(_ tag: String) -> String {
        var start = tag.startIndex
        if tag.hasPrefix("<") { start = tag.index(after: start) }
        var end = start
        while end < tag.endIndex {
            let character = tag[end]
            if character.isWhitespace || character == ">" || character == "/" { break }
            end = tag.index(after: end)
        }
        return String(tag[start..<end]).lowercased()
    }

    /// 取标签上的属性（键小写）。
    private func attributesOf(_ tag: String) -> [String: String] {
        var result: [String: String] = [:]
        let pattern = #"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return result }
        let range = NSRange(tag.startIndex..<tag.endIndex, in: tag)
        regex.enumerateMatches(in: tag, range: range) { match, _, _ in
            guard let match, match.numberOfRanges >= 3 else { return }
            guard let nameRange = Range(match.range(at: 1), in: tag) else { return }
            var value = ""
            if let doubleQuoted = Range(match.range(at: 3), in: tag) {
                value = String(tag[doubleQuoted])
            } else if let singleQuoted = Range(match.range(at: 4), in: tag) {
                value = String(tag[singleQuoted])
            }
            result[String(tag[nameRange]).lowercased()] = value
        }
        return result
    }

    /// HTML 实体解码：上游渲染 script-src 时把 `&` 转义成 `&amp;`，取回时必须还原。
    private func decodeEntities(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
    }

    /// 上游就绪行：`(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()`。
    private static let readyMark = "__DSH_BOOT_READY__"
}
