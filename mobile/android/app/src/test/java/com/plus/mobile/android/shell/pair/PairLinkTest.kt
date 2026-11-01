package com.plus.mobile.android.shell.pair

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 配对链接解析的单元测试。
 *
 * 解析是纯函数（不碰 Android API），因此能在 JVM 上直接验；
 * 二维码那一例用 ZXing 自己编码再解码，证明「扫码拿到的东西」与「粘贴链接」是同一条路径。
 */
class PairLinkTest {

    @Test
    fun `桌面端形态的链接解析出令牌与地址`() {
        val link = PairLink.parse("http://192.168.3.90:3093/pair?token=4f8a2c1d")
        assertNotNull(link)
        assertEquals("4f8a2c1d", link!!.token)
        assertEquals(listOf("http://192.168.3.90:3093"), link.candidates)
        assertEquals("http://192.168.3.90:3093", link.origin)
    }

    @Test
    fun `隧道形态的链接保留协议`() {
        val link = PairLink.parse("https://dsh-4f2e.cpolar.io/pair?token=t1")
        assertNotNull(link)
        assertEquals(listOf("https://dsh-4f2e.cpolar.io"), link!!.candidates)
    }

    @Test
    fun `移动端形态的链接解析出候选列表`() {
        val link = PairLink.parse(
            "dsh-mobile://pair?token=abc123&base=192.168.3.90:3093,mutsu-mbp.local:3093",
        )
        assertNotNull(link)
        assertEquals("abc123", link!!.token)
        assertEquals(
            listOf("http://192.168.3.90:3093", "http://mutsu-mbp.local:3093"),
            link.candidates,
        )
    }

    @Test
    fun `二维码解码出来的文本同样能解析`() {
        val text = "http://192.168.3.90:3093/pair?token=qr-token-42"
        val decoded = decodeQr(text)
        assertEquals(text, decoded)
        val link = PairLink.parse(decoded)
        assertNotNull(link)
        assertEquals("qr-token-42", link!!.token)
        assertEquals(listOf("http://192.168.3.90:3093"), link.candidates)
    }

    @Test
    fun `没有令牌、不是配对路径、空串都解析失败`() {
        assertNull(PairLink.parse(""))
        assertNull(PairLink.parse("http://192.168.3.90:3093/index.html"))
        assertNull(PairLink.parse("http://192.168.3.90:3093/pair"))
        assertNull(PairLink.parse("随便一段文字"))
    }

    @Test
    fun `http 形态的链接并入 base 候选列表（local 主机名与多网卡 IP 混合）`() {
        // 桌面端 buildHttpPairLink 会把候选列表（.local + 多网卡 IP）以 base 参数随链接下发。
        val link = PairLink.parse(
            "http://192.168.3.90:3093/pair?token=abc" +
                "&base=192.168.3.90%3A3093,mutsu-mbp.local%3A3093,10.0.0.5%3A3093",
        )
        assertNotNull(link)
        assertEquals("abc", link!!.token)
        assertEquals(
            listOf(
                "http://192.168.3.90:3093",
                "http://mutsu-mbp.local:3093",
                "http://10.0.0.5:3093",
            ),
            link.candidates,
        )
    }

    @Test
    fun `http 形态的链接：base 列表里没有本机 origin 时把它补在最前`() {
        val link = PairLink.parse(
            "http://192.168.3.90:3093/pair?token=abc&base=mutsu-mbp.local%3A3093",
        )
        assertNotNull(link)
        assertEquals(
            listOf("http://192.168.3.90:3093", "http://mutsu-mbp.local:3093"),
            link!!.candidates,
        )
    }

    /** 用 ZXing 编码再解码一段文本（模拟「相机读到二维码」）。 */
    private fun decodeQr(text: String): String {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 320, 320)
        val pixels = IntArray(matrix.width * matrix.height)
        for (y in 0 until matrix.height) {
            for (x in 0 until matrix.width) {
                pixels[y * matrix.width + x] = if (matrix.get(x, y)) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
            }
        }
        val source = RGBLuminanceSource(matrix.width, matrix.height, pixels)
        val bitmap = BinaryBitmap(HybridBinarizer(source))
        return MultiFormatReader().decode(bitmap).text
    }
}
