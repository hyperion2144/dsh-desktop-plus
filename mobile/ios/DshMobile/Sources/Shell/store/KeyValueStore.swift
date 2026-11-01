import Foundation

/// 壳的持久化接口。
///
/// 壳只有一处持久化：所有键值都落在同一个实现里（`KeychainStore`）。
/// 这样「凭证不可用」这件事只有一个来源，不会出现一半数据在 Keychain、一半在别处。
protocol KeyValueStore: AnyObject {
    /// 读一个字符串；没有这个键时返回 nil。
    func string(forKey key: String) -> String?

    /// 写一个字符串；传 nil 表示删除这个键。
    func setString(_ value: String?, forKey key: String)

    /// 读一个布尔值；没有这个键时返回 fallback。
    func bool(forKey key: String, default fallback: Bool) -> Bool

    /// 写一个布尔值。
    func setBool(_ value: Bool, forKey key: String)
}
