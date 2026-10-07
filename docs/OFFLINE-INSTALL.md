# 完整离线安装包（macOS Apple Silicon）

该安装包在源码之外附带可迁移的 Node 与锁定生产依赖。解压后双击 `安装 AIYOUcodex.command`，安装完成后从 Spotlight 或 `~/Applications/AIYOUcodex.app` 启动。当前构建针对 Apple Silicon、macOS 13.5 及以上。

原生 OpenAI Codex/ChatGPT 桌面应用及登录由用户提供，不复制其账户或许可证。AIYOUcodex 的核心增强安装无需联网下载 Node、npm 或源码；后续模型使用仍需网络和用户自己的账户。Claude 依赖及 CLI 随包提供，Claude 登录、竞技场 API 配置和额度不随包提供。首次采用对话保存规则时，在原生 `/hooks` 中审阅信任 AIYOUCODEX 处理器。

安装创建当前用户的后台恢复、登录启动、RSS 与主题服务，自动注册机甲控制舱和粉嫩软糖。已有自定义主题和设置保留。主题生成 Skill 在目标不存在时安装到 Codex 的 skills 目录，已有同名 Skill 不覆盖。卸载增强工具保留原生对话、任务数据和已安装 Skill。

构建必须指定单独的新输出目录及合法分发的 Node 二进制/许可证。示例：

```sh
node scripts/build-macos-offline.mjs \
  --output /path/to/new/AIYOUcodex-v1.5.0-macOS-arm64 \
  --node-runtime /path/to/node \
  --node-license /path/to/LICENSE
```

构建从 Git 源文件集合复制当前代码，通过 npm 的离线缓存安装 package-lock.json 锁定的生产依赖，不运行安装脚本；不携带 Git 元数据、本机项目、个人配置或调用凭据。安装前验证 SHA-256，依赖阶段再次核对架构、锁文件与关键包版本。后台和启动器使用安装目录中的 Node，删除解压目录后依然能够运行。

公开源码的普通安装流程保留；只有完整包入口设置 `CODEX_SIDEBAR_PREBUNDLED=1` 时才使用随包依赖。内部安装器的离线验收可指定隔离的用户目录，关闭真实 launchctl 激活和应用打开；这不能代替另一台机器、登录重启或用户模型登录的实测。
