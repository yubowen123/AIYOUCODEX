# AIYOUcodex

AIYOUcodex 是一套面向 macOS 与 Windows Codex 桌面体验的本地交互工作台。它为对话增加摘要、最近消息预览、双列卡片、项目标签搜索、最近使用排序和额度展示，并默认集成本地项目管理看板、Skills 分组和多媒体资产库，同时不修改应用包或对话正文。

GitHub 开源地址：[https://github.com/yubowen123/AIYOUCODEX](https://github.com/yubowen123/AIYOUCODEX)

![AIYOUcodex 全项目核心能力知识卡片](.github/assets/AIYOUcodex-core-capabilities-4K.png)

当前发行版：**v1.4.0**。项目管理、Skills 分组、本地资产库、快捷入口设置及对应的 macOS/Windows 后台运行时会作为同一安装包更新，不需要分别安装。

v1.4.0 将菜单功能统一为不打断对话的右侧面板：可以直接在项目对话里搜索项目、Skills 或资产，并把 Skill 与本地资产安全预填到当前输入框，不会自动发送。

## Windows 一行安装

在 PowerShell 中粘贴并回车：

```powershell
irm https://raw.githubusercontent.com/yubowen123/AIYOUCODEX/main/install.ps1 | iex
```

Windows 安装器会自动：

1. 安装到兼容目录 `%LOCALAPPDATA%\Codex Sidebar Enhancer`，升级时复用已有配置与数据；
2. 优先复用 Node.js 22.5+；本机缺少时，从 Node.js 官网下载对应架构的便携版 Node 22，并校验 SHA-256；
3. 安装固定版本的本地项目管理看板、Skills 分组层和资产控制台，并在当前用户的“启动”目录创建隐藏后台运行时快捷方式，登录后自动恢复；
4. 在开始菜单创建 **AIYOUcodex** 启动器，并自动移除旧名称的启动快捷方式；
5. 用本地回环调试端口启动 Codex/ChatGPT。首次启用时，如果应用正在运行，会先询问是否重启一次。

以后可照常打开 Codex/ChatGPT；后台注入器发现普通启动没有增强端口时，会自动纠正启动方式。无需管理员权限。

> 不想直接执行远程脚本？先[查看 install.ps1](./install.ps1)，或下载仓库后在 PowerShell 运行 `.\install.ps1`。

## macOS 一行安装

在“终端”中粘贴并回车：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/yubowen123/AIYOUCODEX/main/install.sh)"
```

安装器会自动：

1. 下载到兼容目录 `~/Library/Application Support/Codex Sidebar Enhancer`，升级时复用已有配置与数据；
2. 使用系统 Node.js，或 Codex/ChatGPT 桌面应用内置的 Node.js；
3. 安装固定版本的本地项目管理看板、Skills 分组层、资产控制台和用户级 LaunchAgent，登录和应用重启后自动恢复；后台默认不会因为连接暂时不可用而退出或重启 Codex；
4. 在 `~/Applications` 创建 **AIYOUcodex.app** 启动器，并自动移除旧名称的启动器；
5. 打开启动器。首次启用时，如 Codex 正在运行，会重启一次以挂载增强界面。

以后建议从 Spotlight、访达的“应用程序”或 `~/Applications` 打开 **AIYOUcodex**，让启动器配置增强端口。直接打开 Codex/ChatGPT 时，后台会连接已就绪的窗口；若缺少调试端口，默认保留当前对话并等待通过启动器重新打开。注入器只连接 `127.0.0.1:9231`。

> 不想直接执行远程脚本？先[查看 install.sh](./install.sh)，或下载仓库后运行 `bash install.sh`。

## 一行卸载

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/yubowen123/AIYOUCODEX/main/uninstall.ps1 | iex
```

macOS 终端：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/yubowen123/AIYOUCODEX/main/uninstall.sh)"
```

卸载会停止增强进程，并移除本工具的安装目录、当前用户自启动项、启动器和增强日志，不会删除 Codex 对话或设置。

## 功能

- 每条对话直接展示核心总结。
- 原生悬浮预览增加核心总结、最近输入和最近输出；消息最多展示 3 行。
- 列表/卡片滑块支持鼠标和键盘切换，并记住选择。
- 同一文件夹内一行两张半透明卡片，固定展示名称、最后沟通时间、AI 总结和 3 个核心标签。
- 3 个标签分别提炼任务对象、工作类型和交付结果，过滤版本号、状态码及孤立工具名。
- “置顶 / 项目 / 最近 / 中断”改为同一行的可访问 Tab，一次只展示一个分组；主动停止、重启或关闭造成的未完成对话统一进入“中断”。
- “最近”内的对话按最后沟通时间降序排列；双列卡片按从左到右、从上到下阅读。
- 项目文件夹改为标签：按真实最近沟通时间降序排列，默认两行，可展开全部。
- 文件夹标签首位提供“全部”：汇总完整项目会话索引，并按最近一次请求或沟通时间跨文件夹排序。
- 搜索框可模糊搜索文件夹名和项目名，命中后直接展示对应文件夹。
- 搜索栏右侧的新建按钮始终绑定当前选中的文件夹；点击后进入该文件夹的项目创建页，“全部”视图不提供无归属新建入口。
- 项目管理、Skills 分组、资产控制台和内置自定义入口统一在可拖动调宽的右侧面板打开，切换功能时互斥收起，当前对话、滚动位置和输入框始终保留；本机专属入口由仓库外配置管理，公开包不携带任何本机配置。
- 在当前对话输入“项目管理，帮我找下管理优化”“Skills 帮我找下知识卡片”或“资产控制台，帮我找下角色”等指令，可自动打开对应面板并带入检索词。
- “项目管理”随安装包提供：右侧打开本地 Taskboard，支持按项目名定位，并保留跨项目六泳道、紧急状态、文件夹过滤、项目描述、进度和下一步规划。
- “Skills 分组”直接读取本机已安装 Skill，按视频创作、导演镜头、画面风格、资产工作台、写作研究和工具管理分类；支持搜索、常用收藏，以及右键或“+”添加原生 Skill 引用到当前输入框。
- “资产控制台”在右侧打开纯本地多媒体资产库。每个项目可关联一个或多个文件夹并递归扫描，自动归类文本、图片、音频和视频；支持子分类、标签、项目内搜索、排序及 1–8 列自适应布局。
- 资产控制台使用本地零 Token 规则进行智能整理：自动将图片分为“正式资产 / 待确认 / 干扰项”，识别角色、场景、道具、分镜、视频解析帧、缩略图和联系表，并展示自动标签、置信度与判断原因；人工修改始终优先，干扰项不会被自动删除。
- “待确认”资产可直接设置正式分类和手动标签；人工选择会持久保存，并覆盖后续本地规则判断。
- Codex 生成图片、视频或音频时会记录对应提示词；在资产控制台放大有关联的媒体时，左侧展示资产，右侧展示提示词、模型、生成器和参考信息。
- 以图片、视频或音频制作为目的的 Codex 项目会自动关联到资产控制台，并约每 8 秒增量同步新增文件夹；手工名称、附加文件夹和排除设置不会被自动覆盖，普通代码项目和含糊的共享目录不会误导入。
- 文本、图片、音频和视频资产双击即可添加本地引用到当前对话输入框，不自动发送；卡片“••• → 预览”保留放大、关联提示词查看和文本编辑能力。
- 文本资产以可滚动卡片展示，可在预览中编辑保存受支持编码的 Markdown、TXT；DOCX、RTF 和旧式 `.doc` 保留只读预览或元数据，不通过纯文本保存破坏富文档原件。
- 图片和视频采用瀑布流，音频与视频支持悬停播放，视频支持全屏；卡片展示名称、大小、尺寸或时长及标签。
- 所有资产支持重命名和逻辑移动项目；永久删除需要输入完整文件名二次确认，操作直接删除本机真实文件且不可撤销。
- 顶部搜索与活动按钮之间提供快捷入口设置：可显示或隐藏入口，也可用默认图标、名称、链接和“内置 / 浏览器”打开方式创建自定义入口；配置跨重启保留。
- 顶部展示 Codex 自身记录的真实剩余比例和重置时间，不自行估算额度。
- 每张对话卡片默认保持“未标记”；用户主动选择后，才用红、橙、绿三色标注“紧急且重要 / 紧急或重要 / 不紧急”。颜色状态按对话保存，清除后恢复未标记。
- 打开历史任务时，会把本地会话文件中仍可见的用户与助手消息补回原生对话流，同时过滤系统说明、工具调用和内部传输内容，不建立覆盖式历史页面。
- 项目管理内置的是 2026-08-31 已验证的定制 Taskboard 快照，不是上游通用界面；保留跨项目六泳道、侧边调宽、Codex 对话联动、当前项目、待查看与钉住等能力。安装时不现场编译，看板和侧栏由同一后台运行时守护。
- Codex 短暂重绘侧栏时会保留搜索、筛选和 Tab，并等待原生数据恢复；只有锚点持续缺失才完整撤销对应增强区，避免半加载、错位或不可点击。

## 系统要求

- macOS 13+，或 Windows 10/11；
- 已安装当前 Codex 或包含 Codex 工作区的 ChatGPT 桌面应用；[OpenAI 官方桌面应用](https://openai.com/index/introducing-the-codex-app/)支持 macOS 与 Windows；
- 本地存在 `~/.codex` 会话目录；
- Node.js 22.5 或更新版本。macOS 安装器会复用系统或桌面应用内置 Node.js；Windows 缺少 Node 时会安装经过 SHA-256 校验的便携 Node 22 运行时到本工具目录。

当前实现已在 Codex `26.901.41600` 的 macOS 界面进行定向验证，并有 macOS/Windows 自动测试；这不等于 Windows 桌面和所有版本已实机验收。Codex 更新如果更改侧栏 DOM 锚点，可能需要同步升级本项目。

## 隐私与安全

- 只读访问 `~/.codex/session_index.jsonl` 与 `~/.codex/sessions`；
- 不修改 `/Applications/ChatGPT.app`、`/Applications/Codex.app`、`app.asar` 或对话数据；
- 项目管理 HTTP 服务从 `127.0.0.1:47823` 开始选择可用回环端口；端口被其他本地服务占用时会自动顺延，不向局域网或公网开放，也不上传对话、额度或标签；
- 资产控制台从 `127.0.0.1:5177` 开始选择可用回环端口，API 使用独立随机令牌；内嵌页面通过一次性私有沙箱路径转发，并限制为对应 iframe；
- CDP 只使用回环地址 `127.0.0.1:9231`；
- 安装内容完全位于当前用户目录，可通过对应平台的卸载脚本完整移除；Windows 不创建管理员级服务或系统级注册表项。

## 更新与排查

更新时重新运行安装命令即可。安装器会原子替换旧版本，并迁移旧名称启动器及早期 `com.yubowen.codex-conversation-preview` LaunchAgent。为保证无损升级，安装目录、数据目录、LaunchAgent label 和内部消息协议继续沿用既有兼容标识；这不会影响界面及启动器统一显示为 AIYOUcodex。Taskboard 数据独立保存在用户数据目录，更新安装包不会覆盖已有项目和任务。

macOS 日志位置：

```text
~/Library/Logs/CodexSidebarEnhancer/injector.log
~/Library/Logs/CodexSidebarEnhancer/injector.error.log
```

Windows 日志位置：

```text
%LOCALAPPDATA%\CodexSidebarEnhancer\Logs\injector.log
%LOCALAPPDATA%\CodexSidebarEnhancer\Logs\injector.error.log
```

如果增强没有出现：

1. 等待约 10 秒，后台增强会自动连接已开放调试端口的 Codex 窗口；
2. 仍未出现时，先保存当前工作，再退出 Codex/ChatGPT，打开 macOS 的 `~/Applications/AIYOUcodex.app`，或 Windows 开始菜单中的 **AIYOUcodex**。默认不因端口故障自动退出正在使用的 Codex；
3. 在安装目录运行 `node scripts/doctor.mjs --strict`，检查包、服务和每个窗口的实际组件状态；不加 `--strict` 只验证安装包完整性，不能作为运行成功证明；
4. 查看上述日志。

### 更新适配与故障保护

- 窗口有独立的文档代次与组件健康状态。重新加载后重新交付数据；同一页面连接短暂中断不会销毁整个界面。未知布局按组件降级，不通过不断重启 Codex 猜测修复。
- 侧栏与项目管理常驻注入器的初次附着、健康检查重试和重连均不刷新宿主页面；资产面板按窗口保存打开意图，在真正重载且桥接就绪后恢复一次。用户主动关闭或后来打开其他面板优先，不抢占聊天焦点。
- 界面快照合并更新，未变化的数据不重绘；原生菜单通过代理触发，不搬走 React 管理的按钮。快捷入口、标签与搜索分别报告健康状态。
- 资产优先读取持久索引，服务启动后后台补偿离线变化，运行时按变化文件同步。切换项目的过期请求不能覆盖当前项目，未变化的媒体卡片保持节点。
- 新资产界面使用服务端分页，每次读取 120 条、驻留最多 240 张卡片；搜索、分类与排序覆盖整个已索引项目，不局限于当前页。元数据校准设有单根目录 100,000 条候选预算，超限报告待校准并保留旧记录，不把截断当作删除。
- 音视频仅在播放时加载，离开后释放；嵌入通道分段传输并限制并发和响应大小，避免整段大视频转成内存中的 Base64。文件断开或流读取失败不会直接退出整个服务。
- MD/TXT 编辑使用版本校验与恢复备份。DOCX/DOC/RTF 目前只读，避免纯文本保存破坏原文排版、图片和表格；富文档无损编辑尚未实现。
- 安装器验证新包并保留旧运行时目录，路径在安装输出中显示。旧目录只是恢复副本，不代表已通过功能验收；数据目录仍独立保存。需要恢复时，以该目录为 `CODEX_SIDEBAR_SOURCE_DIR` 重新执行安装器，勿删除资产或项目数据。
- 自动测试包含真实隔离浏览器点击、界面空闲不自激、项目请求乱序、离线索引补偿和文件编辑保护。CI 必须有 Chrome/Chromium，不能静默跳过交互回归。

当前仍需人工验收未见过的 Codex 布局，以及真实 Windows 界面和大规模资产库。资产索引仍为原子 JSON 快照；合并写入与增量解析降低开销，但不等同于逐资产数据库更新。

## 本地开发

```bash
git clone https://github.com/yubowen123/AIYOUCODEX.git
cd AIYOUCODEX
npm install
npm test
npm run runtime
```

Windows 本地安装测试：

```powershell
$env:CODEX_SIDEBAR_SOURCE_DIR = (Get-Location).Path
.\install.ps1
```

实时界面验收脚本需要已用 `9231` 端口启动的 Codex：

```bash
node scripts/verify-shortcut-grid.mjs
node scripts/verify-project-management.mjs
node scripts/verify-workspace-enhancements.mjs
node scripts/verify-shortcut-settings-click.mjs
node scripts/verify-section-tabs.mjs
node scripts/verify-folder-switcher.mjs
node scripts/verify-card-view.mjs
node scripts/verify-card-status.mjs
node scripts/verify-reload-persistence.mjs
node scripts/verify-complete-history.mjs --thread-id <conversation-uuid> --min-users 1 --expect "公开可验证短句"
node scripts/verify-asset-console-platform.mjs
node scripts/verify-local-asset-manager.mjs
```

## License

[MIT](./LICENSE)
