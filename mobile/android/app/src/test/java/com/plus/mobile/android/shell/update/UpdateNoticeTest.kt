package com.plus.mobile.android.shell.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 更新提醒的语义（开关 / 拉黑版本 / 已提醒最高版本）。
 *
 * 语义复用桌面 update-notice 契约
 * （`packages/plus/desktop-plugin/contracts/updates.ts` 的 `UpdateNoticeState`）。
 */
class UpdateNoticeTest {

    private val current = "0.2.2-alpha.2.plus.1"
    private val newer = "0.2.2-alpha.2.plus.2"

    @Test
    fun `默认状态：总开关默认开（桌面契约同款）`() {
        assertTrue(UpdateNoticeState.default().enabled)
    }

    @Test
    fun `开关关着：什么都不做`() {
        val state = UpdateNoticeState.default().copy(enabled = false)
        assertEquals(
            NoticeDecision.DISABLED,
            UpdateNoticePolicy.decide(state, UpdateNoticeKind.SHELL, newer, current),
        )
    }

    @Test
    fun `不是更新的版本：不提醒`() {
        assertEquals(
            NoticeDecision.NOT_NEWER,
            UpdateNoticePolicy.decide(
                UpdateNoticeState.default(),
                UpdateNoticeKind.SHELL,
                current,
                newer,
            ),
        )
    }

    @Test
    fun `拉黑版本：键是 shell 加冒号加版本`() {
        val state = UpdateNoticePolicy.ignore(UpdateNoticeState.default(), UpdateNoticeKind.SHELL, newer)
        assertEquals(listOf("shell:$newer"), state.ignored)
        assertTrue(state.isIgnored(UpdateNoticeKind.SHELL, newer))
        assertEquals(
            NoticeDecision.IGNORED,
            UpdateNoticePolicy.decide(state, UpdateNoticeKind.SHELL, newer, current),
        )
        // 拉黑只针对这一个版本。
        assertEquals(
            NoticeDecision.NOTIFY,
            UpdateNoticePolicy.decide(state, UpdateNoticeKind.SHELL, "0.2.2-alpha.2.plus.3", current),
        )
    }

    @Test
    fun `已提醒最高版本：同一个版本不重复提醒`() {
        val state = UpdateNoticePolicy.markNotified(
            UpdateNoticeState.default(),
            UpdateNoticeKind.SHELL,
            newer,
        )
        assertEquals(newer, state.lastNotifiedVersion(UpdateNoticeKind.SHELL))
        assertEquals(
            NoticeDecision.ALREADY_NOTIFIED,
            UpdateNoticePolicy.decide(state, UpdateNoticeKind.SHELL, newer, current),
        )
        // 比已提醒版本更旧的也不再提醒。
        assertEquals(
            NoticeDecision.ALREADY_NOTIFIED,
            UpdateNoticePolicy.decide(state, UpdateNoticeKind.SHELL, current, "0.2.2-alpha.2.plus.0"),
        )
        // 更新的版本仍然要提醒。
        assertEquals(
            NoticeDecision.NOTIFY,
            UpdateNoticePolicy.decide(state, UpdateNoticeKind.SHELL, "0.2.2-alpha.2.plus.3", current),
        )
    }

    @Test
    fun `已提醒最高版本：只保留最高的那个`() {
        var state = UpdateNoticePolicy.markNotified(
            UpdateNoticeState.default(),
            UpdateNoticeKind.SHELL,
            "0.2.2-alpha.2.plus.3",
        )
        state = UpdateNoticePolicy.markNotified(state, UpdateNoticeKind.SHELL, newer)
        assertEquals("0.2.2-alpha.2.plus.3", state.lastNotifiedVersion(UpdateNoticeKind.SHELL))
    }

    @Test
    fun `清空拉黑列表：恢复全部提醒`() {
        var state = UpdateNoticePolicy.ignore(UpdateNoticeState.default(), UpdateNoticeKind.SHELL, newer)
        state = UpdateNoticePolicy.clearIgnored(state)
        assertTrue(state.ignored.isEmpty())
        assertEquals(
            NoticeDecision.NOTIFY,
            UpdateNoticePolicy.decide(state, UpdateNoticeKind.SHELL, newer, current),
        )
    }

    @Test
    fun `运行时那一路与壳那一路互不干扰`() {
        val state = UpdateNoticePolicy.ignore(
            UpdateNoticeState.default(),
            UpdateNoticeKind.RUNTIME,
            newer,
        )
        assertTrue(state.isIgnored(UpdateNoticeKind.RUNTIME, newer))
        assertFalse(state.isIgnored(UpdateNoticeKind.SHELL, newer))
        assertNull(state.lastNotifiedVersion(UpdateNoticeKind.RUNTIME))
    }
}
