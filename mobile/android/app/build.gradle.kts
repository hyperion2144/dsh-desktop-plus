plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ── 版本与更新源 ────────────────────────────────────────────────────────────────
//
// 版本号跟随桌面 plus 版本（发版时同步，见 spec #55「更新与发版」）。
// 安装版本号（versionCode）由 plus 版本**确定性推导**——与 node 侧事实源
// `scripts/plus/mobile-version.mjs`、运行时端口 `shell/update/MobileVersion.kt`
// 同一套公式。三处必须一致：`app/src/test/java/com/plus/mobile/android/shell/update/`
// 下的单测会拿 BuildConfig.VERSION_CODE 与 Kotlin 端口的推导结果对拍，
// 改一处必须改三处（跨实现测试向量见该测试文件）。
//
// 可用属性覆盖（验证用）：
//   -PplusVersion=0.2.2-alpha.2.plus.2               换 plus 版本（版本号随之推导）
//   -PplusVersionCode=20200202                       直接指定安装版本号
//   -PupdateFeedUrl=http://10.0.2.2:8765/nightly-android.yml   换更新源（本地验证）

/** 移动端安装版本号推导（与 scripts/plus/mobile-version.mjs 同一套公式）。 */
fun mobileVersionCode(version: String): Int {
    val labels = listOf("alpha", "beta", "rc")
    val raw = version.removePrefix("v")
    require(!raw.contains('+')) { "plus 版本不能带构建元数据：$version" }
    val plusMatch = Regex("""\.plus\.(\d+)$""").find(raw)
    require(plusMatch == null || plusMatch.groupValues[1].toInt() >= 1) { "plus 计数至少为 1：$version" }
    val plus = plusMatch?.groupValues?.get(1)?.toIntOrNull() ?: 0
    val base = if (plusMatch == null) raw else raw.substring(0, plusMatch.range.first)
    val dash = base.indexOf('-')
    val core = if (dash == -1) base else base.substring(0, dash)
    val parts = core.split('.')
    require(parts.size == 3) { "plus 版本格式不对：$version" }
    val major = parts[0].toInt()
    val minor = parts[1].toInt()
    val patch = parts[2].toInt()
    val level = if (dash == -1) {
        999
    } else {
        val prerelease = base.substring(dash + 1).split('.')
        require(prerelease.size == 2) { "预发布段格式不对：$version" }
        val rank = labels.indexOf(prerelease[0])
        require(rank >= 0) { "未知的预发布标签：${prerelease[0]}" }
        rank * 100 + prerelease[1].toInt()
    }
    return major * 100_000_000 + minor * 10_000_000 + patch * 100_000 + level * 100 + plus
}

/** plus 版本（移动端与桌面同一条版本线）。 */
val plusVersion: String =
    (project.findProperty("plusVersion") as String?) ?: "0.2.2-alpha.2.plus.1"

/** 安装版本号：由 plus 版本推导（或用属性直接指定）。 */
val appVersionCode: Int =
    (project.findProperty("plusVersionCode") as String?)?.toIntOrNull() ?: mobileVersionCode(plusVersion)

/** 更新源（移动端 channel 元数据）。 */
val updateFeedUrl: String =
    (project.findProperty("updateFeedUrl") as String?)
        ?: "https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/nightly-android.yml"

// ── 签名材料 ──────────────────────────────────────────────────────────────────
//
// 覆盖安装靠**同一把钥匙**：CI 每次临时生成 keystore，新版签名与旧版不一致，
// 系统直接拒装（INSTALL_FAILED_UPDATE_INCOMPATIBLE），用户的升级链就断了。
// 所以发版流水线用一把固定的 upload keystore：CI secrets 优先，回退仓库里那把
// （风险与更换流程见 `mobile/android/keystore/README.md`）。
//
// 取值顺序（先到先得，空串当缺省——CI 里没配的 secret 就是空串）：
//   1. Gradle 属性 -PplusKeystorePath / -PplusKeystorePassword / -PplusKeyAlias / -PplusKeyPassword
//   2. 环境变量 ANDROID_KEYSTORE_PATH / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD
//      （CI 走这条：secrets 用环境变量传，不进命令行参数，也不出现在构建日志里）
//   3. 仓库里的专用 upload keystore（keystore/upload.keystore）与其公开口令
//
// 仓库兜底只为**签名身份稳定**（同一把钥匙 → 新版能覆盖安装旧版），不提供机密性：
// 仓库是公开的，口令就写在旁边。要换成私钥，按 keystore/README.md 的流程换。
/** 取一个非空的 Gradle 属性。 */
fun plusProperty(name: String): String? = (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }

/** 取一个非空的环境变量。 */
fun plusEnvironment(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

/** 仓库兜底 keystore 的别名（公开值：兜底 keystore 本身就在仓库里）。 */
val DEFAULT_UPLOAD_ALIAS = "plus-upload"

/** 仓库兜底 keystore 的口令（公开值：兜底 keystore 本身就在仓库里）。 */
val DEFAULT_UPLOAD_PASSWORD = "dsh-plus-upload"

/** keystore 文件路径（相对路径按工程根解析，绝对路径原样用）。 */
val plusKeystorePath: String =
    plusProperty("plusKeystorePath")
        ?: plusEnvironment("ANDROID_KEYSTORE_PATH")
        ?: rootProject.file("keystore/upload.keystore").absolutePath

/** keystore 口令。 */
val plusKeystorePassword: String =
    plusProperty("plusKeystorePassword")
        ?: plusEnvironment("ANDROID_KEYSTORE_PASSWORD")
        ?: DEFAULT_UPLOAD_PASSWORD

/** 密钥别名。 */
val plusKeyAlias: String =
    plusProperty("plusKeyAlias")
        ?: plusEnvironment("ANDROID_KEY_ALIAS")
        ?: DEFAULT_UPLOAD_ALIAS

/** 密钥口令（默认与 keystore 口令相同）。 */
val plusKeyPassword: String =
    plusProperty("plusKeyPassword")
        ?: plusEnvironment("ANDROID_KEY_PASSWORD")
        ?: plusKeystorePassword

/** keystore 文件（不存在时 release 变体只出未签名包，发版流水线会当场失败）。 */
val uploadKeystoreFile: File = rootProject.file(plusKeystorePath)
android {
    namespace = "com.plus.mobile.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.hyperion2144.dsh.plusm"
        minSdk = 29
        // targetSdk 锁 36：Android 17（targetSdk 37）起强制 ACCESS_LOCAL_NETWORK，
        // 且 WebView 继承宿主 App 的权限状态 → 局域网 lane 访问会在网络栈层直接不通。
        // 依据 docs/agents/research/webview-shell-constraints.md（wayfinder #49）。
        targetSdk = 36
        versionCode = appVersionCode
        // 版本号跟随桌面 plus 版本（发版时同步，见 spec #55「更新与发版」）。
        versionName = plusVersion
        // 更新源（可被本地 override 换掉，见文件头的属性说明）。
        buildConfigField("String", "UPDATE_FEED_URL", "\"$updateFeedUrl\"")
    }

    // ── 签名 ────────────────────────────────────────────────────────────────────
    //
    // 只有 keystore 文件真的在，才建签名配置：文件不在时 release 变体出的是
    // 未签名包（app-release-unsigned.apk），发版流水线的产物检查会当场失败，
    // 不会静默发一个装不上的包。
    signingConfigs {
        if (uploadKeystoreFile.exists()) {
            create("upload") {
                storeFile = uploadKeystoreFile
                storePassword = plusKeystorePassword
                keyAlias = plusKeyAlias
                keyPassword = plusKeyPassword
            }
        }
    }

    buildTypes {
        release {
            // 签名配置见上面的 signingConfigs：keystore 不在时这里是 null，
            // release 变体只出未签名包（发版流水线的产物检查会当场失败，
            // 不会静默发一个装不上的包）。
            signingConfig = signingConfigs.findByName("upload")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    // 壳的单测在 JVM 上跑：`android.util.Log` 这类平台调用在单测里没有实现，
    // 统一按「返回默认值」处理（否则任何走到日志的用例都会抛 "Method not mocked"）。
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    // FileProvider：把私有目录里的 apk 以 content:// 交给系统安装器（更新提醒用）。
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // 平台加密存储（Keystore）：主机条目的凭证（会话 cookie / deviceId / 令牌）只落这里。
    // 依据 spec #55「凭证与安全」；选 1.1.0-alpha06 而不是 1.0.0：后者在 Android 12+
    // 的 Keystore 密钥轮换路径上有已知缺陷（EncryptedSharedPreferences 读回抛异常）。
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // 生物识别：BiometricPrompt 的 AndroidX 封装（指纹 / 面容 + 设备凭据回退）。
    implementation("androidx.biometric:biometric:1.1.0")
    // 二维码扫描：自实现相机 + 解码成本很高，用社区事实标准（ZXing 官方维护的 Android 封装）。
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    // 配对链接解析的 JVM 单元测试（纯函数，不依赖 Android）。
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.google.zxing:core:3.5.3")
}
