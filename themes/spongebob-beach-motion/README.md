# 海底假日·海绵宝宝 v1.0.2

AIYOUcodex 个人主题，原作者：浠浠。本版保留原图、主题 ID 和独立配置键，修复动效、背景叠层、气泡留白、按钮对比度与安装说明。

首次使用默认显示完整静态图片，可在“主题与动效”中开启人物轻摆与水面微光。已有保存的动效选择继续保留。系统开启减少动态效果或窗口隐藏时停用内置动画；选择自定义素材时不再叠加内置人物。

## 导入

如果当前 AIYOUcodex 提供“导入主题包”入口，选择本主题 ZIP，导入后在主题选择器中选择“海底假日·海绵宝宝”。本轮未实测原生导入界面。

## 使用脚本安装

先解压 ZIP，再进入解压后的**主题目录**。需要支持主题包的完整 AIYOUcodex 安装目录，其内必须包含 `scripts/install-theme.mjs`。脚本先检查，成功后才注册；不会自动切换主题。不下载或升级宿主。

macOS 默认使用 `~/Library/Application Support/Codex Sidebar Enhancer`：

```bash
bash ./install.command --dry-run
bash ./install.command
```

宿主位于其他目录时，使用该宿主的绝对路径：

```bash
bash ./install.command --root "/absolute/path/to/AIYOUcodex" --dry-run
bash ./install.command --root "/absolute/path/to/AIYOUcodex"
```

Windows PowerShell：

```powershell
.\install.ps1 -DryRun
.\install.ps1
```

自定义 Windows 路径可追加 `-AIYOURoot 'C:\path\to\AIYOUcodex'` 和 `-NodePath 'C:\path\to\node.exe'`。

跨平台直接调用：

```bash
node ./install.mjs --root "/absolute/path/to/AIYOUcodex" --dry-run
```

Node.js 需 22.5+。若提示缺少 `scripts/install-theme.mjs`，该目录无法用本安装入口注册主题，请指定包含此脚本的完整宿主目录。`--dry-run` 只检查，不安装。

## 验证范围

已通过当前 AIYOUcodex 源码编译器与独立 Chrome 测试夹具的检查，覆盖动画重挂载、隐藏窗口、减少动态效果、自定义背景、完整静态回退、气泡、透明度、草稿、按钮命中、取消/保存以及主题目录适配。原生 Codex 窗口被工具禁止访问，因此未完成实机视觉验收；Windows 与整机重启也未实测。

## 素材

见 [ASSET-NOTICE.md](ASSET-NOTICE.md)。图片、人物和作者署名保持原包内容；人物和背景不属于主题代码授权。

## 源码与下载

[GitHub 主题库](https://github.com/yubowen123/AIYOUCODEX/blob/main/docs/THEMES.md) · [独立 ZIP](https://github.com/yubowen123/AIYOUCODEX/releases/download/v1.5.1/aiyoucodex-theme-spongebob-beach-motion-xixi-v1.0.2.zip) · [检查记录与隔离预览](https://github.com/yubowen123/AIYOUCODEX/blob/main/docs/THEME-SPONGEBOB-v1.0.2.md)。
