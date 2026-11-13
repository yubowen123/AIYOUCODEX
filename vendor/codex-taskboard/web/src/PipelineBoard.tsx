import { useEffect, useRef, useState } from "react";
import { ApiError, getPipeline, mutatePipeline } from "./api";
import type {
  PipelineAction, PipelineRule, PipelineRuleDraft, PipelineRun, PipelineSnapshot, PipelineStage, PipelineStatus, PipelineTrigger,
} from "./pipelineTypes";
import type { Task } from "./types";
import "./pipeline.css";

const TRIGGERS: Record<PipelineTrigger, string> = {
  manual: "手动触发",
  issue: "选定议题触发",
  "issue-created": "新建议题触发",
  interval: "按间隔触发",
};
const STATUS: Record<PipelineStatus, string> = {
  queued: "排队中", running: "执行中", waiting: "待决定", scheduled: "等待复查",
  failed: "执行失败", interrupted: "执行中断", canceled: "已停止", completed: "已完成",
};
const STATUS_ORDER: Record<PipelineStatus, number> = {
  waiting: 0, running: 1, queued: 2, scheduled: 3, interrupted: 4, failed: 4, completed: 5, canceled: 5,
};
const WAITING = new Set<PipelineStatus>(["queued", "running", "waiting", "scheduled"]);
const newStage = (): PipelineStage => ({ name: "", kind: "model", instruction: "" });
const newDraft = (): PipelineRuleDraft => ({ name: "", enabled: false, trigger: "manual", stages: [newStage()] });
const reviewTemplate = (): PipelineRuleDraft => ({
  name: "议题分析与交付建议", enabled: false, trigger: "issue", stages: [
    { kind: "model", name: "厘清目标", instruction: "根据议题和补充材料，列出目标、已知事实、待核实项和可验收的结果。" },
    { kind: "approval", name: "选择处理范围", instruction: "参考上一步结果，这一轮要深入到什么程度？", options: ["只整理建议", "补齐验收和测试计划"] },
    { kind: "model", name: "整理交付", instruction: "按已选择的范围产出处理方案、下一步与验收标准。标明仍缺的资料，不声称已执行外部操作。" },
  ],
});
const time = (value?: string | number | null) => {
  if (value == null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
};
const messageOf = (error: unknown) => error instanceof Error ? error.message : "流水线操作失败。";
const editableRule = (rule: PipelineRule): PipelineRuleDraft => ({
  id: rule.id, revision: rule.revision, name: rule.name, enabled: rule.enabled,
  trigger: rule.trigger, intervalMinutes: rule.intervalMinutes, stages: structuredClone(rule.stages),
});

function validate(draft: PipelineRuleDraft): PipelineRuleDraft {
  const name = draft.name.trim();
  if (!name) throw Error("请填写流水线名称。");
  if (draft.trigger === "interval" && (draft.intervalMinutes == null || !Number.isInteger(draft.intervalMinutes) || draft.intervalMinutes < 5 || draft.intervalMinutes > 43200)) {
    throw Error("执行间隔须为 5 至 43200 分钟的整数。");
  }
  const stages = draft.stages.map((stage, index) => {
    const name = stage.name.trim();
    const instruction = stage.instruction.trim();
    if (!name || !instruction) throw Error(`请补齐第 ${index + 1} 步的名称和说明。`);
    if (stage.kind === "model") return { name, instruction, kind: stage.kind };
    const options = (stage.options ?? []).map((option) => option.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 6 || options.some((option) => option.length > 120) || new Set(options).size !== options.length) {
      throw Error(`第 ${index + 1} 步须填写 2 至 6 个不同选项，每项不超过 120 字。`);
    }
    return { name, instruction, options, kind: stage.kind };
  });
  const { intervalMinutes, ...fields } = draft;
  return { ...fields, name, stages, ...(draft.trigger === "interval" ? { intervalMinutes } : {}) };
}

function RuleEditor({ draft, busy, change, close, save }: {
  draft: PipelineRuleDraft; busy: boolean; change: (draft: PipelineRuleDraft) => void; close: () => void; save: () => void;
}) {
  function updateStage(index: number, patch: Partial<PipelineStage>) {
    change({ ...draft, stages: draft.stages.map((stage, i) => i === index ? { ...stage, ...patch } : stage) });
  }
  function moveStage(index: number, direction: number) {
    const next = [...draft.stages];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    change({ ...draft, stages: next });
  }
  const automatic = draft.trigger === "interval" || draft.trigger === "issue-created";
  return (
    <form className="pipeline-card pipeline-editor" aria-label="流水线规则编辑" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="pipeline-row">
        <h3>{draft.id ? "编辑流水线" : "新建流水线"}</h3>
        <button className="button secondary" type="button" disabled={busy} onClick={close}>关闭编辑</button>
      </div>
      <fieldset disabled={busy}>
        <div className="pipeline-fields">
          <label>名称<input value={draft.name} required maxLength={100} placeholder="例如：反馈分类与处理建议" onChange={(event) => change({ ...draft, name: event.target.value })} /></label>
          <label>触发方式<select value={draft.trigger} onChange={(event) => {
            const trigger = event.target.value as PipelineTrigger;
            change({ ...draft, trigger, ...(trigger === "interval" ? { intervalMinutes: draft.intervalMinutes ?? 60 } : {}) });
          }}>
            {Object.entries(TRIGGERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {draft.trigger === "interval" && (
            <label>执行间隔（分钟）
              <input type="number" min={5} max={43200} step={1} required value={draft.intervalMinutes ?? ""}
                onChange={(event) => change({ ...draft, intervalMinutes: event.target.value === "" ? undefined : Number(event.target.value) })} />
            </label>
          )}
        </div>
        <label className="pipeline-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => change({ ...draft, enabled: event.target.checked })} />启用这条规则</label>
        <p className="pipeline-muted">
          {automatic
            ? draft.trigger === "interval" ? "启用后，由本机服务按间隔发起执行。" : "启用后，本项目新建议题会进入流水线，已有议题不会补跑。"
            : draft.trigger === "issue" ? "启动前选择本项目的一个议题。" : "保存并启用后，可手动发起一轮执行。"}
        </p>
        <ol className="pipeline-step-editor">
          {draft.stages.map((stage, index) => (
            <li key={index}>
              <div className="pipeline-row">
                <strong>第 {index + 1} 步</strong>
                <div className="pipeline-actions">
                  <button className="button secondary" type="button" aria-label={`上移第 ${index + 1} 步`} disabled={index === 0} onClick={() => moveStage(index, -1)}>上移</button>
                  <button className="button secondary" type="button" aria-label={`下移第 ${index + 1} 步`} disabled={index + 1 === draft.stages.length} onClick={() => moveStage(index, 1)}>下移</button>
                  <button className="button secondary" type="button" aria-label={`移除第 ${index + 1} 步`} disabled={draft.stages.length === 1}
                    onClick={() => change({ ...draft, stages: draft.stages.filter((_, i) => i !== index) })}>移除</button>
                </div>
              </div>
              <div className="pipeline-fields">
                <label>步骤名称<input required maxLength={80} value={stage.name} onChange={(event) => updateStage(index, { name: event.target.value })} /></label>
                <label>步骤类型<select value={stage.kind} onChange={(event) => updateStage(index, event.target.value === "approval"
                  ? { kind: "approval", options: stage.options ?? ["继续", "调整方向"] }
                  : { kind: "model", options: undefined })}>
                  <option value="model">模型执行</option><option value="approval">等待用户决定</option>
                </select></label>
              </div>
              <label>{stage.kind === "model" ? "模型指令" : "需要用户决定的问题"}
                <textarea required rows={3} maxLength={4000} value={stage.instruction} onChange={(event) => updateStage(index, { instruction: event.target.value })} />
              </label>
              {stage.kind === "approval" && <label>决定选项（每行一个，2 至 6 项）
                <textarea required rows={3} maxLength={725} value={(stage.options ?? []).join("\n")}
                  onChange={(event) => updateStage(index, { options: event.target.value.split("\n") })} />
              </label>}
            </li>
          ))}
        </ol>
        <div className="pipeline-actions">
          <button className="button secondary" type="button" disabled={draft.stages.length >= 12}
            onClick={() => change({ ...draft, stages: [...draft.stages, newStage()] })}>添加步骤</button>
          <button className="button primary" type="submit">保存规则</button>
        </div>
      </fieldset>
    </form>
  );
}

function tokenSummary(usage: unknown) {
  if (!usage || typeof usage !== "object") return null;
  const values = usage as Record<string, unknown>;
  const input = values.inputTokens ?? values.input_tokens;
  const output = values.outputTokens ?? values.output_tokens;
  return [
    typeof input === "number" && Number.isFinite(input) ? `输入 ${input.toLocaleString("zh-CN")}` : null,
    typeof output === "number" && Number.isFinite(output) ? `输出 ${output.toLocaleString("zh-CN")}` : null,
  ].filter(Boolean).join(" · ");
}

function RunCard({ run, task, busy, modelReady, mutate }: {
  run: PipelineRun; task?: Task; busy: boolean; modelReady: boolean;
  mutate: (action: PipelineAction) => void;
}) {
  const state = { runId: run.id, revision: run.revision };
  const next = run.stages[run.cursor];
  const [open, setOpen] = useState(false);
  return (
    <article className="pipeline-card pipeline-run">
      <div className="pipeline-row">
        <div className="pipeline-heading">
          <h3>{run.title}</h3>
          <p className="pipeline-muted">{time(run.updatedAt)}{task ? ` · ${task.identifier}` : ""}{run.engine ? ` · ${run.engine}` : ""}</p>
        </div>
        <span className="pipeline-badge" data-status={run.status}>{STATUS[run.status] ?? run.status}</span>
      </div>
      {WAITING.has(run.status) && next && <p className="pipeline-muted">第 {run.cursor + 1} / {run.stages.length} 步：{next.name}</p>}
      {run.status === "scheduled" && <p className="pipeline-muted">预计复查：{time(run.nextAt)}</p>}
      {run.error && <p className="pipeline-error">{run.error}</p>}
      {run.status === "waiting" && run.question && (
        <div className="pipeline-question">
          <strong>{run.question.name}</strong>
          <p>{run.question.text}</p>
          <div className="pipeline-actions">
            {run.question.options.map((option) => <button className="button primary" type="button" key={option} disabled={busy}
              onClick={() => mutate({ action: "answer", ...state, option })}>{option}</button>)}
          </div>
        </div>
      )}
      <div className="pipeline-actions">
        {run.results.length > 0 && <button className="button secondary" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "收起结果" : `查看结果（${run.results.length}）`}
        </button>}
        {(WAITING.has(run.status) || ["failed", "interrupted"].includes(run.status)) && <button className="button secondary" type="button" disabled={busy}
          onClick={() => mutate({ action: "cancel", ...state })}>停止</button>}
        {["failed", "interrupted"].includes(run.status) && <button className="button secondary" type="button"
          disabled={busy || !modelReady} onClick={() => mutate({ action: "retry", ...state })}>重试当前步骤</button>}
      </div>
      {open && <ol className="pipeline-results">{run.results.map((result, index) => (
        <li key={index}><div className="pipeline-row"><strong>{result.name}{result.decision ? " · 决定" : ""}</strong><span className="pipeline-muted">{time(result.at)}</span></div>
          <p>{result.text}</p>{tokenSummary(result.usage) && <span className="pipeline-muted">Token：{tokenSummary(result.usage)}</span>}
        </li>
      ))}</ol>}
    </article>
  );
}

export function PipelineBoard({ projectId, projectName, tasks }: { projectId: string; projectName: string; tasks: Task[] }) {
  const [data, setData] = useState<PipelineSnapshot | null>(null);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<PipelineRuleDraft | null>(null);
  const [runRule, setRunRule] = useState<PipelineRule | null>(null);
  const [taskId, setTaskId] = useState("");
  const [input, setInput] = useState("");
  const inFlight = useRef(false);
  const readGeneration = useRef(0);
  const startRequest = useRef<{ signature: string; id: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      try {
        if (inFlight.current) return;
        const generation = ++readGeneration.current;
        const snapshot = await getPipeline(projectId, controller.signal);
        if (!controller.signal.aborted && generation === readGeneration.current) {
          setData(snapshot);
          setReadError("");
        }
      } catch (error) {
        if (!controller.signal.aborted && !inFlight.current) {
          setReadError(error instanceof ApiError && error.status === 404 ? "当前任务服务尚未加载流水线。" : messageOf(error));
        }
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 3500);
      }
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [projectId, reload]);

  async function perform(action: PipelineAction, onSuccess?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    ++readGeneration.current;
    setBusy(true);
    setActionError("");
    setAnnouncement("");
    try {
      await mutatePipeline(projectId, action);
      onSuccess?.();
      setAnnouncement(action.action === "save-rule" ? "规则已保存。" : "执行状态已更新。");
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setReload((current) => current + 1);
    }
  }
  function saveRule() {
    if (!draft) return;
    try { void perform({ action: "save-rule", rule: validate(draft) }, () => setDraft(null)); }
    catch (error) { setActionError(messageOf(error)); }
  }
  const eligible = tasks.filter((task) => task.projectId === projectId && !task.archivedAt);
  const currentRule = data?.rules.find((rule) => rule.id === runRule?.id);
  const issueRequired = currentRule?.trigger === "issue" || currentRule?.trigger === "issue-created";
  function startRun() {
    if (!currentRule?.enabled || !data?.available) return;
    if (issueRequired && !eligible.some((task) => task.id === taskId)) return;
    const signature = JSON.stringify([currentRule.id, taskId, input.trim()]);
    if (!startRequest.current || startRequest.current.signature !== signature) {
      startRequest.current = { signature, id: globalThis.crypto.randomUUID?.()
        ?? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("") };
    }
    void perform({ action: "start", ruleId: currentRule.id, requestId: startRequest.current.id,
      ...(taskId ? { taskId } : {}), ...(input.trim() ? { input: input.trim() } : {}) }, () => {
      startRequest.current = null;
      setRunRule(null);
    });
  }
  const sortedRuns = [...(data?.runs ?? [])].sort((left, right) =>
    (STATUS_ORDER[left.status] ?? 9) - (STATUS_ORDER[right.status] ?? 9)
    || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const pending = sortedRuns.filter((run) => run.status === "waiting").length;
  return (
    <section className="pipeline-board" aria-label="执行流水线">
      <header className="pipeline-intro">
        <div className="pipeline-heading">
          <p className="pipeline-kicker">{projectName}</p>
          <h2>执行流水线</h2>
          <p>按规则接收输入、执行步骤和记录结果。需要你决定时，流水线会停在当前步骤。</p>
        </div>
        <div className="pipeline-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={() => setReload((current) => current + 1)}>刷新</button>
          <button className="button primary" type="button" disabled={!data || busy || !!draft}
            onClick={() => { setDraft({ ...newDraft(), intervalMinutes: 60 }); setActionError(""); }}>新建规则</button>
          <button className="button secondary" type="button" disabled={!data || busy || !!draft}
            onClick={() => { setDraft(reviewTemplate()); setActionError(""); }}>使用议题模板</button>
        </div>
      </header>
      <p className="pipeline-sr-only" role="status">{announcement}</p>
      {!data && !readError && <p className="pipeline-muted" role="status">正在加载本项目的流水线…</p>}
      {readError && <p className="pipeline-error" role="alert">{readError}</p>}
      {actionError && <p className="pipeline-error" role="alert">{actionError}</p>}
      {data && <div className="pipeline-metrics" aria-label="执行概览">
        <span>待决定 <strong>{pending}</strong></span>
        <span>待执行 / 执行中 <strong>{sortedRuns.filter((run) => ["queued", "running"].includes(run.status)).length}</strong></span>
        <span>执行器：{data.available ? data.engine ?? "已注册" : "尚未就绪"}</span>
      </div>}
      {draft && <RuleEditor draft={draft} busy={busy} change={setDraft} save={saveRule} close={() => { setDraft(null); setActionError(""); }} />}
      {data && <div className="pipeline-columns">
        <section className="pipeline-column" aria-labelledby="pipeline-rules-heading">
          <h2 id="pipeline-rules-heading">规则</h2>
          {!data.rules.length && <div className="pipeline-empty">还没有规则。新建一条手动流水线，选好步骤后试跑。</div>}
          {data.rules.map((rule) => (
            <article className="pipeline-card" key={rule.id}>
              <div className="pipeline-row">
                <div className="pipeline-heading"><h3>{rule.name}</h3><p className="pipeline-muted">{TRIGGERS[rule.trigger]}</p></div>
                <span className="pipeline-badge" data-status={rule.enabled ? "completed" : "canceled"}>{rule.enabled ? "已启用" : "已停用"}</span>
              </div>
              {rule.trigger === "interval" && <p className="pipeline-muted">每 {rule.intervalMinutes} 分钟{rule.nextAt ? ` · 下次 ${time(rule.nextAt)}` : ""}</p>}
              <ol className="pipeline-rule-steps">{rule.stages.map((stage, index) => (
                <li key={index}>{stage.name}{stage.kind === "approval" && <span className="pipeline-muted"> · 待决定</span>}</li>
              ))}</ol>
              <div className="pipeline-actions">
                <button className="button secondary" type="button" disabled={busy || !!draft} onClick={() => { setDraft(editableRule(rule)); setActionError(""); }}>编辑</button>
                {rule.enabled && <button className="button secondary" type="button" disabled={busy || !!draft}
                  onClick={() => void perform({ action: "save-rule", rule: { ...editableRule(rule), enabled: false } })}>停用规则</button>}
                <button className="button primary" type="button" disabled={busy || !rule.enabled || !data.available}
                  onClick={() => { setRunRule(rule); setTaskId(""); setInput(""); setActionError(""); }}>运行一次</button>
              </div>
              {runRule?.id === rule.id && <form className="pipeline-run-form" onSubmit={(event) => { event.preventDefault(); startRun(); }}>
                <label>{issueRequired ? "选择议题" : "关联议题（可选）"}
                  <select required={issueRequired} value={taskId} onChange={(event) => setTaskId(event.target.value)}>
                    <option value="">{issueRequired ? "请选择本项目议题" : "不关联议题"}</option>
                    {eligible.map((task) => <option value={task.id} key={task.id}>{task.identifier} · {task.title}</option>)}
                  </select>
                </label>
                {issueRequired && !eligible.length && <p className="pipeline-muted">本项目暂无可用议题，可到「议题看板」新建。</p>}
                <label>补充材料（可选）
                  <textarea rows={3} maxLength={8000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：本轮需优先核对哪些信息" />
                </label>
                <div className="pipeline-actions">
                  <button className="button secondary" type="button" disabled={busy} onClick={() => setRunRule(null)}>收起</button>
                  <button className="button primary" type="submit" disabled={busy || !rule.enabled || !data.available || (issueRequired && !taskId)}>开始执行</button>
                </div>
              </form>}
            </article>
          ))}
        </section>
        <section className="pipeline-column" aria-labelledby="pipeline-runs-heading">
          <h2 id="pipeline-runs-heading">待处理与执行记录</h2>
          {!sortedRuns.length && <div className="pipeline-empty">还没有执行记录。运行后可在这里查看每一步的结果。</div>}
          {sortedRuns.map((run) => <RunCard key={run.id} run={run} task={eligible.find((task) => task.id === run.taskId)} busy={busy}
            modelReady={data.available} mutate={(action) => { void perform(action); }} />)}
        </section>
      </div>}
    </section>
  );
}
