# 小新四图轮播·浠浠 v1.0.1

[独立主题下载](https://github.com/yubowen123/AIYOUCODEX/releases/download/v1.5.1/aiyoucodex-theme-crayon-shinchan-four-scenes-xixi-v1.0.1.zip) · [SHA-256 校验](https://github.com/yubowen123/AIYOUCODEX/releases/download/v1.5.1/aiyoucodex-theme-crayon-shinchan-four-scenes-xixi-v1.0.1.zip.sha256) · [主题源码及安装](../themes/crayon-shinchan-four-scenes-xixi/README.md)

浠浠（xixi）设计的社区共创主题。四张原图和海报逐字节保留；角色、素材权利不在代码 MIT 许可范围内。

## 修复

- 四张图默认等比完整显示，统一适配与位置设置，取消强制拉伸。
- 24 秒循环连续淡入淡出；背景重建后继续轮播，窗口隐藏或减少动态时回退静态第一张，破图回退完整海报。
- 内置轮播与个人素材隔离；主题设置默认开关一致，修正旧模板标题与粉色设置控件。
- Codex、Dot、Claude 收发气泡统一留白和材质，嵌套 Markdown 无重复内边距，发送图标对比度通过。
- 独立配置、取消与保存、其他主题、系统默认回退，以及现有草稿和命中区域保持有效。
- 新增 macOS / Windows 安装入口和逐文件校验。

## 验证

原包编译与色卡通过，但隔离运行发现 12 项失败；修复版本通过 33 项隔离浏览器检查，涵盖完整周期、宽窄窗口、动静态回退、损坏素材、自定义背景、气泡、输入区透明度、发送接受观察、配置保存及切换取消。另有 21 项编译、配置、目录和运行回归通过。

正文色卡对比度 10.30:1，次级文字 6.35:1，发送图标 5.29:1。包内 `SHA256SUMS.txt` 校验源码和素材；Windows Git 检出保留包文件原始字节。

本机安装已追加到目录并确认编译文件与后台服务；现有主题字节和配置键保留。以上运行检查及图片来自隔离浏览器，原生 Codex 窗口效果仍待实机确认。

## 复现

```sh
npm ci
node --test test/theme-shinchan.test.mjs
node scripts/verify-shinchan-theme.mjs --package themes/crayon-shinchan-four-scenes-xixi
```

需要 Chrome，脚本使用自己的浏览器进程和临时配置，不连接实际 Codex 应用。
