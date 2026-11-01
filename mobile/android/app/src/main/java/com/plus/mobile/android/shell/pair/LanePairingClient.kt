package com.plus.mobile.android.shell.pair

import com.plus.mobile.android.shell.ShellSettings
import com.plus.mobile.android.shell.net.LaneHttpClient
import com.plus.mobile.android.shell.net.LaneRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder

/**
 * lane 控制面的客户端：配对、续期、隧道地址可达性探测。
 *
 * ## 契约（权威来源：packages/plus/desktop-remote-access/lib/index.mjs 的 routePairing）
 *
 * | 端点 | 方法 | 请求 | 成功 | 失败 |
 * |---|---|---|---|---|
 * | `/__dsh-mobile/api/pair/accept` | POST | `{token, name}` | 200 + `Set-Cookie: dsh_mobile_session=…` + `{deviceId}` | 403 `invalid-token` |
 * | `/__dsh-mobile/api/pair/renew` | POST | `{deviceId}` | 200 + `Set-Cookie` | 403 `unknown-device` |
 * | `/__dsh-mobile/api/pair/probe` | GET | `?url=…` | 200 `{ok, status, reason}` | 401 未配对 |
 * | `/__dsh-mobile/api/pair/ws-token` | POST | — | 200 `{token}` | 401 未配对 |
 *
 * 会话 cookie 由服务端用 `Set-Cookie` 下发（HttpOnly）；壳把它收进加密存储，
 * **不写进 WebView 的 CookieManager**（spec #55「凭证与安全」）。
 */
open class LanePairingClient(private val client: LaneHttpClient) {

    /** 接受配对：把链接里的一次性令牌换成设备 ID + 会话 cookie。 */
    open suspend fun accept(origin: String, token: String, deviceName: String): AcceptOutcome =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("token", token)
                .put("name", deviceName)
                .toString()
                .toByteArray(Charsets.UTF_8)
            val response = try {
                client.open(
                    LaneRequest(
                        url = endpoint(origin, "/api/pair/accept"),
                        method = "POST",
                        headers = mapOf("Content-Type" to "application/json"),
                        body = body,
                    ),
                )
            } catch (error: Exception) {
                return@withContext AcceptOutcome.Unreachable(error.message ?: "主机不可达")
            }
            response.use {
                val text = it.stream.readBytes().decodeToString()
                when {
                    it.status == 200 -> {
                        val cookie = sessionCookieOf(it.headers)
                        val deviceId = runCatching { JSONObject(text).optString("deviceId") }.getOrDefault("")
                        if (cookie.isNullOrEmpty() || deviceId.isEmpty()) {
                            AcceptOutcome.Rejected(PairFailure.NO_SESSION)
                        } else {
                            AcceptOutcome.Accepted(deviceId, cookie)
                        }
                    }
                    it.status == 403 -> AcceptOutcome.Rejected(PairFailure.INVALID_TOKEN)
                    else -> AcceptOutcome.Rejected(PairFailure.UNEXPECTED)
                }
            }
        }

    /** 续期：凭 deviceId 取回会话 cookie（cookie 丢失 / 被桌面端轮换时的恢复通道）。 */
    suspend fun renew(origin: String, deviceId: String): RenewOutcome = withContext(Dispatchers.IO) {
        val body = JSONObject().put("deviceId", deviceId).toString().toByteArray(Charsets.UTF_8)
        val response = try {
            client.open(
                LaneRequest(
                    url = endpoint(origin, "/api/pair/renew"),
                    method = "POST",
                    headers = mapOf("Content-Type" to "application/json"),
                    body = body,
                ),
            )
        } catch (error: Exception) {
            return@withContext RenewOutcome.Unreachable(error.message ?: "主机不可达")
        }
        response.use {
            when {
                it.status == 200 -> {
                    val cookie = sessionCookieOf(it.headers)
                    if (cookie.isNullOrEmpty()) {
                        RenewOutcome.Rejected(PairFailure.NO_SESSION)
                    } else {
                        RenewOutcome.Renewed(cookie)
                    }
                }
                it.status == 403 -> RenewOutcome.Rejected(PairFailure.DEVICE_REMOVED)
                else -> RenewOutcome.Rejected(PairFailure.UNEXPECTED)
            }
        }
    }

    /**
     * 取直连令牌：把会话 cookie 换成一个可以放进 URL 的签名令牌。
     *
     * WS 无法自定义请求头，而页面 origin（壳内资产）与 lane 是**跨站**：`SameSite=Lax`
     * 的会话 cookie 在跨站握手时根本不会带（改 None 又必须 Secure，lane 是明文）。
     * 令牌只用于建立数据面连接：lane 验签后还原会话值，沿用既有设备判定；
     * 不具备 RPC 权限，随会话轮换失效。
     *
     * 返回三种结果（见 [WsTokenOutcome]）：401/403 = 会话失效，必须进降级链；
     * 只有网络/地址失败才是「换候选地址」。两者合并会让「会话过期」表现成「主机离线」。
     */
    suspend fun wsToken(origin: String, cookie: String?): WsTokenOutcome = withContext(Dispatchers.IO) {
        val response = try {
            client.open(
                LaneRequest(
                    url = endpoint(origin, "/api/pair/ws-token"),
                    method = "POST",
                    cookie = cookie,
                    headers = mapOf("Content-Type" to "application/json"),
                    body = "{}".toByteArray(Charsets.UTF_8),
                ),
            )
        } catch (error: Exception) {
            return@withContext WsTokenOutcome.Unreachable
        }
        response.use {
            if (it.status == 401 || it.status == 403) {
                // 门禁拒绝：会话失效 / 设备被移除。交给降级链，绝不能当成「主机离线」。
                return@use WsTokenOutcome.Gated
            }
            if (it.status != 200) {
                return@use WsTokenOutcome.Unreachable
            }
            val text = it.stream.readBytes().decodeToString()
            val token = runCatching { JSONObject(text).optString("token") }.getOrDefault("")
            if (token.isEmpty()) WsTokenOutcome.Unreachable else WsTokenOutcome.Token(token)
        }
    }

    /**
     * 隧道地址可达性探测：问 lane「这个隧道地址的配对入口通不通」。
     *
     * 探测请求要带会话 cookie（lane 的作用域两级：属主或已配对设备才能探测）。
     */
    suspend fun probe(origin: String, tunnelUrl: String, cookie: String?): ProbeOutcome =
        withContext(Dispatchers.IO) {
            val encoded = URLEncoder.encode(tunnelUrl, "UTF-8")
            val response = try {
                client.open(
                    LaneRequest(
                        url = endpoint(origin, "/api/pair/probe") + "?url=" + encoded,
                        method = "GET",
                        cookie = cookie,
                    ),
                )
            } catch (error: Exception) {
                return@withContext ProbeOutcome.Unreachable(error.message ?: "主机不可达")
            }
            response.use {
                if (it.status != 200) {
                    return@use ProbeOutcome.Rejected
                }
                val text = it.stream.readBytes().decodeToString()
                val json = runCatching { JSONObject(text) }.getOrNull()
                ProbeOutcome.Verdict(
                    reachable = json?.optBoolean("ok", false) ?: false,
                    reason = json?.optString("reason").orEmpty(),
                )
            }
        }

    /**
     * 从响应头里取出会话 cookie。
     *
     * 取的是**整对** `dsh_mobile_session=<值>`：出站时壳直接把它当 `Cookie` 头附加，
     * 而 lane 的门禁按 `name=value` 解析（见 proxy.mjs 的 parseCookies）。
     */
    private fun sessionCookieOf(headers: Map<String, String>): String? {
        val line = headers.entries.firstOrNull { it.key.equals("set-cookie", ignoreCase = true) }?.value
            ?: return null
        val match = COOKIE_PATTERN.find(line) ?: return null
        return match.groupValues.getOrNull(1)?.takeIf { it.isNotBlank() }
    }

    private fun endpoint(origin: String, path: String): String =
        origin.trimEnd('/') + ShellSettings.LANE_PREFIX + path

    /** 接受配对的结果。 */
    sealed interface AcceptOutcome {
        /** 成功：设备 ID + 会话 cookie。 */
        data class Accepted(val deviceId: String, val cookie: String) : AcceptOutcome

        /** 被拒绝（令牌无效 / 没给会话）。 */
        data class Rejected(val failure: PairFailure) : AcceptOutcome

        /** 主机不可达。 */
        data class Unreachable(val detail: String) : AcceptOutcome
    }

    /** 续期的结果。 */
    sealed interface RenewOutcome {
        /** 成功：新的会话 cookie。 */
        data class Renewed(val cookie: String) : RenewOutcome

        /** 被拒绝（设备已被移除 / 没给会话）。 */
        data class Rejected(val failure: PairFailure) : RenewOutcome

        /** 主机不可达。 */
        data class Unreachable(val detail: String) : RenewOutcome
    }

    /** 隧道地址探测的结果。 */
    sealed interface ProbeOutcome {
        /** 探测有结论。 */
        data class Verdict(val reachable: Boolean, val reason: String) : ProbeOutcome

        /** 探测本身被拒绝（未配对等）。 */
        data object Rejected : ProbeOutcome

        /** 主机不可达。 */
        data class Unreachable(val detail: String) : ProbeOutcome
    }

    private companion object {
        /** 从 `Set-Cookie` 里取出会话 cookie 这一对（名字 + 值）。 */
        val COOKIE_PATTERN = Regex("(dsh_mobile_session=[^;,\\s]+)")
    }
}
