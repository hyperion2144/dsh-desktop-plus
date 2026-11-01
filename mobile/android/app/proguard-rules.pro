# 壳内没有反射式依赖，保留默认规则即可。
# 壳桥（window.dshMobile）的方法经 @JavascriptInterface 暴露，R8 需保留其签名。
-keepclassmembers class com.plus.mobile.android.shell.bridge.** {
    @android.webkit.JavascriptInterface <methods>;
}
