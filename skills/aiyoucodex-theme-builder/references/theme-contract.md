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


## 对话气泡一致性

新建、优化主题时均执行；用户指定的 UI 优先。以当前原生已发送消息为基准记录 computed style（padding、border、border-radius、box-shadow、字体/行高）和相邻内容间距，作为收发气泡共同的几何基线。粉嫩软糖本次基线是上下 10px、左右 `var(--thread-content-margin,16px)`、圆角 `--aiyou-radius-message`、阴影 `--aiyou-custom-shadow`；其他主题可依据其参考调整，但须成对统一，不能把粉色值硬编码到所有主题。

- 收发气泡共用间距与材质规则，角色差异由语义底色和原生对齐表达。内边距归气泡外壳；不对所有 Markdown、工具输出或消息祖先统一加 padding/opacity。回复文本不能贴边，不能只给用户气泡阴影而将回复气泡清零。
- 保留原生阅读列宽、收发对齐、轮次间距和滚动锚点；主题只改变外观。段落、列表、链接、代码块、表格沿用 Markdown 内部节奏，首尾内容不要叠加额外外边距。空回复不能显示空壳；短回复、长回复、流式追加和最终回复使用同一规则。
- 消息底色使用 message 独立透明度，文字、代码、按钮和背景独立；颜色、圆角、阴影绑定本主题语义变量。Codex / Dot / Claude 可复用相同材质，嵌套 Markdown 不得二次包壳或重复内边距；欢迎卡和工具卡按各自组件规范。
- 检查 `lib/theme-build.mjs` 的实际加载次序、选择器优先级和运行时自定义样式；最终 computed style 才是判据。共同规则必须能覆盖旧的 assistant-only 清零规则，并在更新模板后继承到新皮肤。

验收至少覆盖收发双方的短文、多段、列表、长链接、代码/表格，以及宽窗、窄窗、侧栏展开。逐项核对内边距/圆角/边框/阴影一致，Markdown 无溢出截断、内容可选择、链接和代码按钮可点击，流式追加仍有正确留白。切换系统默认及另一现有主题时，该主题规则不能泄漏；原主题字节、独立设置、当前选择、输入草稿与业务行为保持。以真实 Codex 截图与 computed style 记录交付；隔离夹具仅作为自动验证，不能冒充实机截图。
