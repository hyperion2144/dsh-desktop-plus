# mobile/android/keystore — Android 签名材料

Android 的覆盖安装（升级）靠**同一把钥匙**：系统比对 apk 的签名证书，
证书不同就拒装（`INSTALL_FAILED_UPDATE_INCOMPATIBLE`）。所以发版不能「每次 CI 现生成一把
keystore」——那样每一版的签名都不同，用户的壳永远停在第一版。

这把 keystore 是**侧载分发用的 upload key**（不进应用商店），作用只有一个：
让每一版 apk 都能盖在上一版上装。

## 仓库里这把是什么

| 项 | 值 |
|---|---|
| 文件 | `upload.keystore`（PKCS12） |
| 别名 | `plus-upload` |
| 口令（store / key 相同） | `dsh-plus-upload` |
| 算法 | RSA 2048 / SHA256withRSA |
| 有效期 | 2026-11-01 → 2054-03-19（10000 天） |
| 证书 SHA-256 | `30:67:E2:C1:59:EC:20:39:1A:70:A8:D8:D6:28:E7:C2:AB:C2:4B:84:61:34:EC:14:FD:A7:61:CB:07:B6:39:CE` |

口令写在旁边的 build 文件与本文档里，因为**这把钥匙本来就是公开的**：
它在公开仓库里，任何人 clone 就能拿到。

## 风险（明说）

1. **没有机密性**：仓库公开 ⇒ keystore 与口令都公开。任何人都能用这把钥匙签出
   一个 `applicationId` 相同的 apk。它本身不是发布渠道（用户从本仓库的 Release 装），
   但**第三方可以签出一个「看起来是我们」的包**去别处分发。装上它的用户之后会被本仓库
   的更新覆盖回去（签名一致），但在此之前，那份包里的代码是别人的。
   缓解：分发的唯一入口是本仓库的 Release；apk 的 sha512 写进同一次 Release 的
   `nightly-android.yml`，壳下载后校验 sha512，不匹配就不装。
2. **丢钥匙 = 断升级链**：这把 keystore 一旦丢失且没有备份，新签出的 apk 盖不上旧版，
   用户只能卸载重装（壳内的配对凭证与加密存储会一起丢，需要重新配对）。
   缓解：把 `upload.keystore` 离线备份一份（见下）。
3. **口令公开 ⇒ 不能把它当「只有我们能签」**：任何「只有维护者能发版」的假设都不成立。
   真正的信任根是**仓库的写权限 + Release 的发布权**，不是这把钥匙。
4. 这**不是**应用商店的上传密钥（不是 Play App Signing 的 upload key，也不是 AAB 的密钥）。
   若将来上架应用商店，另起一把 upload key + 走 Play 的密钥轮换流程，与本文件无关。

## 更好的做法：换成私有 keystore（推荐）

发版流水线是 **secrets 优先、仓库兜底**（见 `.github/workflows/release-mobile.yml`）：
配了下列 secret 就用私钥，没配才回退仓库里这把。

| Secret | 内容 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | keystore 文件的 base64（`base64 -i upload.keystore` 的输出） |
| `ANDROID_KEYSTORE_PASSWORD` | store 口令 |
| `ANDROID_KEY_ALIAS` | 密钥别名 |
| `ANDROID_KEY_PASSWORD` | key 口令（与 store 口令相同时可留空） |

配置方法（GitHub 仓库 → Settings → Secrets and variables → Actions）：

```sh
base64 -i upload.keystore | pbcopy     # 粘进 ANDROID_KEYSTORE_BASE64
```

配好后 CI 用私钥签名，仓库里这把只是「没配 secret 时的兜底」。

## 更换流程（换一把新钥匙）

**先说清楚代价**：换了钥匙，签名就变了 → **已装的旧版盖不上**。所有用户必须
卸载重装（壳内的配对凭证会丢，要重新配对）。所以换钥匙是一次**破坏性发布**，
只在「钥匙泄露」或「口令公开带来的风险不可接受」时做。

流程：

1. 生成新钥匙（**换新的口令**）：

   ```sh
   keytool -genkeypair -v \
     -keystore upload-new.keystore -storetype PKCS12 \
     -alias plus-upload -keyalg RSA -keysize 2048 -validity 10000 \
     -storepass <新口令> -keypass <新口令> \
     -dname "CN=DSH Desktop Plus Mobile Upload, OU=Mobile, O=DSH Desktop Plus, C=CN"
   ```

2. 离线备份：`upload-new.keystore` 存到密码管理器 / 离线介质（**不要只放仓库**）。
3. 先配 CI secrets（`ANDROID_KEYSTORE_BASE64` 等）——这样下一版就用新钥匙签。
4. 替换仓库里的兜底文件：把 `upload-new.keystore` 复制成 `upload.keystore`，
   同步更新本文件的别名 / 口令 / 证书指纹，以及
   `mobile/android/app/build.gradle.kts` 里的 `DEFAULT_UPLOAD_ALIAS` /
   `DEFAULT_UPLOAD_PASSWORD`（兜底路径的口令）。
5. 在 CHANGELOG 里写明「签名已更换：需要卸载重装」。
6. 旧钥匙在确认所有用户都换过之后才可以销毁。

## 想确认某个 apk 是这把钥匙签的

```sh
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs app-release.apk
```

输出的 `Signer #1 certificate SHA-256 digest` 应当等于本文件里的指纹。
