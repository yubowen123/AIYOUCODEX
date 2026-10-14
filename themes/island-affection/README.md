# 海岛心动陪伴 v1.0.2

1280×720、24 fps、17.54 秒的连续动态背景。四种动作依次为抚摸、撒娇、亲吻与温柔妩媚；四句表白随动作播放，声音默认关闭，音量默认 35%。

![海岛心动陪伴背景视频首帧，非 Codex 实机截图](assets/poster.png)

[下载独立主题](https://github.com/yubowen123/AIYOUCODEX/releases/download/v1.5.1/aiyoucodex-theme-island-affection-v1.0.2.zip) · [播放背景视频](https://github.com/yubowen123/AIYOUCODEX/blob/main/themes/island-affection/assets/continuous.mp4) · [下载视频](https://github.com/yubowen123/AIYOUCODEX/releases/download/v1.5.1/aiyoucodex-theme-island-affection-v1.0.2-preview.mp4) · [安装包 SHA-256](https://github.com/yubowen123/AIYOUCODEX/releases/download/v1.5.1/aiyoucodex-theme-island-affection-v1.0.2.zip.sha256)

## 安装与声音

需要 AIYOUcodex 与 Node.js 22.5 或以上。解压后，macOS 双击 `install.command`；Windows 运行 `install.ps1`。也可在主题目录执行：

```sh
node install.mjs --dry-run
node install.mjs
```

若旧安装目录缺少 `scripts/install-theme.mjs`，可使用完整 AIYOUcodex 源码中的官方安装器：

```sh
node /path/to/AIYOUCODEX/scripts/install-theme.mjs --package /path/to/island-affection --install-dir "/path/to/Codex Sidebar Enhancer"
```

安装后在「主题与动效」选择「海岛心动陪伴」。在本主题设置里开启声音并保存；试听、取消和音量调节均可用。重新加载后，仍需点击声音开关或试听控件解锁播放。主题使用独立 ID `island-affection` 和配置键 `aiyoucodex.theme.island-affection.v1`，保留其他主题与原有选择。

## 播放方式

- 四种动作在同一条视频中连续播放，表白字幕随视频时间显示。
- 聊天点击、发送和任务状态变化不会重新创建播放器或打断背景。
- 关闭「连续播放四种动作」停在当前画面，再次开启继续播放。
- 减少动态效果、隐藏窗口及媒体失败时使用静态回退；装饰层不拦截原生操作。

## v1.0.2 修复与验证范围

移除 v1.0.1 的静态图片叠层和淡入淡出，裁掉开头不稳定的帧，并校准两段素材的机位，消除叠化造成的眼镜和脸部双轮廓。当前保留此版本：**循环接缝仍有轻微局部姿态差异，尚不能宣称完全无微抖。**

视频共 421 帧，H.264 视频与 AAC 音轨全量解码通过。30 项隔离 Chrome 检查通过，覆盖连续播放、暂停续播、四句时间字幕、默认静音、声音保存与取消、权限限制后的静音重试、隐藏/减少动态/失败回退、气泡及主题隔离。

macOS 已进行本机安装与源码校验值回读；原生视觉与实际听感仍待人工验收。Windows 与整机重启未实测。隔离检查和背景素材预览不等同于 Codex 实机效果验证。

`SHA256SUMS.txt` 用于核验包内源码与素材。视频基于主题提供者的参考图，经 Seedance 2.5 生成及后期剪辑；本次发布沿用现有视频。
