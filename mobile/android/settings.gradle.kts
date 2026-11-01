// Android 壳工程设置（DSH Desktop Plus 移动端 · issue #60）。
// 独立工程：与桌面端构建互不牵连，移动产物单独出。
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "dsh-mobile-android"

include(":app")
