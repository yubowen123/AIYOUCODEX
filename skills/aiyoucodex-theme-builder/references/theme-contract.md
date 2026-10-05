# 主题契约与验证

实际实现以 AIYOUCODEX 仓库源码为准：

- `lib/theme-package.mjs`：manifest、palette、design 验证与透明度设置。
- `lib/theme-build.mjs`：将主题与媒体编译为主界面 / 内嵌面板适配器。
- `lib/theme-catalog.mjs`：主题注册与独立设置；安装新主题不覆盖已有主题。
- `scripts/install-theme.mjs`：安装及 macOS 主题后台服务。
- `themes/pink-candy` / `themes/mecha-control`：可运行的静态 / 动态模板。

包至少含 `manifest.json`、`colors.json`、`design.json`、`controls.json`、`tokens.css`、`theme.css`、`customization.css`、`custom-media.js`、`theme-runtime.js`、`theme-frames.css`、`theme-frames.js` 及声明的 `assets/`。静态模板还使用 `soft-candy.css`。

身份：manifest `schemaVersion:1`，`renderer:aiyoucodex-theme-v1`；id 使用小写字母开头的字母、数字、连字符。palette 与 design 身份跟随 id。运行时独立 `prefKey`，不能使用其他皮肤的设置键。

状态映射：默认静态背景；enter（进入）、click（点击反馈）、send（确认发送之后）、running（执行中）、complete（完成未读）、error（错误）。click 不等于 send。自定义媒体应按这七个槽位绑定，静态主题可全部回退同一张图。

palette 使用 primitives、semantic、pairs 及完整 contexts，复用模板字段并通过 `validateThemePalette`，不得只覆盖首页。当前契约正文对比度要求至少 7:1、辅助文本至少 4.5:1；自定义透明度可能降低可读性，应显示真实提示而非擅自改写用户选择。

透明度 UI 为 `100*(1-alpha)`。`composer` 为输入框内部，`composer-area` 为输入区外层；装饰、文字和表面分层。不要把后台输出中的文件变化数量或样式变量当作原生有效性的证明。

适配器中的原生选择器不确定时，先核对当前 DOM 与源仓库测试。皮肤主图不能遮挡原生控件。不要通过改布局、伪造任务状态或自动发送来演示动效。

最少验证：身份隔离、资源/色卡校验、默认回退、取消/保存、原有皮肤保持、草稿不变与原生按钮可点击。动态主题再检查减少动态效果设置、失败静态回退、真实 send 事件与只点击之间的区别。Windows 与整机重启未实测时据实注明。
