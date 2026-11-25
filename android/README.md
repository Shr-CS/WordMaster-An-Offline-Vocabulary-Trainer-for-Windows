# WordMaster Android

Android 原生 Activity 使用系统 WebView 加载 APK 内置的网页和词库。学习逻辑与 Electron 共用，构建时从仓库的 src/ 同步 HTML、CSS、JavaScript 和 data/words.js。

需要 JDK 17、Android SDK Platform 35，以及正常可用的 Android System WebView。最低 Android 版本为 8.0。

在仓库根目录构建词库，然后进入本目录构建开发安装包。

```sh
npm run build:data
cd android
./gradlew assembleDebug lintDebug
```

输出文件为 app/build/outputs/apk/debug/app-debug.apk。可以通过 ANDROID_HOME 指定 SDK，或在未提交的 local.properties 里配置 sdk.dir。

## 签名发行包

创建自己的 keystore，并在本目录的 .signing/signing.properties 中填写以下配置。

```properties
storeFile=.signing/wordmaster.jks
storePassword=your-store-password
keyAlias=wordmaster
keyPassword=your-key-password
```

运行以下命令生成 app/build/outputs/apk/release/app-release.apk。缺少签名配置时，Gradle 会输出未签名的发行包。

```sh
./gradlew assembleRelease lintRelease
```

请保存签名密钥和配置。后续版本需要使用同一个密钥和更高的 versionCode，才能覆盖安装并保留学习数据。.signing/ 已加入忽略规则。

## 数据与设备能力

- 完整词库随 APK 分发，学习与复习数据保存在应用自己的 WebView 存储中。
- 导入与导出使用系统文档选择器，JSON 格式与桌面版一致。
- 英语朗读使用系统 TTS 服务，离线朗读取决于设备是否已安装英语语音包。
- 返回手势先取消确认弹窗，再退出当前学习或返回首页，在首页时将应用置于后台。
- Activity 为系统栏、刘海和软键盘留出空间，并在横竖屏切换时保留当前页面。
- 窗口进入后台时立即保存学习状态。用户可以通过设置中的导出功能保存文件备份。

已完成签名和安装包结构校验、Android Lint，以及在 Chromium 中对手机、平板和横屏布局的操作检查。当前环境未连接 Android 设备，尚未进行真机安装运行验证。
