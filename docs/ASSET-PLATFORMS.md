# 资产控制台：平台来源和关联提示词

从 AIYOUcodex 左侧打开「资产控制台」，在「平台来源」下选择平台。读取项目列表不会下载素材；选中项目并点击「同步下载」才开始下载，结束后可打开新建的本地素材项目。

| 平台 | 需要什么 | 支持范围 |
| --- | --- | --- |
| DramaTV | Codex CLI、已登录的 `dramatv-canvas` MCP | 个人和团队项目、主画布、分集与可读取的媒体节点。 |
| 即梦 | [官方 Dreamina CLI](https://dreamina.capcut.com/tools/dreamina-cli)，并在 CLI 登录 | CLI 可见创作会话及已完成任务；无归属的历史任务单列。 |
| NeoWOW | [NeoWOW 官方](https://neowow.cn/workflows) CLI，并在 CLI 登录 | 项目、画布和可读取的对应生成历史。 |
| LibTV | 本机已有 [官方插件](https://github.com/liblib-ai/marketplace) 导出的已解压目录 | 手动导入目录；尚未接通在线项目下载。 |
| TapNow | 本机已有 [TapNow](https://docs.tapnow.ai/zh/docs/mcp/add-a-custom-connector) 导出的已解压目录 | 手动导入目录；尚未接通在线项目下载。 |

平台下载默认保存在资产服务数据目录的 `platform-projects/<平台>/<项目名 · 短标识>/`，按返回的画布或分集分组。已有文件可跳过；失败不会抹去已成功下载的素材。只使用项目或平台实际返回的关联数据，不重生成素材，不向创作平台写回。签名链接用于取件，不长久保存在侧车资料中。

选中素材可看文件规格、项目归属、提示词、模型和来源；找不到原始记录时可手动关联。提示词读取既有登记、同名 `.meta.json` 或同名 `.prompt.md`；同名不同媒体有歧义时不做猜测。FFprobe 可用时可读更多编码、帧率、声音和时长信息；缺少 FFprobe 不影响已知文件资料与提示词。
