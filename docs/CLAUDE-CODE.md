# Dot 与 Claude Code

原生裤兜行提供并排的 `Dot（裤兜）` 与 `Claude Code` 入口。Dot 仍调用原生 `builtin:orbit`，不替换宿主功能。Claude Code 打开可调整宽度的同级工作面板，原 Codex 对话与输入框保持不变。

## 能力

- 从本机 Codex 项目索引选择项目，使用实际目录作为 Claude 工作目录；同名不同路径保持独立。
- 创建独立 Claude 会话，流式显示回复与工具调用；停止仅影响选定 Claude 会话，继续发送使用精确会话 ID。
- 本机保存会话列表与显示记录；后台断开后不把未完成任务标成完成。
- 检索并选择最多 20 个 Codex Skills。通过临时的本地 Claude 插件与原目录链接加载，保留脚本、参考文件和相对路径，不改写 Skill。
- 从 Codex `config.toml` 读取标准 stdio / HTTP MCP，按会话选择。保留环境变量与认证头在后台，界面只展示名称与兼容状态。
- 工具确认在面板显示，支持允许本次或拒绝；不用 `bypassPermissions`，不更改 Claude 用户权限或登录配置。
- Skills / MCP 位于输入框的「＋」引用弹层，可搜索并选择，已选择项显示为可移除标签。空闲时可调整下一次调用的引用；运行中锁定引用，已有会话保持项目不变。
- 双入口使用 #595959 小字号与淡阴影；面板只挂载到当前可见的产品页面，避开新版宿主保留的隐藏页面。
- 双入口高度为 44px，分组栏的新建项目与新建对话跨标签保持可见；缺少可调用原生入口时显示禁用原因，不跳转成无关操作。
- 项目筛选列表包含宿主已保存的远程项目，显示「远」角标，以机器和项目 ID 区分同名项目。远程路径不会被用作本机 Claude 工作目录；没有本机历史时明确说明远程对话由宿主连接加载。

## Claude 角色设置

点击 Claude 对话顶部居中的头像或名字，打开紧贴顶部的小设置弹窗。可设置 1–48 字的名称、上传 Logo，填写最多 4000 字的角色说明；保存后侧栏入口与对话顶部同步显示。上传支持 PNG / JPG / WebP / GIF（GIF 使用静态首帧），在本机缩至最长边 512px，不向外部上传；可恢复默认 Claude 星形 Logo。

配置独立保存在 `.codex/aiyoucodex/claude-code/persona.private.json`，重启仍保留；多窗口保存有版本检查。角色名称与说明用于后续 Claude 消息，Logo 只用于界面。不会改动 Dot 名称、头像、历史或登录。打开 Claude 时只隐藏 Dot 的浮动头像层，返回 Dot 自动恢复。

Claude 参照 Dot 的居中头像名称、圆角气泡、悬浮输入框与底部「＋」引用菜单。面板覆盖当前可见工作区，不推动原页面内容；在 Dot 的纵向主区域内挂载到横向工作区，避免标题被顶出窗口，并保持高于原生编辑面板的可点击层级。

## 安装与边界

需要本机已安装且已完成配置的 Claude Code。默认寻找 PATH、用户 `.local/bin` 与常用安装目录；可通过 `AIYOUCODEX_CLAUDE_EXECUTABLE` 指定可执行文件。

公开安装器在替换旧安装前，通过本机 npm 安装锁定的桥接依赖，关闭安装脚本；下载失败会保留原安装。只提供 Node、没有 npm 时保留基础增强功能，并提示先安装带 npm 的 Node.js 后重新运行安装器。源代码运行前执行 `npm ci --ignore-scripts`。已有 AIYOUcodex 安装目录可执行 `npm ci --omit=dev --ignore-scripts` 安装桥接依赖，然后只重连插件后台。未安装依赖时不会改写 Claude 的认证或供应商，也不会自动调用其他平台。

沿用本机 Claude 的模型、登录与供应商设置。启用的 Codex 标准 MCP 通过官方 Agent SDK 按会话传入；宿主专用 Node REPL、内置产品工具与云端授权不能自动转成 Claude MCP，界面明确提示。已有 Claude 项目规则与用户设置仍会加载，但本面板不自动继承未选择的 MCP。

本功能不会自动发送 Codex 对话、登录、兑换额度、发布 GitHub、调用付费生成或代替用户确认外部操作。选中项目后，Claude 工具按其原有设置及面板确认流程工作。

会话状态保存在用户本机 `.codex/aiyoucodex/claude-code/sessions.private.json`，生成的 Skill 链接位于同目录 `plugins/`，不进入公共包。MCP 认证数据不写入会话索引。

相关回归：`test/claude-code.test.mjs`、`test/claude-code-renderer.test.mjs`、`test/renderer-runtime-integration.test.mjs`。
