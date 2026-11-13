# AIYOU 任务大厅场景

中央任务大厅接收事项；检测站收验收回执，续推站处理下一轮。DSH、Claude Code、Codex 使用专属建筑，其余检出的 Agent 使用动态建筑。「自动任务」钟楼由 Three.js 在运行时建模，保留 Blender 底图；点击建筑或名牌查看自动任务。Blender 负责基础建筑、植物、铺装与场景材质；Three.js 负责镜头、运行时建筑、路线及状态反馈。没有第三方模型或贴图依赖。

运行 Blender 背景模式导出可编辑场景、GLB 和预览。输出目录由调用方提供：

```sh
blender -b --python-exit-code 1 --python vendor/codex-taskboard/design/build-task-hall.py -- /absolute/output
```

将导出的 `task-hall.glb` 和由 `任务大厅预览.png` 转出的 WebP 分别以 `task-hall-v2.glb`、`task-hall-v2.webp` 放在 Taskboard 的 `web/public/task-hall/`。Vite 构建复制静态资源；运行时不要求安装 Blender。若 WebGL 不可用，界面保留可点击的工位和状态标签。鼠标左键按住拖动旋转，滚轮缩放，也可使用地图按钮。运行中显示动态标记和传送效果；近期真实完成回执触发亮起，未运行且没有近期回执时显示为休眠。状态只读自任务与 Agent 数据，不发起执行。
