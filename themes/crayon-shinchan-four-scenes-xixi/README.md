# 小新四图轮播·浠浠 v1.0.2

暖奶油色界面，完整保留四张原始小新图片，约 24 秒循环。默认使用 contain 等比显示；可调整适配和位置。关闭动效、系统减少动态效果、窗口隐藏或轮播图片加载失败时使用第一张静态图。自定义素材会独立显示。

## 安装

需要 AIYOUcodex 与 Node.js 22.5 或以上。macOS 可双击 `install.command`；Windows 运行 `install.ps1`，或在任一平台执行：

```sh
node install.mjs --dry-run
node install.mjs
```

若旧安装目录缺少 `scripts/install-theme.mjs`，使用 AIYOUcodex 源码中的官方安装器：

```sh
node /path/to/AIYOUCODEX/scripts/install-theme.mjs --package /path/to/this-theme --install-dir "/path/to/Codex Sidebar Enhancer"
```

安装后在主题选择器选择「小新四图轮播·浠浠」，保存后启用。独立 ID 和配置键保留其他主题设置。

## 修复与校验

v1.0.2 额外修复点击导致第一张图单独重启和轮播不同步；修复图片拉伸、轮播重建/后台/减少动态回退、破图回退、气泡一致性、发送图标对比度及旧模板标题；设置面板使用本主题奶油配色。`SHA256SUMS.txt` 可核验源码与素材。验证来自隔离浏览器，实际 Codex 窗口效果仍需用户确认。

## 素材与鸣谢

主题作者：浠浠（xixi）。四张素材按原样保留。角色、图片、商标权利归各自权利人所有；MIT 仅覆盖主题代码，详情见 [ASSET-NOTICE.md](ASSET-NOTICE.md)。
