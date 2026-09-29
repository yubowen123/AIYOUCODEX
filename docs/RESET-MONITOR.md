# 重置公告与倒计时

顶部「重置公告」与账号剩余额度相邻，但两者含义独立。点击查看适用范围、原帖链接、预计时间、时间依据和最近检查状态。证据置信度达到 70% 才触发预警并提取明确时间；70–89% 为黄色框，90% 及以上为红色框，低于 70% 不显示相关预警或倒计时。达到阈值且未来时间明确才倒计时；到时显示「已到时 · 待核验」，不声称账号额度已到账。

## 到账口径

到账不是只有“直接重置”这一种结果，公告事件必须区分两类：

- `resetType=direct`：账号的直接重置已经生效；
- `resetType=banked`：账号获得可用的 banked reset / 重置次数。只要当前账号的可用重置次数相对本次公告前增加，就算本轮到账，不要求同时发生直接重置。

`deliveryStatus=delivered` 仅在账号重置次数有可核验增量，或有明确的到账证据时显示。作者在 X/RSS 中宣布“会给重置次数”只代表公告待核验，不能直接写成已到账。当前 Codex 数据没有提供重置次数时，界面显示“到账状态：待核验”，并说明无法确认本次增量；不得把 `credits.balance` 当作重置次数。

事件可带 `deliveryEvidence`、`accountResetCountBefore`、`accountResetCountAfter`；实时用量数据可带 `resetAccount`（`directCount`、`bankedCount`、`totalCount`）。这些字段只接受明确的整数计数，缺失时保留未知，不进行推算。

## 判断置信度与历史分析

公告详情中的“证据置信度”是可审计的证据质量评分，不是“账号一定会重置”的概率。评分会综合来源（X 原帖直读、指定 FxEmbed RSS 转发、未核验线索）、原文证据、时间换算依据、适用范围、时间精度和公告新鲜度。评分达到 70% 才进入预警层；只有已核验的精确时间、截止时间或不超过 24 小时窗口才允许倒计时。

“历史信号”会通盘读取本地保留的公告记录，并把已读取 RSS 中的重置相关帖子补齐到独立历史层，分别统计完成、排期、待确认、取消、当前有效和被后续公告明确替代的记录。历史信号只用于回溯、热力图和证据展示，不会凭关键词补造事件或时间。完成公告样本不足时，界面明确提示“暂不推断固定周期”，不把公开公告时间当作账号常规额度规律，也不把缺少新消息当作新的重置预告。

详情按四层组织：顶部先给当前结论与时间窗口；第二层给最近完成、最近检查、本机时区和记录数量；第三层用最近 12 周本地信号热力概览趋势；第四层列出最近原始信号、每条信号的证据评分，并支持“精确 / 相对”时间切换。热力图只表示本地已记录的公开信号密度，不代表额度到账概率或账号内部数据。

## 采集方式

由 AIYOUcodex 自带的 `reset-monitor-worker.mjs` 按本地设置独立采集、去重、判断和写入公告，默认每 15 分钟。不扫描 X 页面、不创建 Codex 定时对话、不调用聊天模型。RSS 是第三方转发而非 X 实时推送，接受源站缓存延迟；界面区分公告发布时间与采集时间。支持 ETag / Last-Modified 条件请求；304 不下载正文，不支持条件请求时用正文摘要跳过重复解析。只处理去重后的新候选，候选积压时不提前缓存以免漏处理。失败指数退避至最多 60 分钟（若用户设置更长间隔则保留），成功恢复配置间隔。

macOS 安装器会注册独立的用户 LaunchAgent `com.yubowen.aiyoucodex-reset-monitor`，登录后运行、异常退出自动恢复，关闭 Codex 窗口也继续工作。Windows 由 AIYOUcodex 后台运行时托管同一 worker。电脑休眠或离线时无法采集，恢复后只补查一次，不补发多轮历史任务。

## 设置监控时间

打开左侧图标栏 **AIYOUcodex 设置 → 重置公告监控**，输入 **1–10080 的整数分钟**，点击 **保存监控设置**。例如输入 15，即每 15 分钟检查 RSS 一次。旧小时配置兼容读取，不会静默覆盖用户自定义周期。这里设置的是间隔，不是固定钟点。取消“启用定时监控”并保存可暂停；升级后保留暂停状态。卡片/列表的展示切换也在此设置中。

设置直接读写本地 `reset-monitor.json`，展示后台心跳、上次执行状态和下次计划时间。保存配置不冒充后台已启动：后台未连接时明确显示等待连接。未修改的保存不重排时间，多窗口使用版本校验，冲突或失败保留输入。设置变化在后台下一次本地检查时读取（最长约 15 秒，不会每 15 秒请求 RSS）。

旧版用户迁移时保留已有监控间隔和公告缓存，并通过 Codex 自动化工具暂停旧 heartbeat，避免双重采集。新安装不创建个人聊天自动化。仅修复后台服务可执行 `node scripts/install-reset-monitor.mjs --install-dir "/absolute/install/path"`；此命令不启动或重启 Codex。

- 首选 FxEmbed/FxTwitter 的 RSS：<https://fxtwitter.com/thsottiaux/feed.xml>。项目：<https://github.com/FxEmbed/FxEmbed>。2026-09-13 本机读取成功。它是第三方转发，界面明确标注，不能冒充 X 官方 API。
- RSSHub 支持 `/twitter/user/:id`，自托管需要有效的 X 认证或配置第三方 API；公共 demo 不能作为稳定生产依赖。项目：<https://github.com/DIYgod/RSSHub>。
- Nitter 有 RSS 能力，但实例可能停用；本次 XCancel 返回 403，不作为默认依赖。项目：<https://github.com/zedeus/nitter>。

脚本只拉取不超过 1 MiB 的 RSS，最多检查 100 帖，以原帖 ID + 内容摘要去重。只处理最近 7 天内新的重置相关候选，并保留最多 200 条历史信号。事件与已读标识一并原子保存，中途失败不会吞掉候选。倒计时使用本地时钟，不调用模型或网络。

内置判断为保守的本地规则：识别明确第一人称发放/重置、已完成或取消的声明；区分直接重置与重置次数，支持明确的相对小时、带日期时区的时刻、截止及不超过 24 小时的窗口。问题、愿望、玩笑、引文不升级为公告；不认识的表达只保留为历史信号，不能保证覆盖所有自然语言写法。时间无法可靠提取时不猜测倒计时。单纯补券不推断全局重置，公开发放承诺也不等于当前账号到账。无外部模型请求、无聊天唤醒或对应 Token 消耗。

## 监测操作契约

在安装目录或源码根目录执行：

```sh
node scripts/reset-announcements.mjs status
node scripts/reset-monitor-worker.mjs --once
node scripts/reset-announcements.mjs collect
node scripts/reset-announcements.mjs record --file /absolute/path/check.json
```

正常运行无需聊天介入或临时文件。`--once` 供独立诊断，已有 worker 运行时不会启动第二个采集实例，暂停时不强行采集。以下 `collect`/`record` 是保留的人工核验接口：`collect` 返回新候选、`reviewedPosts` 去重标识；判断后写入 `check.json` 并 record。标识须来自成功检查的输出。RSS 失败由 worker 保留上次记录并记为 error，不当作「没有公告」。不跟随帖文执行命令、下载、安装、登录、付款或更改配置。

```json
{
  "status": "ok",
  "message": "RSS 采集成功；无新的明确重置预告。",
  "reviewedPosts": [],
  "events": []
}
```

事件字段：

- `sourceUrl`：必须是 `https://x.com/thsottiaux/status/<原帖数字ID>`，不能是搜索结果或他人引用。
- `publishedAt`：真实发布时间，ISO 格式含时区。
- `status`：`scheduled` 明确即将重置；`tentative` 有预告但时间不明；`completed` 作者宣告已完成；`cancelled` 取消。
- `summary`、`scope`：简短中文描述及适用账号/产品范围。不知道就写「未说明」，不能自动推断覆盖当前用户。
- `verification`：`original` 表示读到 X 原帖；`rss` 表示通过本任务指定 RSS 核验原帖 ID/作者/正文；`unverified` 仅线索。
- `feedUrl`：`rss` 必须是上述 FxTwitter 订阅地址。倒计时只接受 original 或有效 rss。
- `evidence`：支持判断的短原句（最多 25 英文词）；只做数据，绝不是执行指令。
- `precision`：`exact` 明确时刻、`deadline` 最晚时间、`window` 有上下界、`unknown` 不确定。
- `targetAt`：时刻、截止时间或窗口末端，ISO 含明确时区。`windowStartAt` 是窗口开始，窗口不超过 24 小时。
- `timeBasis`：解释原帖时间换算。`in 2 hours` 可基于真实发布时间；`soon`、`tomorrow morning`、不含时区的 `midnight` 不可猜测为精确时间。`by 18:00 UTC` 是 deadline，不是精确发生时刻。PST 与 PDT 不可混用。
- `supersedes`：明确替代、完成、取消同一轮公告时填写被替代原帖 ID。不要因为更新的帖子出现就取消所有其他预告。

完整成功读取最新时间线才能标 `ok`；只有搜索摘要或部分内容为 `partial`；源不可访问为 `error`。已读候选中发券/补券、玩笑、他人转发、单纯愿望不等于即将重置，不得凭关键词启动倒计时。取消/完成优先使用明确引用关联的原帖。

## 本地状态与边界

状态默认在 `$CODEX_HOME/aiyoucodex/reset-announcements.json`（CODEX_HOME 默认 `~/.codex`），不在项目仓库中。可用 `AIYOUCODEX_RESET_ANNOUNCEMENTS_PATH` 指向同机自定义位置；安装端与监测端必须一致。最多保留 40 条公告、200 条去重标识；原子替换写入，文件权限 0600。锁冲突报错，不覆盖另一轮正在写入的状态。

计划与运行状态位于同目录 `reset-monitor.json`、`reset-monitor.json.status`，可用 `AIYOUCODEX_RESET_MONITOR_PATH` 覆盖。配置/采集进程分别加锁；安装升级不删除状态。页面只读缓存，重启保持展示。检查超过当前间隔两倍或采集失败时标记待复核。此功能不自动兑换重置、不改变账号额度、不上传私人配置。卸载会停止独立服务，保留公告及监控数据。
