# macOS 完整离线安装包

在「关于本机」查看处理器：显示 **英特尔 / Intel** 就选 `intel-x64`，显示 **Apple 芯片（M 系列）** 就选 `apple-silicon-arm64`。两种安装包均需 macOS 14 或更新版本。先安装并登录[官方 ChatGPT 桌面端](https://chatgpt.com/download/)（[系统要求](https://help.openai.com/en/articles/9275200-downloading-the-chatgpt-macos-app)），再解压对应的 ZIP，双击 `安装 AIYOUcodex.command`。安装完成后从 Spotlight 或 `~/Applications/AIYOUcodex.app` 启动。

[GitHub Actions](https://github.com/yubowen123/AIYOUCODEX/actions/workflows/macos-offline.yml) 里，成功的构建提供两种 ZIP 和各自的 SHA-256 校验文件。下载 Actions 构建产物需要登录 GitHub。

原生 OpenAI Codex/ChatGPT 桌面应用及登录由用户提供，不复制其账户或许可证。AIYOUcodex 的核心增强安装无需联网下载 Node、npm 或源码；后续模型使用仍需网络和用户自己的账户。Claude 依赖及 CLI 随包提供，Claude 登录、竞技场 API 配置和额度不随包提供。首次采用对话保存规则时，在原生 `/hooks` 中审阅信任 AIYOUCODEX 处理器。

安装创建当前用户的后台恢复、登录启动、RSS 与主题服务，自动注册机甲控制舱和粉嫩软糖。已有自定义主题和设置保留。主题生成 Skill 在目标不存在时安装到 Codex 的 skills 目录，已有同名 Skill 不覆盖。卸载增强工具保留原生对话、任务数据和已安装 Skill。

构建必须指定单独的新输出目录及对应架构的 macOS Node 二进制和许可证。Intel 示例（Apple Silicon 将架构改为 `arm64` 并替换对应 Node 文件）：

```sh
node scripts/build-macos-offline.mjs \
  --arch x64 \
  --output /path/to/new/AIYOUcodex-macos-intel-x64 \
  --node-runtime /path/to/node-darwin-x64/bin/node \
  --node-license /path/to/node-darwin-x64/LICENSE
```

构建通过目标架构的 Node 安装 `package-lock.json` 锁定的生产依赖，不运行 npm 安装脚本。默认用离线缓存；可用 `--online` 允许构建时下载依赖，最终 ZIP 安装始终离线。构建会检查 Node 与 Claude CLI 的 Mach-O 架构；安装前验证 SHA-256 和 Mac 芯片类型，依赖阶段再次核对架构、锁文件与关键包版本。后台和启动器使用安装目录中的 Node，删除解压目录后依然能够运行。

公开源码的普通安装流程保留；只有完整包入口设置 `CODEX_SIDEBAR_PREBUNDLED=1` 时才使用随包依赖。内部安装器的离线验收可指定隔离的用户目录，关闭真实 launchctl 激活和应用打开；这不能代替另一台机器、登录重启或用户模型登录的实测。
