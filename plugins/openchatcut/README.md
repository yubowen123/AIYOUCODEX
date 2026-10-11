# AIYOUcodex OpenChatCut 插件

此包使用便携 Node.js stdio MCP 接入 AIYOUcodex 本地剪辑控制器。OpenChatCut 应用按需在设置或左侧工具入口一键安装，不随 AIYOUcodex 安装包重复分发。

`openchatcut_status` 在未安装应用时仍可发现；开始剪辑后动态透传当前上游 MCP 完整工具目录。每个对话绑定独立工程，草稿编辑默认自动应用，右侧嵌入真实编辑器并实时同步。生成和发布按控制器白名单及用户规则处理。

在 Codex 对话里直接提出剪辑修改，理解、规划、工作流与工具调用由 Codex 完成。受控嵌入视图隐藏 OpenChatCut 的 Agent 聊天列，保留素材、预览、时间线、片段属性与工具设置；独立打开的官方应用不受影响。六类工作流和快捷动作策略见 `skills/edit-video/references/workflows.md`。转写、生成等媒体模型仍需相应资源和用户授权，不把提示模板当作已经执行的功能。

本地路径浏览和导入由控制器适配普通嵌入面板，保留 OpenChatCut 的 `AGENT_IMPORT_ROOTS` 目录限制。导入使用上游单次上传槽、精确字节与 SHA-256 回执、媒体探针和 finalize 协议，数据仅发送到已验证的本地 loopback 服务；云存储启用或状态未知时停止。无需给网页提供通用桌面 IPC 权限。

服务发现默认使用 `$CODEX_HOME/openchatcut/controller.json`（未设置时 `~/.codex/openchatcut/controller.json`），仅当前用户可读取，里面是随机本地连接凭证；插件不包含模型密钥。运行服务必须由 AIYOUcodex 启动，插件不会自行启动竞争的第二个控制器。

OpenChatCut 是独立项目，源码受 AGPL-3.0 许可约束，Remotion 另有许可条款。此包引用官方安装发行版并保留其软件归属。
