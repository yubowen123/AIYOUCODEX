# MOKE AIGC for AIYOUcodex

AIYOUcodex 提供的第三方集成，连接 MOKE 官方服务，不代表 MOKE 官方发布插件。

网站入口默认位于左侧菜单，通过 Codex 原生右侧浏览器打开。图标采用 MOKE 官网原始 Logo；可在快捷入口设置隐藏/显示。网站禁止 iframe 嵌入。

`plugin.json` / `mcp.json` 为可移植包；`.codex-plugin/plugin.json` / `.mcp.json` 为 Codex 兼容配置（包含官方公开 OAuth client_id 和只读 scopes）。账号凭证由 Codex 宿主保管，插件不含秘密。

安装：在 AIYOUcodex 根目录运行 `node scripts/install-bundled-plugins.mjs`。新安装也执行同样逻辑，保留现有插件、同名 MCP 配置和禁用偏好。授权：`codex mcp login moke --scopes openid,skill:read,prompt:read`。当前会话可能需要刷新插件工具发现或重新打开对话才能使用新增 Skill。

官方说明：https://www.mokeaigc.ai/mcp.html

2026-10-09 本机授权返回 `Authorization server response missing required issuer`。这是服务端 OAuth 回调与当前 Codex 校验的兼容问题；安装成功不代表已完成授权，不绕过安全校验。
