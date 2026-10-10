# YOYO萌趣歪头·浠浠 v1.3.2

主题设计：**浠浠（xixi）**。本版保留六张原始 PNG、`yoyo-tilt-collection` 身份和独立设置键；使用二维素材的 CSS 旋转实现五个人物的错速动效。

[独立下载 ZIP](https://github.com/yubowen123/AIYOUCODEX/releases/download/v1.5.1/aiyoucodex-theme-yoyo-tilt-collection-xixi-v1.3.2.zip) · [SHA256 校验文件](https://github.com/yubowen123/AIYOUCODEX/releases/download/v1.5.1/aiyoucodex-theme-yoyo-tilt-collection-xixi-v1.3.2.sha256) · [完整源码与安装说明](../themes/yoyo-tilt-collection/README.md)

## 修复内容

- 修复 PNG 装饰声明导致的编译失败，删除损坏的 GIF 占位文件，使用完整合照作为静态回退。
- 重挂载、隐藏窗口、减少动态效果与动效开关保持一致；任意人物解码失败时停止并隐藏人物层，恢复完整合照。
- 自定义背景接管背景区域；切回内置背景清除旧媒体标记，避免合照与旋转人物混叠。
- 收发气泡使用相同留白、圆角、边框与阴影；支持短文、多段、列表、代码、宽表格、流式追加与窄窗口。
- 默认气泡透明度与色卡审计一致，纠正设置名称与配色，补齐 macOS 与跨平台安装入口。

## 验证范围

当前编译器的语法、资源预算和语义色卡检查通过。独立 Chrome 测试夹具通过 30 项检查，覆盖动效、回退、自定义媒体、气泡、输入框内外透明度、草稿、发送按钮命中、点击与确认发送的区别、设置取消与保存、旧主题保留和系统默认切换。运行：

```bash
node --test test/theme-yoyo.test.mjs
```

浏览器测试需要 Chrome；可通过 `AIYOUCODEX_TEST_BROWSER` 指定可执行文件。CI 设置 `AIYOUCODEX_REQUIRE_BROWSER=1`，缺少浏览器时失败而不跳过。测试启动独立浏览器和临时配置目录，不访问原生 Codex。

已完成一次 macOS 实际主题目录注册，编译源码与安装结果一致，既有主题和配置键保持。原生视觉、原生导入入口、Windows 实机安装及整机重启尚未验收；首页图片为素材预览。

## 下载完整性与素材

ZIP：7,594,470 字节，29 个文件。SHA256：

```text
27f9927ed9708e0d1b6602b8a850543891a6409f53e764e26a096a53720267f2
```

源码与 ZIP 内容一致，包内 `SHA256SUMS.txt` 可验证所有其他文件。六张 PNG 字节保持原包内容。署名与原作者的来源声明保留在 [ASSET-NOTICE.md](../themes/yoyo-tilt-collection/ASSET-NOTICE.md)；素材生成来源未独立验证，MIT 仅适用于主题代码。
