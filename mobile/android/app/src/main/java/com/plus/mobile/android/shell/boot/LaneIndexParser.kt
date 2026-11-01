package com.plus.mobile.android.shell.boot

/**
 * 从 lane 渲染好的 index.html 里解析出注入行。
 *
 * 为什么解析 HTML 而不是让页面直接加载 lane 的 index.html：
 *  - 页面文档必须是**壳内自带的 upstream dist**（spec #55：内置 UI 产物直接耦合 upstream web 构建）；
 *  - 但 boot graph（`__DSH_BOOT__`）与插件 bundle URL 是**主机侧运行时才有**的东西，
 *    只能从 lane 渲染结果里取（docs/agents/research/upstream-bundle-and-plugin-injection.md §2.4）。
 *
 * 解析规则（与上游渲染规则对齐，见 `upstream/packages/host/webserver/src/injections.ts`）：
 *  - `<script>` 无 src        → 内联行（facade / 全局赋值 / lane 补丁）
 *  - `<script src=…>` 无 type → 外部脚本行（上游 script-src 行不带 type；页面自己的入口模块带 `type=module`，被排除）
 *  - `<link rel=preload as=script>` → 预载提示行
 *  - 含 `__DSH_BOOT_READY__` 的行不取：就绪信号由壳自己掌管（见 boot.js 的 deferred）。
 */
class LaneIndexParser {

    /** 解析入口。返回按文档顺序排列的注入行。 */
    fun parse(html: String): List<InjectionRow> {
        val rows = ArrayList<InjectionRow>()
        var cursor = 0
        while (cursor < html.length) {
            val open = html.indexOf('<', cursor)
            if (open < 0) break
            val tagEnd = html.indexOf('>', open)
            if (tagEnd < 0) break
            val tag = html.substring(open, tagEnd + 1)
            when (tagName(tag)) {
                "script" -> {
                    val attributes = attributesOf(tag)
                    val body = scriptBody(html, tagEnd + 1)
                    cursor = body.endIndex
                    val src = attributes["src"]
                    when {
                        src != null && attributes["type"] == null ->
                            rows.add(InjectionRow.ScriptSrc(decodeEntities(src)))

                        body.text.isNotBlank() && !body.text.contains(READY_MARK) ->
                            rows.add(InjectionRow.Script(body.text))
                    }
                }

                "link" -> {
                    val attributes = attributesOf(tag)
                    if (attributes["rel"].equals("preload", ignoreCase = true) &&
                        attributes["as"].equals("script", ignoreCase = true)
                    ) {
                        attributes["href"]?.let { rows.add(InjectionRow.ScriptPreload(decodeEntities(it))) }
                    }
                    cursor = tagEnd + 1
                }

                else -> cursor = tagEnd + 1
            }
        }
        return rows
    }

    private data class ScriptBody(val text: String, val endIndex: Int)

    private fun scriptBody(html: String, from: Int): ScriptBody {
        val close = html.indexOf("</script>", from, ignoreCase = true)
        if (close < 0) return ScriptBody(html.substring(from), html.length)
        return ScriptBody(html.substring(from, close), close + "</script>".length)
    }

    private fun tagName(tag: String): String {
        val start = 1
        var end = start
        while (end < tag.length && !tag[end].isWhitespace() && tag[end] != '>' && tag[end] != '/') end++
        return tag.substring(start, end).lowercase()
    }

    private fun attributesOf(tag: String): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        val pattern = Regex("([A-Za-z_:][-A-Za-z0-9_:.]*)\\s*=\\s*\"([^\"]*)\"")
        pattern.findAll(tag).forEach { match ->
            result[match.groupValues[1].lowercase()] = match.groupValues[2]
        }
        return result
    }

    /** HTML 实体解码：上游渲染 script-src 时把 `&` 转义成 `&amp;`，取回时必须还原。 */
    private fun decodeEntities(value: String): String = value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")

    private companion object {
        /** 上游就绪行：`(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()`。 */
        const val READY_MARK = "__DSH_BOOT_READY__"
    }
}
