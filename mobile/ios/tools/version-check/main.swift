import Foundation

// 壳版本号的**跨实现对拍**（code-review 修复 P1）。
//
// 为什么需要它：版本号规则有三份实现——node 侧事实源
// `scripts/plus/mobile-version.mjs`、Android 运行时 `MobileVersion.kt`、
// iOS 壳 `ShellVersion.swift`。规则（补零、构建元数据、字段上限、
// SemVer 比较）一旦只改一边，两端就会对同一个版本号给出不同答案，
// 而「更新提醒」这种场景**错了不会报错，只会永远不提示更新**。
//
// 因此这里跑的是**壳的真实源码**（不是复制品），向量取自共享文件
// `scripts/plus/test/mobile-version.vectors.json`——node / Kotlin / ArkTS
// 三端跑的是同一份向量，改了公式只改一处，四端立刻一起红。
//
// 用法：version-check <向量文件路径>

// MARK: - 断言

var failures: [String] = []
var passes = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        passes += 1
        print("PASS  \(name)\(detail.isEmpty ? "" : " — \(detail)")")
    } else {
        failures.append(name)
        print("FAIL  \(name)\(detail.isEmpty ? "" : " — \(detail)")")
    }
}

// MARK: - 读向量

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    print("用法：version-check <向量文件路径>")
    exit(2)
}
let vectorPath = arguments[1]
guard let data = FileManager.default.contents(atPath: vectorPath),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    print("读不到向量文件：\(vectorPath)")
    exit(2)
}
print("DSH iOS 壳版本号对拍")
print("向量：\(vectorPath)")

// MARK: - 解析向量

func string(_ dictionary: [String: Any], _ key: String) -> String? {
    dictionary[key] as? String
}

func optionalInt(_ dictionary: [String: Any], _ key: String) -> Int? {
    guard let value = dictionary[key] else { return nil }
    if value is NSNull { return nil }
    return value as? Int
}

func int(_ dictionary: [String: Any], _ key: String) -> Int? {
    dictionary[key] as? Int
}

// MARK: - 解析：字段与推导出的安装版本号

let parseVectors = root["parse"] as? [[String: Any]] ?? []
for expected in parseVectors {
    guard let version = string(expected, "version") else { continue }
    guard let parsed = try? ShellVersion.parse(version) else {
        check("解析 \(version)", false, "应当解析成功")
        continue
    }
    check("解析 \(version) 的 major", parsed.major == int(expected, "major"))
    check("解析 \(version) 的 minor", parsed.minor == int(expected, "minor"))
    check("解析 \(version) 的 patch", parsed.patch == int(expected, "patch"))
    check("解析 \(version) 的 plus 计数", parsed.plusCount == int(expected, "plus"))
    check("解析 \(version) 的 level", parsed.level == int(expected, "level"))
    check("解析 \(version) 的预发布标签", parsed.prereleaseLabel == string(expected, "label"))
    check("解析 \(version) 的标签序号", parsed.prerelease?.rank == optionalInt(expected, "rank"))
    check("解析 \(version) 的预发布序号", parsed.prerelease?.index == optionalInt(expected, "index"))
    check(
        "推导 \(version) 的 versionCode",
        parsed.versionCode == int(expected, "versionCode"),
        "\(parsed.versionCode)"
    )
    check(
        "推导 \(version) 的 CFBundleVersion",
        parsed.bundleVersion == string(expected, "bundleVersion"),
        parsed.bundleVersion
    )
}

// MARK: - 非法输入：一律拒绝

for invalid in root["invalid"] as? [String] ?? [] {
    check("拒绝非法版本 \(invalid)", ShellVersion(invalid) == nil)
    check("拒绝非法版本 \(invalid)（带原因）", (try? ShellVersion.parse(invalid)) == nil)
}

// MARK: - 比较：SemVer 优先级

for pair in root["compare"] as? [[String: Any]] ?? [] {
    guard let left = string(pair, "left"), let right = string(pair, "right"),
          let expected = int(pair, "result") else { continue }
    guard let actual = try? ShellVersion.compareVersions(left, right) else {
        check("比较 \(left) 与 \(right)", false, "应当比较成功")
        continue
    }
    let sign = actual < 0 ? -1 : (actual > 0 ? 1 : 0)
    check("比较 \(left) 与 \(right)", sign == expected, "得到 \(sign)，期望 \(expected)")
}

for invalid in root["compareInvalid"] as? [String] ?? [] {
    check(
        "比较时拒绝 \(invalid)",
        (try? ShellVersion.compareVersions(invalid, "1.0.0")) == nil
    )
}

// MARK: - 结果

print("")
if failures.isEmpty {
    print("全部通过：\(passes) 项断言")
    exit(0)
}
print("失败 \(failures.count) 项 / 共 \(passes + failures.count) 项断言")
for failure in failures {
    print("  - \(failure)")
}
exit(1)
