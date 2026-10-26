# GPT 与 DeepSeek 同时使用

AIYOUcodex 的 **macOS 版**在原生模型菜单中追加 **DeepSeek V4.1 Flash**（API 模型名 `deepseek-flash`）。GPT 模型和已有 ChatGPT 登录继续保留；选择 DeepSeek 后，可在同一对话中继续工作，也可切回 GPT。

## 开始使用

1. 安装包含本次修复的 AIYOUcodex 版本。2026-10-15 的本次源码更新不自动替换既有发行包，请按对应发布记录核对。结束正在生成的回答后，完整退出客户端，再通过 **AIYOUcodex** 入口打开。
2. 打开 **AIYOUcodex 设置 → DeepSeek**，填写自己的 DeepSeek API Key 并保存。已保存的 Key 只显示配置状态，不会回显。
3. 在原生模型菜单选择 **DeepSeek V4.1 Flash**，再发送消息。可选推理强度为 `low`、`high`、`max`。
4. 切回 GPT 时，选择目标 GPT 模型后继续发送即可。正在生成或等待审批的回答需要先结束，才能切换。

新安装无需手工追加 provider、下载模型目录或安装 Python 凭证脚本。发布包内包含模型 metadata 和 Node.js 认证 helper；启动时仅向子进程添加 DeepSeek 配置，不改写全局默认模型、`config.toml` 或 `auth.json`。

DeepSeek 还需要原生 Codex 的完整模型缓存。启动时以该缓存为基础生成仅含公开模型 metadata 的 `models/aiyou-gpt-deepseek.json`，完整保留原 GPT 条目，再追加 DeepSeek。若新配置目录尚无缓存，或缓存损坏、不完整，GPT 继续按原生方式启动，暂不启用 DeepSeek；先让原生 GPT 完成模型目录同步，再完整退出并重新启动 AIYOUcodex。不会用仅含 DeepSeek 的目录替换原模型列表。

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
- 从 DeepSeek 回到 GPT 时，精确读取目标 GPT 的窗口。历史较长或用量未知时，先在原 DeepSeek 通道压缩一次，等待对应压缩 turn 完成并确认用量低于目标预算，再释放并恢复到 GPT；短历史直接切换。后续回答才使用目标 GPT，不把 DeepSeek 名发往 GPT。
- 压缩失败、中断、超时或结果仍超预算时，保留原提供方并提示错误，不循环压缩、不自动提交下一次生成。
- 若目标 GPT 的窗口信息缺失或不合法，在释放对话前提示错误。刷新原生模型目录后重试；不会猜测上限或自动换模型提交。
- DeepSeek metadata 的 `comp_hash` 使用 `null`，避免跨供应商切换时触发不兼容的上一模型预压缩路径。

## 连续压缩修复（2026-10-15）

仅向模型菜单追加名称、或在线程级设置模型目录/窗口，不能使原生全局模型管理器识别 DeepSeek 的 1M 窗口。原生 CLI `0.162.0-alpha.17.2` 在这种情况下仍采用 258,400 Token 的未知模型回退窗口；正常带工具请求约 28 万 Token，导致压缩后每步工具调用再次触发压缩。

本次修复在 `app-server` 子命令参数末尾追加合并模型目录，使 DeepSeek 有效窗口达到 996,147 Token。保留正常自动压缩，不修改服务器 usage，也不隐藏压缩通知。已经运行的旧后端必须完整退出重启才能加载，单独切换菜单无效。

## 验证范围

Node 22 完整回归为 878 项通过、0 失败、1 项平台跳过；另 4 项 task-activity 回归通过。本次移植的 62 项模型路由、模型目录、便携配置和 Key 设置专项检查全部通过，包括无 npm 依赖时 GPT 直通、自定义 provider/profile 优先级、完整 GPT metadata 保留、目录原子写入、无缓存保护，以及单次原提供方预压缩的失败与中断处理。

本机此前真实 DeepSeek 服务回归：最高 294,694 输入 Token、连续 3 次无副作用工具调用、0 次自动压缩，合成标记保留，有效窗口 996,147。另以实际 bundled native 和 localhost 合成服务，对照线程级目录仍循环压缩、启动级完整目录不循环，以及 600k DeepSeek 历史经原通道单次压缩后返回 270k GPT；测试不使用私人对话。

前期 GPT → DeepSeek → DeepSeek 主动压缩 → DeepSeek 继续回答 → GPT 的短对话真实服务测试仅证明模型切换和标记保留，不能单独证明长任务压缩正常。当前窗口冷启动、实际使用者历史及 Windows 原生 DeepSeek 请求链路仍需分别实机确认；公开仓库不包含私人账号、对话或凭证。

## 资料

- [DeepSeek 官方模型说明](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- [DeepSeek 官方 Codex 接入说明](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex)
- [Codex provider 与认证命令配置](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json)

模型标识和公开能力按 2026-10-14 的官方文档核对。AIYOUcodex 采用追加模型的实现，并保留 GPT 的默认配置；无需执行会替换全局默认模型的一键配置脚本。
