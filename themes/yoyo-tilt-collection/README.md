# YOYO 萌趣歪头 · 浠浠

**主题署名：浠浠** · v1.3.2 · AIYOUcodex 动态主题

五款 YOYO 摆件在聊天工作区各自以不同周期连续旋转，保留奶油白、珊瑚红与浅蓝配色。关闭动效、开启系统减少动态效果或窗口隐藏时停止旋转，使用完整静态合照；人物解码失败也回退到静态合照。自定义背景完全接管背景区域，内置人物停止并隐藏。旋转由二维素材的 CSS 变换实现。

## 安装

需要 Node.js 22.5+，以及包含 `scripts/install-theme.mjs` 的完整 AIYOUcodex 安装目录。

macOS：解压后运行 `./install.command`。Windows：在 PowerShell 中运行 `./install.ps1`。安装只注册主题，在主题选择器中选择「YOYO萌趣歪头·浠浠」并保存。

指定安装或源码目录并先检查：

```bash
node install.mjs --root "/path/to/AIYOUCODEX" --dry-run
node install.mjs --root "/path/to/AIYOUCODEX"
```

macOS 也可以运行 `./install.command --root "/path/to/AIYOUCODEX" --dry-run`。Windows 支持 `./install.ps1 -AIYOURoot "C:\path\AIYOUCODEX" -DryRun`。若缺少主题安装脚本，请使用支持主题包的完整目录。

主题沿用 `yoyo-tilt-collection` 身份与独立设置键；已有个人设置保留，恢复默认后使用新版默认参数。

## 本版修复

修复 PNG 人物资源声明导致的编译失败，删除损坏占位 GIF；修复动效重挂载、人物解码失败及自定义背景隔离；收发气泡共用留白、边框与阴影；默认气泡透明度与色卡审计一致；纠正设置中的主题名称和配色；补充 macOS 安装入口。原始六张 PNG 素材字节保持。

包通过编译检查与隔离浏览器验证。隔离预览不代表原生 Codex、Windows 或整机重启验收。

## 来源与许可

背景和角色图的来源声明见 ASSET-NOTICE.md。MIT 仅适用于主题代码；角色、系列名称、商标和素材权利按该说明处理。本次保留原作者声明，未独立验证素材生成来源。
