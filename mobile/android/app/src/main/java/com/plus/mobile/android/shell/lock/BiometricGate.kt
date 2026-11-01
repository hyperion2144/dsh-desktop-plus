package com.plus.mobile.android.shell.lock

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * 生物识别验证的门。
 *
 * ## 为什么是 `BIOMETRIC_STRONG or DEVICE_CREDENTIAL`
 *
 * - `BIOMETRIC_STRONG`：指纹 / 面容等强生物特征；
 * - `DEVICE_CREDENTIAL`：设备 PIN / 图案 / 密码 —— **回退路径**。
 *
 * 允许 `DEVICE_CREDENTIAL` 之后，系统在生物识别不可用（没录入、硬件缺失、识别失败多次）时
 * 直接弹设备凭据界面，用户不会在「没有指纹的机器」上被挡死。
 * 注意：允许设备凭据时**不能**再设置负按钮（系统会自己提供）。
 */
class BiometricGate(private val activity: FragmentActivity) {

    /** 设备上是否还有可用的验证方式。 */
    fun available(): Boolean = when (
        BiometricManager.from(activity).canAuthenticate(ALLOWED_AUTHENTICATORS)
    ) {
        BiometricManager.BIOMETRIC_SUCCESS -> true
        else -> false
    }

    /**
     * 发起验证；结果回调到 [onResult]。
     *
     * @param onResult true = 通过；false = 失败或用户取消。
     */
    fun authenticate(title: String, subtitle: String, onResult: (Boolean) -> Unit) {
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onResult(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    onResult(false)
                }

                override fun onAuthenticationFailed() {
                    // 一次识别没通过：系统仍会继续提示，这里不结束流程。
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(ALLOWED_AUTHENTICATORS)
            .build()
        prompt.authenticate(info)
    }

    companion object {
        /** 强生物特征 + 设备凭据（PIN / 图案 / 密码）。 */
        const val ALLOWED_AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
    }
}
