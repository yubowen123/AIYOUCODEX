---
name: edit-video
description: Edit videos directly from the Codex conversation using OpenChatCut MCP, with live preview and timeline in the right panel. Use for 口播净剪, 动态包装, 长片拆条, 产品故事, AI 影像, 知识成片, captions, audio normalization, jump cuts and aspect-ratio edits.
---

# OpenChatCut 视频剪辑

在 AIYOUcodex 中，视频剪辑默认使用此插件的 OpenChatCut MCP。所有理解、规划和操作指令直接在当前 Codex 对话中完成；右侧显示真实工程的素材、预览与时间线，内置 Agent 工作台在嵌入模式隐藏。无需在 OpenChatCut 内再选 Agent 大脑、登录另一模型或输入第二次指令。用户明确指定其他剪辑软件时遵守用户选择。

## 工作流与快捷修改

用户可直接在 Codex 对话中说“做口播净剪”“拆成几条短视频”“加字幕”“响度标准化”“横转竖”等。按 [工作流与快捷编辑](references/workflows.md) 把目标转为实际工具操作，不要求用户进入独立工作台。上游六个入口与快速动作是提示模板，不是已经执行的流水线；Codex 负责根据实际素材、工具目录和结果推进。

缺少影响剪辑目标的素材或参数时，在本对话中澄清；无需让用户重新向右侧工具描述需求。已有素材、参数和授权直接沿用。字幕转写、生成画面/配音/音乐等仍有各自资源条件；Codex 的对话模型可负责规划，不能替代未配置的媒体模型，也不能假称已经生成。

## 开始与工程隔离

1. 从可信对话上下文取得当前 `threadId`。所有剪辑工具都传此 ID；不知道 ID 时先读取宿主当前对话信息，不编造、不复用另一对话的 ID。
2. 调用 `openchatcut_status`。未安装时指出设置或左侧 OpenChatCut 入口中的一键安装按钮；不下载另一个剪辑工具替代。
3. 调用 `openchatcut_start_editing`，可传 `projectTitle`、`fps`、`compositionWidth`、`compositionHeight`。每个对话自动绑定一个独立工程；重开对话继续同一工程。
   对话与工程固定绑定：普通编辑、重新打开及项目改名均不换绑；嵌入页隐藏返回工程列表并固定当前工程路由。只有用户在本对话明确要求新建剪辑项目时，才调用 `openchatcut_new_project` 换绑；原项目保留，有未应用草稿时先处理草稿。不得将当前需求理解为立即新建项目。
4. 调用 `openchatcut_list_tools` 获取当前上游真实工具和参数。工具也以 `occ_` 前缀动态提供；通用 `openchatcut_call_tool` 可调用完整目录中的工具。不要根据旧 README 猜测能力。

## 执行剪辑

- 用本地素材路径调用 `import_asset`、`import_assets` 或 `import_folder`。插件在当前实时工程中通过官方本地上传槽、字节与哈希回执、媒体探针及 finalize 导入；普通嵌入面板也可使用。保留上游素材目录限制，启用云存储时停止本地导入，不擅自更改设置。检查导入结果、错误和 `truncated`，再通过 `read_project`、`read_timeline` 读取真实素材、时间线和帧率。
- 使用 `split_item`、`set_item_timing`、`move_item`、`edit_item`、`edit_track`、`edit_captions` 等目录中实际存在的工具。参数遵循返回的 schema，时间以工程帧率换算。
- 所有工具通过插件执行。工程与草稿 ID 由控制器绑定；不要传其他工程的 `editorProjectId` 或其他对话的 `editSessionId`。
- 默认每次草稿编辑自动 `review_edit_session` 并应用，右侧真实时间线立即更新。需要一个原子批次时，仅通用工具可设置 `deferReview: true`；完成后显式调用 `review_edit_session`，禁止把尚未应用的草稿称为已完成剪辑。
- 用帧检查工具核对画面，读取字幕和音轨验证结果。文字删除工具只重排音频，不保证同步裁掉视频；按词时间戳切视频时使用视频片段的 split/trim 工具并核对同步。
- 需要成片时用真实目录里的 `submit_render_job` 和 `track_export`，显式保留 `renderId` 并轮询；异步接口返回 `/media/uploads/…` 成片路径。不要用只触发浏览器 Blob 下载、未返回落盘路径的同步导出表示已经保存成片。只有任务完成且本地输出可播放，才能报告成片已交付。渲染、预览和回读不属于新增视频生成。

## 连贯性与失败处理

- 每次工具调用前控制器都验证当前工程的实时编辑器已连接。右侧未连接时解决面板/服务状态，不切换工程、不退回离线写入。
- 跨对话剪辑由控制器串行执行；后台任务可使用隐藏的编辑器保持执行，不把用户切换到其他对话。
- 断线草稿按上游 revision 恢复，不自动丢弃。返回 stale/failed 或未知写入结果时先回读工程；不能无条件重试写操作。
- 完成汇报包含实际保存工程、应用状态及成片绝对路径。未验证的编码、效果、导入或性能应明确说明。

## 生成和外部动作

自动剪辑 MCP 仅自动执行审核过的本地剪辑/渲染能力，透传真实目录不等于所有操作自动授权。其余目录能力使用 OpenChatCut 原生精确参数确认卡；返回 `pending` 时指出右侧待确认操作，用户确认后才能按原参数继续。转录显式选择 `provider: local` 可使用本地 ASR，需先确认本地模型可用；其他云端转录供应商使用原生确认。付费生成、发布、外部上传、执行外部代码和安装远程 Skill 不通过自动剪辑通道。动作名称存在别名时仍按实际效果判断，不能使用生成别名绕过限制。

生成遵守当前用户指定的通道、禁用供应商与次数限制，并实时核对模型和接口。如果上游 OpenChatCut 尚未适配用户指定通道，不能把 LLM `baseUrl` 当成视频接口兼容，也不能切换供应商绕过要求。用户生成后的本地素材可导入 OpenChatCut 继续剪辑。

所有用户当前授权和全局规则优先。不读取、回显或在插件里存储模型 API 密钥。
