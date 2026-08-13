# Codex Sidebar Enhancer

一个面向 macOS 与 Windows Codex 桌面体验的本地侧栏增强工具。它为对话增加摘要、最近消息预览、双列卡片、项目标签搜索、最近使用排序和额度展示，并默认集成可直接打开的本地项目管理看板，同时不修改应用包或对话正文。

当前发行版：**v1.2.0**。项目管理、Skills 分组、资产控制台、快捷入口设置及对应的 macOS/Windows 后台运行时会作为同一安装包更新，不需要分别安装。

## Windows 一行安装

在 PowerShell 中粘贴并回车：

```powershell
irm https://raw.githubusercontent.com/yubowen123/codex-sidebar-enhancer/main/install.ps1 | iex
```

Windows 安装器会自动：

1. 安装到 `%LOCALAPPDATA%\Codex Sidebar Enhancer`；
2. 优先复用 Node.js 22.5+；本机缺少时，从 Node.js 官网下载对应架构的便携版 Node 22，并校验 SHA-256；
3. 安装固定版本的本地项目管理看板、Skills 分组层和资产控制台，并在当前用户的“启动”目录创建隐藏后台运行时快捷方式，登录后自动恢复；
4. 在开始菜单创建 **Codex Sidebar Enhancer** 启动器；
5. 用本地回环调试端口启动 Codex/ChatGPT。首次启用时，如果应用正在运行，会先询问是否重启一次。

以后可照常打开 Codex/ChatGPT；后台注入器发现普通启动没有增强端口时，会自动纠正启动方式。无需管理员权限。

> 不想直接执行远程脚本？先[查看 install.ps1](./install.ps1)，或下载仓库后在 PowerShell 运行 `.\install.ps1`。

## macOS 一行安装

在“终端”中粘贴并回车：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/yubowen123/codex-sidebar-enhancer/main/install.sh)"
```

安装器会自动：

1. 下载到 `~/Library/Application Support/Codex Sidebar Enhancer`；
2. 使用系统 Node.js，或 Codex/ChatGPT 桌面应用内置的 Node.js；
3. 安装固定版本的本地项目管理看板、Skills 分组层、资产控制台和用户级 LaunchAgent，登录和应用重启后自动恢复；若检测到桌面应用未带增强端口启动，会自动正常退出并重开一次；
4. 在 `~/Applications` 创建 **Codex Sidebar Enhancer.app** 启动器；
5. 打开启动器。首次启用时，如 Codex 正在运行，会重启一次以挂载增强界面。

以后可以照常打开 Codex/ChatGPT；后台增强会在缺少本地调试端口时自动纠正启动方式。也可从 Spotlight、访达的“应用程序”或 `~/Applications` 直接打开 **Codex Sidebar Enhancer**。注入器只连接 `127.0.0.1:9231`。

> 不想直接执行远程脚本？先[查看 install.sh](./install.sh)，或下载仓库后运行 `bash install.sh`。

## 一行卸载

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/yubowen123/codex-sidebar-enhancer/main/uninstall.ps1 | iex
```

macOS 终端：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/yubowen123/codex-sidebar-enhancer/main/uninstall.sh)"
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
- 顶部内置快捷入口默认完整展示为图标卡片；“项目管理”随安装包提供，点击后在 Codex 主工作区打开本地 Taskboard；公共版不包含私有 TV 入口。
- “Skills 分组”作为内置快捷入口：进入原生技能页后按视频创作、导演镜头、画面风格、资产工作台、写作研究和工具管理分类，支持搜索、常用收藏和切回完整原生列表。
- “资产控制台”作为内置快捷入口：在 Codex 主区域内打开本机资产工作台，保留项目/文件夹管理、移动整理和将本地绝对路径附加到当前输入框的能力，不自动发送消息。
- 顶部搜索与活动按钮之间提供快捷入口设置：可显示或隐藏入口，也可用默认图标、名称、链接和“内置 / 浏览器”打开方式创建自定义入口；配置跨重启保留。
- 顶部展示 Codex 自身记录的真实剩余比例和重置时间，不自行估算额度。
- 每张对话卡片默认保持“未标记”；用户主动选择后，才用红、橙、绿三色标注“紧急且重要 / 紧急或重要 / 不紧急”。颜色状态按对话保存，清除后恢复未标记。
- 项目管理内置的是 2026-08-13 已验证的定制 Taskboard 快照，不是上游通用界面；保留跨项目六泳道、拖拽调宽、Codex 对话联动、当前项目、待查看与钉住等能力。安装时不现场编译，看板和侧栏由同一后台运行时守护。
- Codex 短暂重绘侧栏时会保留搜索、筛选和 Tab，并等待原生数据恢复；只有锚点持续缺失才完整撤销对应增强区，避免半加载、错位或不可点击。

## 系统要求

- macOS 13+，或 Windows 10/11；
- 已安装当前 Codex 或包含 Codex 工作区的 ChatGPT 桌面应用；[OpenAI 官方桌面应用](https://openai.com/index/introducing-the-codex-app/)支持 macOS 与 Windows；
- 本地存在 `~/.codex` 会话目录；
- Node.js 22.5 或更新版本。macOS 安装器会复用系统或桌面应用内置 Node.js；Windows 缺少 Node 时会安装经过 SHA-256 校验的便携 Node 22 运行时到本工具目录。

当前实现已在 Codex `26.803.61601` 对应界面结构上验证。Codex 大版本更新如果更改侧栏 DOM 锚点，可能需要同步升级本项目。

## 隐私与安全

- 只读访问 `~/.codex/session_index.jsonl` 与 `~/.codex/sessions`；
- 不修改 `/Applications/ChatGPT.app`、`/Applications/Codex.app`、`app.asar` 或对话数据；
- 项目管理 HTTP 服务从 `127.0.0.1:47823` 开始选择可用回环端口；端口被其他本地服务占用时会自动顺延，不向局域网或公网开放，也不上传对话、额度或标签；
- 资产控制台从 `127.0.0.1:5177` 开始选择可用回环端口，API 使用独立随机令牌；内嵌页面通过一次性私有沙箱路径转发，并限制为对应 iframe；
- CDP 只使用回环地址 `127.0.0.1:9231`；
- 安装内容完全位于当前用户目录，可通过对应平台的卸载脚本完整移除；Windows 不创建管理员级服务或系统级注册表项。

## 更新与排查

更新时重新运行安装命令即可。安装器会原子替换旧版本，并迁移早期 `com.yubowen.codex-conversation-preview` LaunchAgent。Taskboard 数据独立保存在用户数据目录，更新安装包不会覆盖已有项目和任务。

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

1. 等待约 10 秒，后台增强会自动纠正一次普通启动；
2. 仍未出现时退出 Codex/ChatGPT，再打开 macOS 的 `~/Applications/Codex Sidebar Enhancer.app`，或 Windows 开始菜单中的 **Codex Sidebar Enhancer**；
3. 在安装目录运行 `node scripts/doctor.mjs`，确认固定资产、Node、Codex 调试端口和 Taskboard 服务状态；
4. 查看上述日志。

## 本地开发

```bash
git clone https://github.com/yubowen123/codex-sidebar-enhancer.git
cd codex-sidebar-enhancer
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
```

## License

[MIT](./LICENSE)
