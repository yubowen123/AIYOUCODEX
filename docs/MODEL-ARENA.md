# 模型竞技场

把一次素材与提示词编排，交给多个视频或图片模型独立生成，再横向查看和本地合成。入口位于“资产控制台”之后，打开为右侧面板，再次点击同一入口或关闭按钮即可收起，不改变当前对话。

本模块于 2026-09-26 扩展为图片 / 视频双模式。公开协议映射、本地模拟测试与本机真实生成的验证范围分别列于文末，不混同为所有供应商和模式均已验收。

## 操作

1. API 与模型配置统一放在右上角，不再占用生成流程的第一步。视频模式配置 Seedance、Wan、H3；图片模式可按实际账号启用 OpenAI、阿里云百炼、火山方舟、Google、Stability AI 或 Black Forest Labs。模型默认不启用，生成页只展示已启用且具备模型 ID、API 域名的可用条目。
2. 在生成页切换“视频竞技”或“图片竞技”。未配置或已停用模型不占位；没有可用模型时只显示说明与配置入口。切换模式会分别记住各自的模型选择，不删除草稿素材。
3. 从本地添加素材，或从资产控制台按项目检索并导入。视频竞技接受图片、音频、视频；图片竞技只接受参考图片。导入是不可变副本，不移动源资产，也不向供应商上传。
4. 多选对比模型、比例、分辨率和视频时长，使用素材上的 `@` 按钮或输入框的引用候选编写提示词。共同限制取所有已选模型的交集；删除素材时同步重排引用，被删除的引用会明确标记。
5. 点击预览，核对模型、API 域名、素材数量、实际请求参数。此时只做配置、能力和素材校验，不创建生成任务。点击确认后才上传素材、创建生成任务；一次最多 3 个生成 POST 并发，不自动切换供应商。
6. 在结果页横向滚动比较。视频可选 2–6 条生成静音同屏或静音顺序拼接；图片可选 2–6 张生成本地网格拼接图。结果与拼接产物都可在系统文件管理器中定位。

同屏对比会保留宽高比并留黑边，统一为 24 fps、画布总宽 1920 像素、每排最多 3 个模型，时长对齐到最短片段；顺序拼接按勾选模型在结果中的顺序，保留每条完整时长。两种输出都没有音频轨道；模型标签使用内置位图字形，不依赖系统字体或 FFmpeg 的 drawtext 扩展。原视频不覆盖。

## 模型与共同约束

下表是当前客户端采用的输入校验范围，并非所有账号、平台模式的能力承诺。模型 ID 与请求协议必须匹配；供应商的账号权限、接口最新限制仍需核对。能力不足会明确报错，不偷偷降级。

| 模型 | 默认官方模型 ID | 秒数 | 分辨率 | 图片 / 视频 / 音频上限 |
| --- | --- | --- | --- | --- |
| Wan 3.0 | wan3.0-video | 2–30 | 480p / 720p / 1080p | 10 / 5 / 5 |
| Seedance 2.0 | dreamina-seedance-2-0-260128 | 4–15 | 480p / 720p / 1080p（参考图模式除外） | 9 / 3 / 3 |
| Seedance 2.0 Fast | dreamina-seedance-2-0-fast-260128 | 4–15 | 480p / 720p | 9 / 3 / 3 |
| Seedance 2.0 Mini | dreamina-seedance-2-0-mini-260615 | 4–15 | 480p / 720p | 9 / 3 / 3 |
| Seedance 2.5 | dreamina-seedance-2-5-260628 | 4–30 | 480p / 720p | 30 / 10 / 10 |
| MiniMax H3 | MiniMax-H3 | 4–15 | **768P / 2K** | 9 / 3 / 3 |

六个模型全选时：4–15 秒，最多 9 图、3 视频、3 音频，比例取共同支持范围。参考音频、视频分别累计不超过 15 秒，单条至少 2 秒；Wan 还要求输入视频总时长加输出时长不超过 30 秒。不同种类的额度不是互相替代。只有 Seedance 2.5 单独选中时允许仅音频参考。

当前共同文件上限为图片 30 MB、视频 50 MB、音频 15 MB；本地导入接口另有单文件 100 MB 硬上限。图片尺寸、比例、有效时长和缺失引用也会检查。文件格式目前接受 PNG/JPG/WebP、MP4/MOV、MP3/WAV。自定义限制只能缩小已验证上限。

### 图片模型目录

当前公开目录共 29 个条目，按六个供应商家族管理。目录用于配置和能力筛选，不代表本机账号已开通，也不代表所有历史型号仍建议新接入；旧版或待下线型号会在配置页标注。所有图片模型默认关闭，避免误请求或误计费。

| 家族 | 当前目录 |
| --- | --- |
| OpenAI | GPT Image 2.5 Sunburst / Flare、GPT Image 2、GPT Image 1 / Mini、DALL·E 3 |
| 阿里云百炼 | Qwen Image 3.0 Pro / 3.0 / 2.0 Pro、Wan 2.7 Image Pro / Image、Z-Image Turbo |
| 火山方舟 | Seedream 5.0 Pro / Flash / Lite、Seedream 4.5 / 4.0 |
| Google | Gemini 3.1 Flash Image / Flash Lite Image、Gemini 3 Pro Image、Gemini 2.5 Flash Image |
| Stability AI | Stable Image Core、Stable Diffusion 3.5 Large / Turbo |
| Black Forest Labs | FLUX.2 Max / Pro / Flex、FLUX Kontext Max / Pro |

图片模式只把所选模型共同支持的比例、分辨率和参考图数量暴露给用户；超出共同上限会在预览前阻止，不会删参考图或悄悄降低规格。纯文生图模型可不带参考图运行；不支持参考图的模型与带图任务组合时，共同上限会变为 0。

## API 配置与协议

公开包内置下列视频协议与六种图片协议。可以更改域名，但请求和响应必须兼容所选协议；不会把素材经另一家供应商中转。内部或专属通道通过仓库外的本地适配器提供，不随公开源码或安装包分发。

| 协议 | 创建 / 查询 | 素材方式 |
| --- | --- | --- |
| 火山方舟 | `/api/v3/contents/generations/tasks` / `…/{id}` | typed content；图片、音频可内联，视频需公开 URL 或已配置上传服务 |
| BytePlus LAS | `/api/v1/contents/generations/tasks` / `…/{id}` | typed content；图片、音频可内联，视频需公开 URL 或已配置上传服务 |
| MiniMax V2 | `/v2/video_generation` / `/v2/query/video_generation/{id}` | `/v1/files/upload`，purpose 为 video_generation_input；使用 mm_file 引用 |
| 阿里云百炼 Wan | `/api/v1/services/aigc/video-generation/video-synthesis` / `/api/v1/tasks/{id}` | input / parameters + 异步请求头；参考素材需公开 URL 或已配置上传服务 |

图片协议分别对接 OpenAI Images、阿里云百炼图片、火山方舟图片、Google Gemini Image、Stability AI 与 Black Forest Labs。图片返回既支持 HTTPS URL，也支持 Base64 内联结果；结果会下载到本机后再展示，浏览器不持有供应商签名地址。参考图优先使用各协议原生的内联或编辑接口，不借用其他供应商上传。

方舟模型 ID 使用自己账号已开通的模型/接入点，不自动猜测；百炼域名需填写工作区对应域名。BytePlus LAS 切换协议时提供已核对的默认模型 ID。官方 Seedance 2.0 提供 1080p，但当前参考图片模式会阻止 1080p 请求；H3 始终不提供 480/720/1080 选项。

可选上传服务必须与 API 同源，接受 multipart `file` 并返回 `url`、`data.url`、`data.fileUrl` 或 `data.file_url`。MiniMax 原生上传则保留 `file.file_id` 契约。未配置时，官方视频参考或 Wan 素材会在预览阶段给出缺项提示，不生成。手工绑定素材 URL 只接受不带签名和密钥的 HTTPS 公共地址。

凭证优先使用用户填入的当前通道临时 Key；否则按指定的凭证变量名读取环境变量，然后读取用户的私有 `~/.codex/keys.md`。没有填写凭证变量名时，不猜测或借用其他通道的凭证。临时 Key 只在当前后台进程内，重启后需重填，不保存到配置 JSON、浏览器存储或仓库。变更临时凭证会让旧预览失效；已经确认但尚未提交完的 API 分组需等待提交结束后再更换凭证。应在增强进程启动环境配置变量，终端里刚设置的变量不一定被已运行的后台进程继承。

视频契约来源（2026-09-12 核对）：[BytePlus LAS](https://docs.byteplus.com/en/docs/Byteplus_LAS/video_gen_enhanced)、[Wan 3.0](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/wan3-video-generation-api-reference)、[MiniMax H3 接口入口](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise)。图片目录与协议于 2026-09-26 按 [OpenAI Images](https://developers.openai.com/api/docs/guides/image-generation)、[阿里云百炼图片模型](https://help.aliyun.com/zh/model-studio/image-model)、[火山方舟图片生成](https://docs.volcengine.com/docs/ark/image-generation-api?lang=en)、[Google Gemini Image](https://ai.google.dev/gemini-api/docs/image-generation)、[Stability AI](https://platform.stability.ai/docs/api-reference) 与 [Black Forest Labs](https://docs.bfl.ai/quick_start/generating_images) 官方文档核对。实际模型 / 接入点 ID 仍以自己账号已开通能力为准。

## 持久化与资源

- 模型配置、导入素材副本、平台任务 ID、图片/视频结果和本地拼接产物保存在资产控制台数据目录下的 `model-arena`，不写进应用安装目录。关闭面板不会清空任务。
- 本地任务先落盘再执行，重复点击同一确认令牌只返回原任务。生成 POST 超时、响应丢失或提交期间重启后进入“提交结果待核对”，不自动再次生成。只有填写平台已有任务 ID 后才恢复查询。
- 查询失败退避重试，连续多次失败后暂停；下载失败仅重试查询/下载，不重复生成。后台整体重启后，首次访问竞技场恢复已有记录与待处理队列；临时凭证需重新提供。
- 历史记录每次读取 50 条；素材元数据上限 500 条，视频按需加载，不预加载整个结果库。媒体桥接按范围分段读取，不一次性把大视频转成 Base64。
- 当前素材池没有清理管理页，达到 500 个时停止新增，现有素材可继续用；不要直接删除状态 JSON。完整素材生命周期管理是后续优化项。
- 本机需可执行 `ffmpeg` 与 `ffprobe`，或通过 `AIYOU_FFMPEG` / `AIYOU_FFPROBE` 指定路径。安装包不附带这两个工具，也不自动下载。macOS Homebrew 常用位置会自动探测；Windows 可配置 PATH 或明确路径。

## 验证范围

自动测试覆盖模型公共限制、H3 两档分辨率、视频与图片协议请求映射、本地适配器隔离、旧配置迁移、凭证读写边界、预览与确认幂等、提交不明恢复、分片素材导入和持久化异常。隔离 Chrome 使用本地模拟提供商验证视频与图片模式切换、未配置模型不展示与空状态配置入口、图片双模型结果、真实 FFmpeg 图片网格与视频合成、重复确认不重复提交、刷新后记录保留和窄面板布局。

2026-09-12 另通过独立的本机适配器进行了六模型纯文本实测：每个模型请求 5 秒、16:9，五个模型使用 480p 档位、H3 使用 768P。六个真实任务均成功生成、自动下载并通过完整解码；通过竞技场合成的六路静音同屏视频为 1920×720、5 秒、无音轨。

本机适配器、身份、凭证、远端任务 ID 和原始测试记录不随公开包分发。这轮实测不等于四种公开官方协议均完成了付费测试，也不覆盖全部分辨率、参考素材模式或成片质量；实际账号权限和模型能力以配置的供应商为准。
