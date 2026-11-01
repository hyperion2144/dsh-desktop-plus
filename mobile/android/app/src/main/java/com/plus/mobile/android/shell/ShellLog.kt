package com.plus.mobile.android.shell

import android.util.Log

/** 壳内统一日志出口。tag 固定，便于 `adb logcat -s DshMobile` 观察数据面。 */
object ShellLog {
    const val TAG = "DshMobile"

    fun info(message: String) {
        Log.i(TAG, message)
    }

    fun warn(message: String, error: Throwable? = null) {
        if (error == null) Log.w(TAG, message) else Log.w(TAG, message, error)
    }

    fun error(message: String, error: Throwable? = null) {
        if (error == null) Log.e(TAG, message) else Log.e(TAG, message, error)
    }
}
