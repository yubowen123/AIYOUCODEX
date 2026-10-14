# GPT 与 DeepSeek 同时使用

AIYOUcodex v1.7.0 的 **macOS 版**在原生模型菜单中追加 **DeepSeek V4.1 Flash**（API 模型名 `deepseek-flash`）。GPT 模型和已有 ChatGPT 登录继续保留；选择 DeepSeek 后，可在同一对话中继续工作，也可切回 GPT。

## 开始使用

1. 安装或更新到 AIYOUcodex v1.7.0。结束正在生成的回答后，完整退出客户端，再通过 **AIYOUcodex** 入口打开。
2. 打开 **AIYOUcodex 设置 → DeepSeek**，填写自己的 DeepSeek API Key 并保存。已保存的 Key 只显示配置状态，不会回显。
3. 在原生模型菜单选择 **DeepSeek V4.1 Flash**，再发送消息。可选推理强度为 `low`、`high`、`max`。
4. 切回 GPT 时，选择目标 GPT 模型后继续发送即可。正在生成或等待审批的回答需要先结束，才能切换。

新安装无需手工追加 provider、下载模型目录或安装 Python 凭证脚本。发布包内包含模型 metadata 和 Node.js 认证 helper；启动时仅向子进程添加 DeepSeek 配置，不改写全局默认模型、`config.toml` 或 `auth.json`。

DeepSeek 路由需要安装器完成 npm 依赖安装。如果安装时仅使用桌面应用自带 Node、没有安装 npm 依赖，GPT 仍按原生方式工作，此时不会追加 DeepSeek 条目；补齐依赖后重新启动即可启用。

本版仅在 macOS 自动启用 DeepSeek 代理。启动器和后台恢复进程根据实际打开的应用路径选择该应用自己的原生 CLI，避免同时安装 ChatGPT.app 与 Codex.app 时串用另一应用的后端。如果模型菜单没有新条目，请先确认从更新后的 AIYOUcodex 入口启动，而不是仍在运行的旧进程。

**Windows 继续支持 AIYOUcodex 原有功能，本版尚未启用 DeepSeek 自动接入。** Windows 上保存 Key 不等于模型菜单已经接通；请勿将设置入口或公共模块的通过测试视为 Windows 原生 DeepSeek 能力已交付。

## API Key 保存位置

设置页将 `DEEPSEEK_API_KEY` 独立项保存到当前 Codex 配置目录的 `keys.md`，默认路径为 `~/.codex/keys.md`；显式设置 `CODEX_HOME` 时使用该目录。文件在支持 POSIX 权限的系统上设为 `0600`。保存不覆盖其他凭证项。

环境变量 `DEEPSEEK_API_KEY` 优先于文件；设置页会标明环境变量覆盖状态。渲染界面只收到“已配置 / 未配置”和来源信息，密码输入在提交或关闭时清空，Key 不写入浏览器存储、仓库或发行包。

已有自定义配置会继续生效：全局或所选 profile 的提供方不是 OpenAI 时，不自动接管；已有官方 DeepSeek provider 时，保留该 provider 的认证方式。若它使用另一环境变量或自定义认证命令，请更新对应凭证来源，设置页保存的 Key 不会改写它。名为 `deepseek` 但指向其他地址或协议的配置不被覆盖。

## 同一对话切换与长上下文

- 切换前确认对话可恢复且没有正在生成的回答；保持原 thread ID、历史、项目、工作目录及权限设置。
- 新建 DeepSeek 对话使用 DeepSeek 的模型目录，支持文本和图片输入。不会把 GPT 的专属服务档位、推理摘要或原生网络搜索配置发给 DeepSeek。
- 从 DeepSeek 回到 GPT 时，从原生模型缓存精确读取目标 GPT 的上下文上限，绑定到该次恢复。压缩与后续回答使用目标 GPT，不把旧模型名发往新供应商。
- 若目标 GPT 的窗口信息缺失或不合法，在释放对话前提示错误。刷新原生模型目录后重试；不会猜测上限或自动换模型提交。
- DeepSeek metadata 的 `comp_hash` 使用 `null`，避免跨供应商切换时触发不兼容的上一模型预压缩路径。

## 验证范围

本版 65 项 DeepSeek、启动器和安装专项检查通过，覆盖菜单共存、双向切换、忙碌和错误状态、原生审批请求透传、压缩窗口绑定，以及 Key 保存、环境变量优先、原子写入和错误脱敏。首次安装检查使用空配置目录，确认随包依赖齐全且不更改默认配置和登录文件；无 npm 依赖的隔离安装确认 GPT 可继续使用；设置界面使用隔离浏览器验证。

另以发布包代理连接原生 Codex CLI `0.162.0-alpha.17.2`，在空配置目录成功初始化并创建 `deepseek-flash` / `deepseek` 临时对话，未创建 `config.toml` 或 `auth.json`，未提交模型回答请求。该项确认首次加载与 metadata 解析，不代表桌面窗口验收。

前期已在 macOS 的原生 Codex CLI 完成 GPT → DeepSeek → DeepSeek 主动压缩 → DeepSeek 继续回答 → GPT 的真实服务验证；同一合成标记持续保留，登录类型和登录文件不变。另以 localhost 模拟服务验证了约 600k 上下文返回 270k GPT 窗口时的压缩目标模型。

以上不等同于所有桌面版本的实机验收。更新后原生窗口的完整冷启动、Windows 原生请求链路和使用者实际历史仍需实机确认；发布包内不包含前期测试的私人对话、账号或凭证。

## 资料

- [DeepSeek 官方模型说明](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- [DeepSeek 官方 Codex 接入说明](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex)
- [Codex provider 与认证命令配置](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json)

模型标识和公开能力按 2026-10-14 的官方文档核对。AIYOUcodex 采用追加模型的实现，并保留 GPT 的默认配置；无需执行会替换全局默认模型的一键配置脚本。
