import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ApiError, getTaskHall, mutateTaskHall } from "./api";
import { HallScene } from "./HallScene";
import type {
  HallAction, HallAgent, HallNativeActivity, HallRosterAgent, HallScheduledActivity, HallScheduledItem, HallSnapshot, HallStation, HallStatus, HallTask,
} from "./taskHallTypes";
import "./taskHall.css";

const coreStations = {
  automation: { label: "自动任务", role: "定时计划与自动协作" },
  intake: { label: "任务大厅", role: "接单与分派" },
  verify: { label: "检测站", role: "核对回执与验收" },
  next: { label: "续推站", role: "交接下一步或结项" },
};
const managedStation = (id: string): "codex" | "claude" | "dsh" | null => {
  if (id === "claude-code" || id === "claude") return "claude";
  if (id === "codex" || id === "dsh") return id;
  return null;
};

type RosterStation = {
  id: HallStation;
  name: string;
  usageCount: number | null;
  activeCount: number;
  executor?: HallAgent;
};
const labels: Record<HallStatus, string> = {
  queued: "排队", running: "执行中", verification: "待检测",
  attention: "需留意", continuation: "待续推", completed: "已完成",
};
const actionLabels: Record<string, string> = {
  create: "进入大厅", assign: "指派", claim: "领取", handoff: "交接",
  submit: "提交检测", review: "检测", progress: "推进", requeue: "重新入队",
  "lease-expired": "Agent 心跳超时", "review-start": "开始检测", "progress-start": "开始续推", "agent-error": "执行中断",
};
const hostLabels: Record<HallAgent["host"], string> = {
  codex: "Codex", dsh: "DSH", claude: "Claude Code", local: "本机",
};

function stationFor(task: HallTask, agentStations: Map<string, HallStation>): HallStation {
  if (task.status === "verification" || task.status === "attention") return "verify";
  if (task.status === "continuation" || task.status === "completed") return "next";
  return task.agentId ? agentStations.get(task.agentId) ?? "intake" : "intake";
}

function visibleRoster(detected: HallRosterAgent[], agents: HallAgent[], nativeActive: number) {
  const roster = new Map<HallStation, RosterStation>();
  const builtins = new Map(agents.filter((a) => a.managed).map((a) => [a.host, a]));
  for (const agent of detected) {
    if (!agent || typeof agent.id !== "string" || !/^[a-z0-9_-]{1,100}$/i.test(agent.id) ||
        typeof agent.name !== "string" || !agent.name.trim()) continue;
    const builtin = managedStation(agent.id);
    const id = builtin ?? `agent:${agent.id}`;
    if (roster.has(id)) continue;
    const executor = builtin ? builtins.get(builtin) : undefined;
    const usageCount = agent.usageBasis === "sessions" && typeof agent.usageCount === "number" &&
      Number.isSafeInteger(agent.usageCount) && agent.usageCount >= 0 ? agent.usageCount : null;
    roster.set(id, { id, name: agent.name, usageCount, executor,
      activeCount: (executor?.activeCount ?? 0) + (builtin === "codex" ? nativeActive : 0) });
  }
  for (const executor of agents) {
    if (executor.managed || (!executor.online && executor.activeCount <= 0)) continue;
    const id = `agent:hall:${executor.id}` as const;
    roster.set(id, { id, name: executor.name, usageCount: null, activeCount: executor.activeCount, executor });
  }
  return [...roster.values()];
}

const time = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const isToday = (value: string) => new Date(value).toDateString() === new Date().toDateString();
const messageOf = (error: unknown) => error instanceof Error ? error.message : "任务操作未完成。";
const clean = (value: string) => value.trim();
const actorName = (id: string, names: Map<string, string>) => {
  const host = id.startsWith("operator:") ? id.slice(9) as HallAgent["host"] : null;
  return names.get(id) ?? (host ? (hostLabels[host] ?? host) + " 操作员" : id === "system" ? "调度系统" : id);
};
const workOrder: Record<HallStatus, number> = { attention: 0, verification: 1, continuation: 2, running: 3, queued: 4, completed: 5 };

interface Props {
  projectId: string;
  projects: { id: string; name: string }[];
  openingProject: boolean;
  onProject: (projectId: string) => void;
  onHistory: () => void;
  onRules: () => void;
  onOpenNativeThread?: (threadId: string) => void;
  headerStart?: ReactNode;
  headerDrag?: ReactNode;
}

function Status({ status }: { status: HallStatus }) {
  return <span className="hall-status" data-status={status}><i aria-hidden="true" />{labels[status]}</span>;
}

const scheduledLabels = new Map<string, string>([
  ["active", "已启用"], ["enabled", "已启用"], ["paused", "已暂停"], ["disabled", "已停用"],
  ["scheduled", "等待计划"], ["queued", "排队"], ["running", "执行中"], ["waiting", "待确认"],
  ["completed", "已完成"], ["succeeded", "已完成"], ["delivered", "已投递"], ["failed", "执行失败"], ["error", "执行失败"],
  ["interrupted", "已中断"], ["canceled", "已取消"], ["cancelled", "已取消"], ["unknown", "状态未知"],
]);
const scheduleTriggers = new Map<string, string>([
  ["interval", "定时"], ["cron", "定时"], ["schedule", "定时"], ["heartbeat", "定时"], ["thread", "对话定时"],
  ["issue-created", "议题创建"], ["issue", "关联议题"], ["event", "事件触发"],
  ["manual", "手动运行"], ["automation", "自动任务"], ["after", "延时"], ["at", "指定时间"],
  ["every", "周期"], ["daily", "每日"], ["weekly", "每周"],
]);
function AutomationActivity({ view, search, tasks, projects, onTask, onRules }: {
  view?: HallScheduledActivity; search: string; tasks: HallTask[]; projects: Map<string, string>;
  onTask: (id: string) => void; onRules?: () => void;
}) {
  const sources = view?.sources ?? [];
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  const items = (view?.items ?? []).filter((item) => !search ||
    (item.title + " " + (sourceNames.get(item.source) ?? "")).toLocaleLowerCase().includes(search));
  const groups = [
    { title: "定时与事件规则", rows: items.filter(item => item.kind !== "run") },
    { title: "运行记录", rows: items.filter(item => item.kind === "run") },
  ];
  function row(item: HallScheduledItem) {
    const value = item.status.toLocaleLowerCase();
    const tone = value === "running" ? "running" : ["completed", "succeeded", "delivered"].includes(value) ? "completed"
      : ["failed", "error", "interrupted"].includes(value) ? "attention" : "queued";
    const source = sourceNames.get(item.source);
    const detail = [source, item.trigger && scheduleTriggers.get(item.trigger),
      item.projectId && projects.get(item.projectId)].filter(Boolean).join(" · ");
    const stamp = item.nextAt ? "下次 " + time(item.nextAt) : item.updatedAt ? "更新 " + time(item.updatedAt) : "";
    return <li className="hall-task-row hall-automation-row" key={item.source + ":" + item.id}>
      <div className="hall-row"><strong>{item.title}</strong><span className="hall-status" data-status={tone}>
        <i aria-hidden="true" />{scheduledLabels.get(value) ?? "状态未知"}</span></div>
      <span>{[detail, stamp].filter(Boolean).join(" · ")}</span>
    </li>;
  }
  return <section className="hall-automation" aria-label="自动任务清单">
    {sources.length > 0 && <ul className="hall-automation-sources" aria-label="自动任务来源">
      {sources.map((source) => <li key={source.id} data-available={source.available}>
        <i aria-hidden="true" />{source.name}{!source.available && " · 暂不可读"}
      </li>)}
    </ul>}
    {groups.filter(group => group.rows.length).map(group => <section key={group.title}>
      <h3>{group.title} <span>{group.rows.length}</span></h3><ul className="hall-queue">{group.rows.map(row)}</ul>
    </section>)}
    {tasks.length > 0 && <section><h3>大厅自动协作 <span>{tasks.length}</span></h3>
      <ul className="hall-queue">{tasks.map(task => <li key={task.id}>
        <button className="hall-task-row" type="button" onClick={() => onTask(task.id)}>
          <div className="hall-row"><strong>{task.title}</strong><Status status={task.status} /></div>
          <span>{projects.get(task.projectId) ?? task.projectId}</span>
        </button>
      </li>)}</ul></section>}
    {!items.length && !tasks.length && <p className="hall-empty">{search ? "没有匹配的自动任务。"
      : sources.some(source => source.available) ? "当前范围没有自动任务记录。" : "暂时无法读取自动任务记录。"}</p>}
    {onRules && <button type="button" className="hall-button" onClick={onRules}>打开项目自动化规则</button>}
  </section>;
}

const localThreadId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function NativeActivity({ items, total, available, onOpen }: {
  items: HallNativeActivity[]; total: number; available: boolean;
  onOpen?: (threadId: string) => void;
}) {
  return <section className="hall-native-activity" aria-label="原生 Codex 活动">
    <div className="hall-row"><h3>原生 Codex 活动</h3>
      <span>{available ? total + " 运行中" : "暂不可用"}</span>
    </div>
    {items.length ? <ul className="hall-queue">
      {items.map((item) => {
        const row = <>
          <div className="hall-row"><strong>{item.title}</strong><Status status="running" /></div>
          <span>原生对话 · {item.startedAt ? "开始于 " + time(item.startedAt) : "正在运行"}{onOpen ? " · 打开原对话 ↗" : ""}</span>
        </>;
        return <li key={item.threadId}>
          {onOpen ? <button className="hall-task-row" type="button" onClick={() => onOpen(item.threadId)}>{row}</button>
            : <div className="hall-task-row">{row}</div>}
        </li>;
      })}
    </ul> : <p className="hall-meta-line">{!available ? "暂时无法确认原生对话状态。"
      : total ? "没有符合搜索条件的原生对话。" : "当前范围没有正在执行的原生对话。"}</p>}
  </section>;
}

function AgentSelect({ value, agents, required, empty, onChange }: {
  value: string; agents: HallAgent[]; required?: boolean; empty: string; onChange: (value: string) => void;
}) {
  return <select aria-label="目标 Agent" required={required} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">{empty}</option>
    {agents.map((agent) => <option key={agent.id} value={agent.id}>
      {agent.name} · {hostLabels[agent.host] ?? agent.host} · {agent.online ? "已连接" : "离线"}
    </option>)}
  </select>;
}

type Operation = "claim" | "handoff" | "submit" | "review-pass" | "review-changes" | "progress" | "complete" | "requeue";
type OperationChoice = { id: Operation; label: string };
const operations: Record<HallStatus, OperationChoice[]> = {
  queued: [{ id: "claim", label: "指派 Agent" }],
  running: [{ id: "submit", label: "提交检测" }, { id: "handoff", label: "交接 Agent" }],
  verification: [{ id: "review-pass", label: "通过检测" }, { id: "review-changes", label: "退回修改" }],
  attention: [{ id: "requeue", label: "重新入队" }],
  continuation: [{ id: "progress", label: "指派下一步" }, { id: "complete", label: "确认结项" }],
  completed: [],
};

function TaskDetail({ task, agents, manualAgents, projectName, busy, mutable, onAction, onClose }: {
  task: HallTask; agents: HallAgent[]; manualAgents: HallAgent[]; projectName: string; busy: boolean; mutable: boolean;
  onAction: (action: HallAction, done?: () => void) => void; onClose: () => void;
}) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [operationRevision, setOperationRevision] = useState<number | null>(null);
  const [agentId, setAgentId] = useState("");
  const [evidence, setEvidence] = useState("");
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  const owner = task.agentId ? names.get(task.agentId) ?? task.agentId : null;
  const autoPending = Boolean(task.automation && task.automation.step < task.automation.steps.length);
  const autoStep = autoPending ? task.automation?.steps[task.automation.step] : null;
  const detailOps = autoPending ? task.status === "attention" ? [{ id: "requeue" as const, label: "恢复当前步骤" }] : [] : operations[task.status];
  const allowed = operation && detailOps.some((item) => item.id === operation);
  const stale = operation !== null && operationRevision !== task.revision;
  const requiresAgent = operation === "claim" || operation === "handoff" || operation === "progress";
  const choices = manualAgents.filter((agent) => operation !== "handoff" || agent.id !== task.agentId);
  const agentSelectionValid = agentId ? choices.some((agent) => agent.id === agentId) : !requiresAgent;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!operation || !allowed || stale || !mutable || busy || !agentSelectionValid || (operation !== "claim" && !clean(evidence))) return;
    const id = { taskId: task.id, revision: operationRevision ?? task.revision };
    const note = clean(evidence);
    let action: HallAction;
    switch (operation) {
      case "claim": action = { ...id, action: "claim", agentId }; break;
      case "handoff": action = { ...id, action: "handoff", agentId, evidence: note }; break;
      case "submit": action = { ...id, action: "submit", evidence: note }; break;
      case "review-pass":
      case "review-changes": action = { ...id, action: "review", verdict: operation === "review-pass" ? "pass" : "changes", evidence: note }; break;
      case "complete":
      case "progress": action = { ...id, action: "progress", ...(operation === "progress" ? { agentId } : {}), evidence: note }; break;
      case "requeue": action = { ...id, action: "requeue", ...(agentId ? { agentId } : {}), evidence: note }; break;
    }
    onAction(action, () => { setOperation(null); setEvidence(""); setAgentId(""); });
  };
  return <section className="hall-detail" aria-label="任务详情">
    <button className="hall-link" type="button" onClick={onClose}>← 返回任务列表</button>
    <div className="hall-detail-meta"><span>{projectName}</span><Status status={task.status} /></div>
    <h3>{task.title}</h3>
    <p className="hall-meta-line">{owner ? (task.status === "queued" ? "候选承接：" : "承接 Agent：") + owner : "暂无承接 Agent"}</p>
    {task.status === "running" && task.leaseUntil && <p className="hall-meta-line">领取保留至 {time(task.leaseUntil)}，Agent 心跳会续期。</p>}
    {task.automation && <section className="hall-receipt" aria-label="自动协作路线"><strong>自动协作路线</strong>
      <p className="hall-text">{task.automation.steps.map((step) => (step.kind === "review" ? "检测：" : step.kind === "continue" ? "续推：" : "") + actorName(step.agentId, names)).join(" → ")}</p>
      {autoStep && <p className="hall-meta-line">{task.status === "attention" ? "等待手动恢复" : task.automation.active ? "正在执行" : "等待领取"} · {actorName(autoStep.agentId, names)}</p>}
    </section>}
    {task.description && <p className="hall-text">{task.description}</p>}
    {task.evidence && <section className="hall-receipt"><strong>最新回执</strong><p className="hall-text">{task.evidence}</p></section>}
    {detailOps.length > 0 && <div className="hall-actions">
      {detailOps.map(({ id, label }) => <button key={id} type="button" className="hall-button" aria-pressed={operation === id}
        disabled={!mutable || busy || (["claim", "handoff", "progress"].includes(id) && !manualAgents.some((a) => id !== "handoff" || a.id !== task.agentId))}
        onClick={() => { setOperation(id); setOperationRevision(task.revision); setEvidence(""); setAgentId(""); }}>{label}</button>)}
    </div>}
    {stale && <p className="hall-error" role="status">任务已更新，请核对最新轨迹，再重新选择操作。</p>}
    {allowed && <form className="hall-form hall-inline-form" onSubmit={submit}>
      {(requiresAgent || operation === "requeue" && !autoPending) && <label>承接 Agent
        <AgentSelect value={agentId} agents={choices} required={requiresAgent} empty={requiresAgent ? "选择已注册 Agent" : "公开待领取"} onChange={setAgentId} />
      </label>}
      {operation === "claim" ? <p className="hall-meta-line">指派后继续排队，Agent 领取时才开始执行。</p>
        : <label>说明与证据<textarea required maxLength={4000} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)}
          placeholder="记录结果、需修改事项或下一步。可填写相关路径、回执编号。" /></label>}
      <div className="hall-actions"><button className="hall-button hall-primary" type="submit" disabled={!mutable || busy || stale || !agentSelectionValid || (operation !== "claim" && !clean(evidence))}>确认{detailOps.find((item) => item.id === operation)?.label}</button>
        <button className="hall-button" type="button" onClick={() => setOperation(null)}>取消</button></div>
    </form>}
    <h4>执行轨迹</h4>
    <ol className="hall-timeline">
      {[...task.timeline].reverse().map((event, index) => <li key={event.id ?? event.at + ":" + index}>
        <div className="hall-row"><strong>{actionLabels[event.action] ?? event.action}{event.verdict ? (event.verdict === "pass" ? " · 通过" : " · 待修改") : ""}</strong><time dateTime={event.at}>{time(event.at)}</time></div>
        <span>{actorName(event.actorId, names)}
          {event.agentId && event.agentId !== event.actorId && event.agentId !== event.previousAgentId
            ? " · " + (event.previousAgentId ? actorName(event.previousAgentId, names) + " → " : "指派给 ") + actorName(event.agentId, names) : ""}</span>
        {event.note && <p className="hall-text">{event.note}</p>}
      </li>)}
    </ol>
  </section>;
}

export function TaskHall({ projectId, projects, openingProject, onProject, onHistory, onRules, onOpenNativeThread, headerStart, headerDrag }: Props) {
  const [snapshot, setSnapshot] = useState<HallSnapshot | null>(null);
  const [readError, setReadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [station, setStation] = useState<HallStation | null>(null);
  const [filter, setFilter] = useState<HallStatus | "all" | "today" | "check">("all");
  const [search, setSearch] = useState("");
  const [taskId, setTaskId] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [initialAgent, setInitialAgent] = useState("");
  const [autoRoute, setAutoRoute] = useState(false);
  const [handoff, setHandoff] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [continuation, setContinuation] = useState("");
  const version = useRef(0);
  const loaded = useRef(false);
  const inFlight = useRef(false);
  const active = useRef(false);
  const createKey = useRef<{ signature: string; requestId: string } | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    let timer = 0;
    async function poll() {
      const seq = ++version.current;
      try {
        if (inFlight.current || (document.hidden && loaded.current)) return;
        const next = await getTaskHall(projectId, abort.signal);
        if (abort.signal.aborted || version.current !== seq) return;
        if (!Array.isArray(next.tasks) || !Array.isArray(next.agents)) throw Error("任务大厅返回了无法识别的数据。");
        loaded.current = true;
        setSnapshot(next);
        setReadError("");
      } catch (error) {
        if (!abort.signal.aborted && version.current === seq) {
          setReadError(error instanceof ApiError && error.status === 404 ? "任务大厅服务尚未加载。" : messageOf(error));
        }
      } finally {
        if (!abort.signal.aborted) timer = window.setTimeout(poll, 1800);
      }
    }
    void poll();
    return () => { abort.abort(); window.clearTimeout(timer); };
  }, [projectId, reload]);

  const agentMap = useMemo(() => new Map(snapshot?.agents.map((agent) => [agent.id, agent])), [snapshot]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const task = snapshot?.tasks.find((item) => item.id === taskId);
  const all = snapshot?.tasks ?? [];
  const agents = snapshot?.agents ?? [];
  const mutable = Boolean(snapshot) && !readError && !openingProject;
  const counts = snapshot?.counts;
  const nativeActivity = snapshot?.nativeActivity;
  const nativeAvailable = nativeActivity?.available === true && !readError;
  const nativeRunning = useMemo(() => {
    if (!nativeAvailable || !Array.isArray(nativeActivity?.items)) return [];
    const unique = new Map<string, HallNativeActivity>();
    for (const item of nativeActivity.items) {
      if (typeof item?.threadId !== "string" || !localThreadId.test(item.threadId) || typeof item.title !== "string") continue;
      const threadId = item.threadId.toLowerCase();
      if (!unique.has(threadId)) unique.set(threadId, { ...item, threadId });
    }
    return [...unique.values()];
  }, [nativeAvailable, nativeActivity]);
  const detected = snapshot?.roster;
  const roster = visibleRoster(detected?.available && Array.isArray(detected.items) ? detected.items : [], agents, nativeRunning.length);
  const stationByExecutor = new Map(roster.flatMap((row) => row.executor ? [[row.executor.id, row.id] as const] : []));
  const stationMap = new Map<HallStation, { label: string; role: string }>([
    ["intake", coreStations.intake], ["automation", coreStations.automation], ["verify", coreStations.verify], ["next", coreStations.next],
    ...roster.map(({ id, name }) => [id, { label: name, role: "Agent 工位" }] as const),
  ]);
  const currentStation = station && stationMap.has(station) ? station : null;
  const currentStationInfo = currentStation ? stationMap.get(currentStation) : null;
  const automaticAgents = agents.filter((agent) => agent.managed && agent.online && stationByExecutor.has(agent.id));
  const manualAgents = agents.filter((agent) => !agent.managed && agent.online && agent.role !== "reviewer" && stationByExecutor.has(agent.id));
  const eligibleHandoff = automaticAgents.filter((agent) => agent.id !== initialAgent);
  const eligibleReviewers = automaticAgents.filter((agent) => agent.id !== (handoff || initialAgent));
  const routeReady = autoRoute ? automaticAgents.some((agent) => agent.id === initialAgent) &&
    (!handoff || eligibleHandoff.some((agent) => agent.id === handoff)) &&
    eligibleReviewers.some((agent) => agent.id === reviewer) &&
    (!continuation || automaticAgents.some((agent) => agent.id === continuation)) :
    !initialAgent || manualAgents.some((agent) => agent.id === initialAgent);
  const metrics = {
    running: (counts?.running ?? all.filter((item) => item.status === "running").length) + nativeRunning.length,
    queued: counts?.queued ?? all.filter((item) => item.status === "queued").length,
    check: counts ? counts.verification + counts.attention + counts.continuation
      : all.filter((item) => ["verification", "attention", "continuation"].includes(item.status)).length,
    today: counts?.completedToday ?? all.filter((item) => item.status === "completed" && isToday(item.updatedAt)).length,
  };
  const stationCounts: Record<string, number> = {};
  const occupied = new Set<string>();
  for (const item of all) {
    if (item.status === "completed") continue;
    const id = stationFor(item, stationByExecutor);
    stationCounts[id] = (stationCounts[id] ?? 0) + 1;
    const assignee = item.agentId ? agentMap.get(item.agentId) : null;
    if (item.status === "running" && (assignee?.online || (assignee?.activeCount ?? 0) > 0)) occupied.add(id);
  }
  if (nativeRunning.length && stationMap.has("codex")) {
    stationCounts.codex = (stationCounts.codex ?? 0) + nativeRunning.length;
    occupied.add("codex");
  }
  const stationStates: Record<string, "running" | "completed" | "sleeping"> = {};
  const stationCompletionKeys: Record<string, string> = {};
  const scheduledActivity = snapshot?.scheduledActivity;
  const scheduledItems = scheduledActivity?.items ?? [];
  const activeSchedules = scheduledItems.filter(item => ["running", "queued", "waiting", "scheduled"].includes(item.status.toLocaleLowerCase()));
  stationCounts.automation = activeSchedules.length + all.filter(item => item.automation && item.status !== "completed").length;
  if (activeSchedules.some(item => item.status.toLocaleLowerCase() === "running")) occupied.add("automation");
  const recentCompletion = new Map<string, { at: number; key: string }>();
  const now = Date.now();
  // Celebrate only a recorded milestone, and age it out after ten minutes.
  // A newer execution always takes precedence over a previous success.
  function markComplete(stationId: string | undefined, time: string, key: string) {
    if (!stationId || !stationMap.has(stationId as HallStation)) return;
    const at = Date.parse(time);
    if (!Number.isFinite(at) || at < now - 10 * 60_000 || at > now + 30_000 ||
        (recentCompletion.get(stationId)?.at ?? -Infinity) >= at) return;
    recentCompletion.set(stationId, { at, key });
  }
  for (const item of all) {
    if (item.status === "completed") markComplete("next", item.updatedAt, item.id + ":" + item.revision);
    if (item.automation && item.status === "completed") markComplete("automation", item.updatedAt, item.id + ":" + item.revision);
    if (item.automation?.active || item.automation && item.status === "running") occupied.add("automation");
    const stage = item.automation?.active ? item.automation.steps[item.automation.step] : null;
    if (stage?.kind === "review") occupied.add("verify");
    if (stage?.kind === "continue") occupied.add("next");
    for (const event of item.timeline) {
      const key = item.id + ":" + (event.id ?? event.at);
      if ((event.action === "assign" || event.action === "create") && event.agentId) {
        markComplete("intake", event.at, key);
      }
      const success = event.action === "handoff" || event.action === "submit" || event.action === "progress" ||
        event.action === "review" && event.verdict === "pass";
      if (!success) continue;
      if (event.actorKind === "worker" || event.actorKind === "reviewer") {
        markComplete(stationByExecutor.get(event.actorId), event.at, key);
      }
      if (event.action === "review") markComplete("verify", event.at, key);
      if (event.action === "progress") markComplete("next", event.at, key);
    }
  }
  for (const item of scheduledItems) {
    if (item.updatedAt && ["completed", "succeeded"].includes(item.status.toLocaleLowerCase())) {
      markComplete("automation", item.updatedAt, item.source + ":" + item.id + ":" + item.updatedAt);
    }
  }
  if (nativeAvailable && nativeActivity?.lastCompletedAt) {
    markComplete("codex", nativeActivity.lastCompletedAt, "native:" + nativeActivity.lastCompletedAt);
  }
  for (const item of roster) if (item.activeCount > 0) occupied.add(item.id);
  for (const stationId of stationMap.keys()) {
    const completed = recentCompletion.get(stationId);
    stationStates[stationId] = occupied.has(stationId) ? "running" : completed ? "completed" : "sleeping";
    if (completed) stationCompletionKeys[stationId] = completed.key;
  }
  const searchKey = clean(search).toLocaleLowerCase();
  const showNative = Boolean(nativeActivity) && (!currentStation || currentStation === "codex") && (filter === "all" || filter === "running");
  const visibleNative = searchKey ? nativeRunning.filter((item) => item.title.toLocaleLowerCase().includes(searchKey)) : nativeRunning;
  const visible = all.filter((item) => {
    if (currentStation === "automation" ? !item.automation : currentStation && stationFor(item, stationByExecutor) !== currentStation) return false;
    if (filter === "check" && !["verification", "attention", "continuation"].includes(item.status)) return false;
    if (filter === "today" && (item.status !== "completed" || !isToday(item.updatedAt))) return false;
    if (filter !== "all" && filter !== "check" && filter !== "today" && item.status !== filter) return false;
    return !searchKey || (item.title + " " + item.description).toLocaleLowerCase().includes(searchKey);
  }).sort((left, right) => workOrder[left.status] - workOrder[right.status] || right.updatedAt.localeCompare(left.updatedAt));
  const selectedAgent = roster.find((item) => item.id === currentStation);
  const visibleAgents = selectedAgent ? [selectedAgent] : roster;

  async function perform(action: HallAction, done?: () => void) {
    if (inFlight.current || !mutable) return;
    inFlight.current = true;
    ++version.current;
    setBusy(true);
    setWriteError("");
    setNotice("");
    try {
      const { task: saved } = await mutateTaskHall(action);
      if (!active.current) return;
      setSnapshot((current) => current ? {
        ...current, tasks: [saved, ...current.tasks.filter((item) => item.id !== saved.id)],
      } : current);
      setTaskId(saved.id);
      setNotice("已记录 · " + labels[saved.status]);
      done?.();
    } catch (error) {
      if (active.current) setWriteError(error instanceof ApiError && error.status === 409 ? "状态已经变化。请核对最新轨迹后再操作。" : messageOf(error));
    } finally {
      inFlight.current = false;
      if (active.current) {
        setBusy(false);
        setReload((current) => current + 1);
      }
    }
  }

  function selectStation(id: string) {
    if (!stationMap.has(id as HallStation)) return;
    setStation((current) => current === id ? null : id as HallStation);
    setFilter("all");
    setSearch("");
    setTaskId("");
    setCreating(false);
    setWriteError("");
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }

  function create(event: FormEvent) {
    event.preventDefault();
    const text = clean(title);
    if (!text || busy || !mutable || !routeReady) return;
    const automation = autoRoute ? { reviewAgentId: reviewer, ...(handoff ? { handoffAgentId: handoff } : {}), ...(continuation ? { continueAgentId: continuation } : {}) } : undefined;
    const signature = JSON.stringify([projectId, text, clean(description), initialAgent, automation]);
    if (createKey.current?.signature !== signature) createKey.current = { signature, requestId: crypto.randomUUID() };
    void perform({
      action: "create", title: text, description: clean(description), requestId: createKey.current.requestId,
      ...(projectId ? { projectId } : {}), ...(initialAgent ? { agentId: initialAgent } : {}), ...(automation ? { automation } : {}),
    }, () => {
      createKey.current = null;
      setCreating(false);
      setTitle("");
      setDescription("");
      setInitialAgent("");
      setAutoRoute(false); setHandoff(""); setReviewer(""); setContinuation("");
    });
  }

  const metricButtons = [
    ["running", "执行中", metrics.running], ["queued", "排队", metrics.queued],
    ["check", "待处理", metrics.check], ["today", "今日完成", metrics.today],
  ] as const;

  return <section className="task-hall" aria-label="多 Agent 任务大厅">
    <header className="hall-header">
      <div className="hall-heading">
        {headerStart}
        <div className="hall-emblem" aria-hidden="true"><svg viewBox="0 0 42 42" fill="none"><ellipse cx="21" cy="34" rx="17" ry="4" fill="#a9ba78"/><path d="M8 32h26M12 32V21m18 11V21M7 22c3-8 7-12 14-12s11 4 14 12H7Z" stroke="#466754" strokeWidth="1.8" strokeLinecap="round"/><path d="M21 10V5l6 2-6 2m-2 23v-5h4v5" stroke="#b76a48" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 24h24" stroke="#c3d0ac" strokeWidth="1.3"/></svg></div>
        <div><p>AIYOU · 多 Agent 协作</p><h1>任务大厅</h1>
          <span className="hall-live" data-live={Boolean(snapshot) && !readError}><i aria-hidden="true" />{readError ? "连接中断" : snapshot ? "已连接 · 约每 2 秒更新" : "正在连接"}</span>
        </div>
      </div>
      {headerDrag}
      <div className="hall-metrics" aria-label="任务状态统计">
        {metricButtons.map(([id, name, count]) => <button type="button" className="hall-metric" data-kind={id} aria-pressed={filter === id} key={id}
          title={id === "running" && nativeRunning.length ? "含原生 Codex 活动 " + nativeRunning.length + " 条" : undefined}
          onClick={() => { setFilter((current) => current === id ? "all" : id); setStation(null); setTaskId(""); setCreating(false); setSearch(""); }}>
          <strong>{snapshot ? count : "—"}</strong><span>{name}</span>
        </button>)}
      </div>
      <div className="hall-header-actions">
        <label className="hall-scope"><span>项目范围</span><select aria-label="选择项目范围" value={projectId}
          disabled={openingProject || busy} onChange={(event) => onProject(event.target.value)}>
          <option value="">所有项目</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <div className="hall-actions hall-secondary-nav">
          <button type="button" className="hall-link" onClick={onHistory}>议题历史</button>
          {projectId && <button type="button" className="hall-link" onClick={onRules}>自动化规则</button>}
        </div>
      </div>
    </header>
    {readError && <div className="hall-banner" role="alert"><span>{readError}{snapshot ? " 下方为最后读到的记录。" : ""}</span>
      <button className="hall-button" type="button" onClick={() => setReload((current) => current + 1)}>重新连接</button></div>}
    <div className="hall-layout">
      <aside ref={panelRef} className="hall-panel" aria-label="任务与 Agent">
        {writeError && <p className="hall-error" role="alert">{writeError}</p>}
        {notice && <p className="hall-notice" role="status">{notice}</p>}
        {task && !creating ? <TaskDetail task={task} key={task.id} agents={agents} manualAgents={manualAgents} projectName={projectMap.get(task.projectId) ?? task.projectId}
          busy={busy} mutable={mutable} onAction={(action, done) => void perform(action, done)}
          onClose={() => { setTaskId(""); setNotice(""); setWriteError(""); }} /> : <>
          <div className="hall-row hall-panel-top"><div><p>{currentStationInfo?.role ?? "调度台"}</p><h2>{currentStationInfo?.label ?? "任务队列"}</h2></div>
            {!creating && currentStation !== "automation" && <button className="hall-button hall-primary" type="button" disabled={!mutable || busy}
              onClick={() => { setCreating(true); setWriteError(""); setNotice(""); }}>＋ 新建任务</button>}
          </div>
          {currentStation === "automation" ? <>
            <div className="hall-automation-nav">
              <input type="search" aria-label="搜索自动任务" placeholder="搜索自动任务…" value={search}
                onChange={(event) => setSearch(event.target.value)} />
              <button className="hall-link" type="button" onClick={() => selectStation("automation")}>返回任务队列</button>
            </div>
            <AutomationActivity view={scheduledActivity} search={searchKey} tasks={visible} projects={projectMap}
              onTask={(id) => { setTaskId(id); setWriteError(""); setNotice(""); }} onRules={projectId ? onRules : undefined} />
          </> : creating ? <form className="hall-form" onSubmit={create}>
            <p className="hall-meta-line">项目：{projectId ? projectMap.get(projectId) ?? projectId : "本地默认项目"}</p>
            <label>任务名称<input value={title} required maxLength={120} autoFocus onChange={(event) => setTitle(event.target.value)} /></label>
            <label>任务描述<textarea value={description} rows={4} maxLength={8000} onChange={(event) => setDescription(event.target.value)}
              placeholder="写清目标、交付物与验收方式。" /></label>
            <label><span><input type="checkbox" checked={autoRoute} onChange={(event) => {
              setAutoRoute(event.target.checked); setInitialAgent(""); setHandoff(""); setReviewer(""); setContinuation("");
            }} /> 让内置 Agent 自动协作</span></label>
            {autoRoute ? <>
              <p className="hall-meta-line">按选择的路线调用已连接的模型。适用于整理、核对和续写等文字任务。</p>
              <label>首位承接<AgentSelect value={initialAgent} agents={automaticAgents} empty="选择在线 Agent" required onChange={(value) => {
                setInitialAgent(value); setHandoff(""); setReviewer("");
              }} /></label>
              <label>交接给<AgentSelect value={handoff} agents={eligibleHandoff} empty="跳过交接" onChange={(value) => { setHandoff(value); setReviewer(""); }} /></label>
              <label>独立检测<AgentSelect value={reviewer} agents={eligibleReviewers} empty="选择检测 Agent" required onChange={setReviewer} /></label>
              <label>续推 Agent<AgentSelect value={continuation} agents={automaticAgents} empty="等待人工续推" onChange={setContinuation} /></label>
            </> : <label>预先指派<AgentSelect value={initialAgent} agents={manualAgents} empty="公开待领取" onChange={setInitialAgent} /></label>}
            <div className="hall-actions"><button className="hall-button hall-primary" type="submit" disabled={!mutable || busy || !clean(title) || !routeReady}>进入队列</button>
              <button className="hall-button" type="button" disabled={busy} onClick={() => { setCreating(false); setWriteError(""); }}>取消</button></div>
          </form> : <>
            <div className="hall-filters">
              <input type="search" aria-label="搜索任务" placeholder="搜索任务…" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select aria-label="按状态筛选" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
                <option value="all">全部状态</option>
                {Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                <option value="check">待处理</option><option value="today">今日完成</option>
              </select>
            </div>
            {currentStation && <button className="hall-link hall-clear" type="button" onClick={() => { setStation(null); setFilter("all"); }}>查看所有工位 ×</button>}
            {showNative && <NativeActivity items={visibleNative} total={nativeRunning.length} available={nativeAvailable} onOpen={onOpenNativeThread} />}
            {snapshot?.truncated && <p className="hall-meta-line hall-limit">共 {snapshot.total ?? "多于 100"} 项；当前显示优先排序的前 100 项，可切换项目缩小范围。</p>}
            {snapshot && visible.length ? <ul className="hall-queue">
              {visible.map((item) => <li key={item.id}><button className="hall-task-row" type="button" onClick={() => { setTaskId(item.id); setWriteError(""); setNotice(""); }}>
                <div className="hall-row"><strong>{item.title}</strong><Status status={item.status} /></div>
                <span>{projectMap.get(item.projectId) ?? item.projectId}{item.agentId ? " · " + (agentMap.get(item.agentId)?.name ?? item.agentId) : " · 未指派"}</span>
              </button></li>)}
            </ul> : !(showNative && visibleNative.length) && <p className="hall-empty">{!snapshot ? (readError ? "暂时无法读取任务。" : "正在读取任务…")
              : all.length ? "当前筛选没有大厅任务。" : "还没有大厅任务。新建一条任务后，可指派 Agent 或等待领取。"}</p>}
            <section className="hall-agents" aria-label="Agent 工位和接单状态">
              <div className="hall-row"><h3>Agent 工位</h3><span>{snapshot ? visibleAgents.length + " 个工位" : "—"}</span></div>
              {visibleAgents.length ? <>
                <p className="hall-meta-line">建筑大小按可读取的本机会话数调整，数据缺失时用默认尺寸。</p>
                <ul>{visibleAgents.map((row) => {
                  const { executor, activeCount } = row;
                  const status = !executor ? (activeCount ? "仅展示 · 执行 " + activeCount : "仅展示") :
                    activeCount ? "处理 " + activeCount : !executor.online ? "未就绪" : executor.role === "reviewer" ? "可检测" : "可接单";
                  const usage = row.usageCount === null ? "会话量未知" : row.usageCount.toLocaleString("zh-CN") + " 条本机会话";
                  return <li key={row.id} data-display-only={!executor || undefined}>
                    <span className="hall-agent-dot" data-online={Boolean(executor?.online)} aria-hidden="true" />
                    <div><button type="button" className="hall-agent-link" aria-pressed={currentStation === row.id} onClick={() => selectStation(row.id)}>{row.name}</button>
                      <span>{usage}{executor?.model ? " · " + executor.model : ""}</span></div>
                    <span>{status}</span>
                  </li>;
                })}</ul>
              </> : <p className="hall-meta-line">{!snapshot ? "正在读取工位…" : detected?.available ? "没有检出可展示的 Agent。" : "暂时无法读取本机 Agent 检测结果。"}</p>}
            </section>
          </>}
        </>}
      </aside>
      <div className="hall-scene-slot">
        <HallScene activeStation={task && currentStation !== "automation" ? stationFor(task, stationByExecutor) : currentStation} onStation={selectStation} occupied={[...occupied]} stationCounts={stationCounts} agentStations={roster}
          stationStates={stationStates} stationCompletionKeys={stationCompletionKeys} />
      </div>
    </div>
  </section>;
}
