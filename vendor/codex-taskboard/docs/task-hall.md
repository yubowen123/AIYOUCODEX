# AIYOU 任务大厅：操作端与 Agent

AIYOUcodex、AIYOUDSH 读取同一台机器、同一系统用户下的任务大厅。默认数据文件为 `$XDG_DATA_HOME/aiyou/task-hall.sqlite`，未配置 XDG 时为 `~/.local/share/aiyou/task-hall.sqlite`。隔离测试可让三方进程使用同一个绝对路径 `AIYOU_TASK_HALL_FILE`。这个数据库不替换旧项目、议题、流水线或对话库。

## 从大厅开始

1. 新建任务，可以先不指派，也可以把它预约给已登记的承接 Agent。指派本身仍是排队，不能把它冒充成开始运行。
2. Agent 在本机领取，任务进入执行中。工作期间每 30 至 60 秒发送一次心跳；两分钟没有续租，任务转到「需留意」。续租不会改动任务修订号。
3. 当前承接者可以附依据交给另一 Agent，或者提交检测。交接后要等对方领取才开始。
4. 操作员或独立检测 Agent 填写结论和依据。需补充时进「需留意」，通过后进「待续推」。
5. 在续推站填写结论，选择下一位 Agent 再次排队，或结束任务。每次状态变化保留操作者、前后归属与依据。

## 三个内置 Agent 自动接入

Codex 本机看板服务会识别当前 Codex CLI 和 Claude Code 登录；AIYOUDSH 任务大厅模块识别 DSH 原生默认模型。客户端不需要重新登记或保存额外 Key。连接状态是本机配置、宿主发现和心跳；阶段回执才证明该次模型请求成功。

新建任务时勾选「让内置 Agent 自动协作」，选择首位承接、可选交接、独立检测与可选续推。任务领取、交接、检测和续推实时写入同一数据库，打开的大厅约每两秒刷新。检测通过才进入续推；模型失败或连接中断会停在「需留意」，由操作员明确恢复。两个桌面共用此记录，但 DSH 原生工作依赖 Harness 宿主在线。自动协作只发送明确入队的文字任务和必要回执，使用独立的无工具请求，不接管当前聊天或自动领取原有任务。

## 自动任务钟楼

点击地图的「自动任务」钟楼，查看当前宿主可读取的原生定时任务、AIYOU 自动规则及运行记录，以及大厅自动协作。普通任务留在原队列；大厅自动协作同时保留在承接工位和对应流程节点。启用或等待计划不等同执行中；DSH 的提醒投递记录也不等同 Agent 已完成。钟楼只查看记录，不触发任务或修改规则。选择「所有项目」可查看未映射到项目的本机计划。

## 工位发现与使用量

任务大厅自动读取「我的 Agent」使用的本机程序识别目录，每 30 秒更新识别和可读会话计数。候选市场条目及只有遗留内容的目录不生成工位。Claude Code 也可以由增强包附带的实际可执行文件识别；经过大厅凭证验证且有心跳或活动租约的第三方执行器也能显示。

建筑大小使用各 Agent 的本地可识别会话数作参考，不是 token、费用或跨设备总量。无法读取会话量时显示未知，并使用默认尺寸。工位是否可分派取决于对应执行器，而非程序是否安装。

## 第三方本机 Agent 手动接入

下面的 `hallctl` 指 `node <安装目录>/vendor/codex-taskboard/cli/hallctl.mjs`；DSH 在增强运行时下使用同一份脚本。需要支持 `node:sqlite` 的 Node.js 版本。第三方本机执行器由本机操作员登记；Codex、Claude Code、DSH 不需要运行以下命令。

```sh
hallctl enroll --id codex-work --name 'Codex' --host codex --credential /absolute/private/codex-work.json
hallctl enroll --id claude-check --name 'Claude Code 检测' --host claude --role reviewer --credential /absolute/private/claude-check.json
hallctl list
hallctl inbox --credential /absolute/private/codex-work.json
hallctl claim --credential /absolute/private/codex-work.json --task TASK_ID --revision 1
hallctl heartbeat --credential /absolute/private/codex-work.json
hallctl submit --credential /absolute/private/codex-work.json --task TASK_ID --revision 2 --evidence-file /absolute/result.txt
hallctl review --credential /absolute/private/claude-check.json --task TASK_ID --revision 3 --verdict pass --evidence-file /absolute/review.txt
```

承接者如需交接，用 `hallctl handoff` 加 `--to AGENT_ID` 和 `--evidence-file FILE`。用上一次 `inbox` 返回的实际任务 ID 与 revision；并行操作出现 409 时重新读取，不自动重试写操作。检测者只读待检测队列，不能领取、提交或冒充其他 Agent；承接者不能使用自己的凭证验收。凭证文件只保存在本机、权限 0600，避免在命令参数、聊天或日志里传递凭证值。相同系统用户是信任边界；这个机制不在同一账户内隔离不可信的任意程序。

`host` 和名称是登记标签，不证明模型可用。大厅只在 Agent 真实发送心跳或成功执行其操作时显示最近在线。实际工作由对应 Agent 完成；手动路线由外部 Agent 自行决定执行方式；大厅不执行命令，也不会迁移或重跑历史议题。
