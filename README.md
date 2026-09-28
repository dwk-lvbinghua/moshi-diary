<div align="center">

<img src="assets/icon.png" width="120" alt="墨室 · 时光档案 图标" />

# 墨室 · 时光档案

**把今天，寄给未来的你。**

一本安静的 Windows 桌面日记本，和一枚可以封存的时间胶囊。

[![Release](https://img.shields.io/github/v/release/dwk-lvbinghua/moshi-diary?style=flat-square)](https://github.com/dwk-lvbinghua/moshi-diary/releases/latest)
[![Platform](https://img.shields.io/badge/Windows-10%20%2F%2011%20x64-0078D4?logo=windows&logoColor=white&style=flat-square)](https://github.com/dwk-lvbinghua/moshi-diary/releases/latest)
[![Price](https://img.shields.io/badge/%E4%BB%B7%E6%A0%BC-%E6%B0%B8%E4%B9%85%E5%85%8D%E8%B4%B9-2EA043?style=flat-square)](#-下载安装)
[![Website](https://img.shields.io/badge/%E5%AE%98%E7%BD%91-moshi--diary.netlify.app-0969DA?style=flat-square)](https://moshi-diary.netlify.app/)

[官网](https://moshi-diary.netlify.app/) · [下载安装](#-下载安装) · [常见问题](#-常见问题) · [更新日志](#-更新日志) · [问题反馈](https://github.com/dwk-lvbinghua/moshi-diary/issues)

</div>

---

## 这是什么

**墨室 · 时光档案（时光胶囊日记本）** 是一款 Windows 桌面日记应用：

- 📔 **一本安静的日记本** —— 心情、照片、说不出口的话，都收进来；
- ⏳ **一枚时光胶囊** —— 把一封信封存起来，约定在未来的某一天亲手开启；
- 🔒 **一只带锁的抽屉** —— 数据 100% 存在你自己的电脑上，AES-256 加密，不联网也能用。

免费、无需注册、打开即写。

> 写下今天的你，约定在未来的某一天，亲手开启。

## ✨ 核心功能

### ✍️ 写日记

记录今天的心情、拍下的照片、想说的话。支持**全文搜索**与**日期筛选**，任何一个念头都能被重新找到。

### ⏳ 时光胶囊

把一封信封存起来，设定开启的日子。在那一天到来之前，谁也读不到它——**包括你自己**。到期时，系统会轻轻提醒你。

毕业那天、孩子十八岁生日、跨年夜、或者只是平凡的今天——你都想收到来自过去哪一天的来信？

### 📖 回顾与成就

连续记录天数、漏记时自动生效的「冻结卡」、一枚枚解锁的成就徽章，还有一年一封、可以打印出来的**年度报告**。

## 🔒 隐私与安全

日记是写给自己最诚实的话，它应该锁在你自己的抽屉里：

- 💾 **数据 100% 本地**：不上传、不同步到任何云端，断网也能用；
- 🔐 **AES-256-GCM 加密**：设置密码锁后，整本日记全量加密存储；
- 🚫 **无账号 · 零追踪**：不注册、没广告、没有埋点；
- 📦 **随时带走**：一键导出 JSON 备份，你的每一个字都握在自己手里；
- 🛟 **自动备份**：保留最近 5 份历史，误删可回滚；写入采用原子保存，掉电不丢。

数据存放位置：`%AppData%\MoshiDiary\data`（应用内「设置 → 打开数据文件夹」可直达）。

## 📥 下载安装

| 项目 | 说明 |
| --- | --- |
| 最新版本 | v1.2.0（2026-09） |
| Windows | Windows 10 / 11 x64 · 免安装 · 约 71 MB |
| Android | Android 6.0+ · APK 直装 · 约 3 MB |
| macOS | 已完成适配，即将发布 |
| 价格 | 免费 |

**[⬇️ 前往 Releases 页下载](https://github.com/dwk-lvbinghua/moshi-diary/releases/latest)**，或直接下载：

- Windows：[MoshiDiary_1.2.0_x64.exe](https://github.com/dwk-lvbinghua/moshi-diary/releases/download/v1.2.0/MoshiDiary_1.2.0_x64.exe)
- Android：[MoshiDiary_1.2.0.apk](https://github.com/dwk-lvbinghua/moshi-diary/releases/download/v1.2.0/MoshiDiary_1.2.0.apk)

下载后无需注册，双击即用（Android 需允许「安装未知应用」）。校验值见 Release 页的 `SHA256SUMS.txt`，当前版本：

```
84f975f45167aa9aff1b39eb69e11d710a6cbda79c8f2f7b6660ad6e94482280  MoshiDiary_1.2.0_x64.exe
a31c4bb2d37b6fa96e09abfe71e7f34dd2284baf5821c952fd76992abc485635  MoshiDiary_1.2.0.apk
```

> 💡 首次运行如遇 SmartScreen 拦截，点击「更多信息 → 仍要运行」即可。我们正在接入代码签名证书以彻底消除这一提示。

## ❓ 常见问题

**是免费的吗？以后会收费吗？**
当前版本的全部功能免费。未来推出的增值服务（如多设备同步等）会另行收费，但本地写作体验承诺永远免费，已导出的数据也永远可以打开。

**换了电脑怎么办？**
在旧电脑「设置 → 导出数据」得到一个 JSON 档案（图片会一并打包），在新电脑或手机上「导入数据」即可完整迁移日记与胶囊。Windows / Android 通用。

**忘记密码怎么办？**
⚠️ 非常重要：开启密码锁后数据为高强度加密，**当前版本忘记密码无法找回数据**，请务必牢记密码。恢复码机制已在开发计划中。

**有 Mac 版或手机版吗？**
在规划中，优先级取决于大家的呼声——欢迎去 [Issue](https://github.com/dwk-lvbinghua/moshi-diary/issues) 告诉我们你最需要的平台。

更多问题见[官网 FAQ](https://moshi-diary.netlify.app/#faq)。

## 📝 更新日志

### v1.2.0 · 2026-09

- 新平台：Android 版正式发布（本地文件存储、密码锁、胶囊通知、分享导出，与桌面版同等能力）
- 导出档案把图片一并打包，Windows / Android 之间互迁不再丢图
- 数据格式三端互通：导出 JSON 即可在任一平台导入
- macOS 版已完成适配，即将发布

### v1.1.0 · 2026-09

- 数据改为本地文件存储，写入采用原子保存，更可靠
- 新增密码锁：AES-256-GCM 全量加密，掉电不丢
- 新增自动备份：保留最近 5 份历史，误删可回滚
- 新增系统托盘常驻、胶囊到期系统通知
- 旧版本数据自动迁移，无需手动操作

### v1.0.0 · 2026-08

- 首个公开版本：日记、时光胶囊、回顾与成就系统
- 心情标签、照片日记、全文搜索
- 连续记录与冻结卡机制

## 🗂 关于本仓库

本仓库托管「墨室 · 时光档案」的**官方网站**（[moshi-diary.netlify.app](https://moshi-diary.netlify.app/)，基于 GitHub Actions 自动部署）与 **Windows 安装包发布**（Releases）。

```
├── index.html       官网首页
├── style.css        官网样式
├── privacy.html     隐私政策
├── agreement.html   用户协议
└── assets/          图标等静态资源
```

- 应用本体基于 Electron（Windows / macOS）与 Capacitor（Android）构建，通过 [Releases](https://github.com/dwk-lvbinghua/moshi-diary/releases) 分发；
- 使用问题、功能建议、平台需求（Mac / 手机版）欢迎提 [Issue](https://github.com/dwk-lvbinghua/moshi-diary/issues)。

---

<div align="center">

© 2026 Moshi Studio · 墨室 · 时光档案

**今晚，就写第一篇。**

</div>
