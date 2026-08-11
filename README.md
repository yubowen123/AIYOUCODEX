# Codex Sidebar Enhancer

一个面向 macOS Codex 桌面体验的本地侧栏增强工具。它为对话增加摘要、最近消息预览、双列卡片、项目标签搜索、最近使用排序和额度展示，同时不修改应用包或对话正文。

## 一行安装

在“终端”中粘贴并回车：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/yubowen123/codex-sidebar-enhancer/main/install.sh)"
```

安装器会自动：

1. 下载到 `~/Library/Application Support/Codex Sidebar Enhancer`；
2. 使用系统 Node.js，或 Codex/ChatGPT 桌面应用内置的 Node.js；
3. 安装用户级 LaunchAgent，登录和应用重启后自动恢复；若检测到桌面应用未带增强端口启动，会自动正常退出并重开一次；
4. 在 `~/Applications` 创建 **Codex Sidebar Enhancer.app** 启动器；
5. 打开启动器。首次启用时，如 Codex 正在运行，会重启一次以挂载增强界面。

以后可以照常打开 Codex/ChatGPT；后台增强会在缺少本地调试端口时自动纠正启动方式。也可从 Spotlight、访达的“应用程序”或 `~/Applications` 直接打开 **Codex Sidebar Enhancer**。注入器只连接 `127.0.0.1:9231`。

> 不想直接执行远程脚本？先[查看 install.sh](./install.sh)，或下载仓库后运行 `bash install.sh`。

## 一行卸载

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/yubowen123/codex-sidebar-enhancer/main/uninstall.sh)"
```

卸载会停止增强进程，并移除安装目录、用户级 LaunchAgent、启动器和增强日志，不会删除 Codex 对话或设置。

## 功能

- 每条对话直接展示核心总结。
- 原生悬浮预览增加核心总结、最近输入和最近输出；消息最多展示 3 行。
- 列表/卡片滑块支持鼠标和键盘切换，并记住选择。
- 同一文件夹内一行两张半透明卡片，固定展示名称、最后沟通时间、AI 总结和 3 个核心标签。
- 3 个标签分别提炼任务对象、工作类型和交付结果，过滤版本号、状态码及孤立工具名。
- “置顶 / 项目 / 最近”改为可访问的 Tab，一次只展示一个分组。
- “最近”内的对话按最后沟通时间降序排列；双列卡片按从左到右、从上到下阅读。
- 项目文件夹改为标签：按真实最近沟通时间降序排列，默认两行，可展开全部。
- 文件夹标签首位提供“全部”：汇总完整项目会话索引，并按最近一次请求或沟通时间跨文件夹排序。
- 搜索框可模糊搜索文件夹名和项目名，命中后直接展示对应文件夹。
- 搜索栏右侧的新建按钮始终绑定当前选中的文件夹；点击后进入该文件夹的项目创建页，“全部”视图不提供无归属新建入口。
- 顶部快捷入口改为图标卡片：隐藏“站点”和“插件”，新增“TV”；点击后像“项目管理”一样直接在 Codex 主工作区展开 DramaTV 个人项目页，不创建浏览器标签；其他原生入口保持原行为。
- 顶部搜索与活动按钮之间提供快捷入口设置：可显示或隐藏入口，也可用默认图标、名称、链接和“内置 / 浏览器”打开方式创建自定义入口；配置跨重启保留。
- 顶部展示 Codex 自身记录的真实剩余比例和重置时间，不自行估算额度。
- 每张对话卡片可用红、橙、绿三色标注“紧急且重要 / 紧急或重要 / 不紧急”，状态按对话保存。
- Taskboard 中处于执行中的项目卡片显示流动蓝色边框光晕；系统启用“减弱动态效果”时保留静态蓝色提示。
- “新对话”首页集中展示 Taskboard 中正在执行的项目；点击卡片直接进入关联对话。
- 项目执行完成后继续显示为“待查看”，首次点击后收起；钉住的项目跨状态、跨重启持续展示。

## 系统要求

- macOS 13 或更新版本；
- 已安装 Codex 或包含 Codex 工作区的 ChatGPT 桌面应用；
- 本地存在 `~/.codex` 会话目录；
- Node.js 22 或更新版本。安装器会优先复用系统 Node.js，没有时自动使用桌面应用内置 Node.js。

当前实现已在 Codex `26.803.41515` 对应界面结构上验证。Codex 大版本更新如果更改侧栏 DOM 锚点，可能需要同步升级本项目。

## 隐私与安全

- 只读访问 `~/.codex/session_index.jsonl` 与 `~/.codex/sessions`；
- 不修改 `/Applications/ChatGPT.app`、`/Applications/Codex.app`、`app.asar` 或对话数据；
- 不开启对外 HTTP 服务，不上传对话、额度或标签；
- CDP 只使用回环地址 `127.0.0.1:9231`；
- TV 只嵌入固定的 `https://dz-ailab.dzkjm.cn/canvas/projects?category=personal`，使用受限 iframe；仅在 TV 面板打开期间由本地宿主放行嵌入所需的内容安全策略，关闭或切换页面后立即恢复；
- 安装内容完全位于当前用户目录，可通过卸载脚本完整移除。

## 更新与排查

更新时重新运行安装命令即可。安装器会原子替换旧版本，并迁移早期 `com.yubowen.codex-conversation-preview` LaunchAgent。

日志位置：

```text
~/Library/Logs/CodexSidebarEnhancer/injector.log
~/Library/Logs/CodexSidebarEnhancer/injector.error.log
```

如果增强没有出现：

1. 等待约 10 秒，后台增强会自动纠正一次普通启动；
2. 仍未出现时退出 Codex/ChatGPT，再打开 `~/Applications/Codex Sidebar Enhancer.app`；
3. 查看上述日志。

## 本地开发

```bash
git clone https://github.com/yubowen123/codex-sidebar-enhancer.git
cd codex-sidebar-enhancer
npm install
npm test
npm run inject
```

实时界面验收脚本需要已用 `9231` 端口启动的 Codex：

```bash
node scripts/verify-shortcut-grid.mjs
node scripts/verify-shortcut-settings-click.mjs
node scripts/verify-tv-panel.mjs
node scripts/verify-section-tabs.mjs
node scripts/verify-folder-switcher.mjs
node scripts/verify-card-view.mjs
node scripts/verify-card-status.mjs
node scripts/verify-reload-persistence.mjs
node scripts/verify-home-projects.mjs
```

## License

[MIT](./LICENSE)
