export type HallStatus = "queued" | "running" | "verification" | "attention" | "continuation" | "completed";
export type HallStation = "automation" | "intake" | "codex" | "dsh" | "claude" | "verify" | "next" | `agent:${string}`;
export type HallAgentHost = "codex" | "dsh" | "claude" | "local";

export interface HallAgent {
  id: string;
  name: string;
  host: HallAgentHost;
  role?: "worker" | "reviewer";
  online: boolean;
  activeCount: number;
  managed?: boolean;
  model?: string | null;
  lastSeenAt: string | null;
}

export interface HallTimelineEvent {
  id?: number;
  action: string;
  actorId: string;
  actorKind?: "operator" | "worker" | "reviewer" | "system";
  agentId: string | null;
  note: string | null;
  at: string;
  verdict?: "pass" | "changes" | null;
  previousAgentId?: string | null;
}

export interface HallTask {
  id: string;
  title: string;
  description: string;
  projectId: string;
  status: HallStatus;
  agentId: string | null;
  revision: number;
  leaseUntil?: string | null;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
  timeline: HallTimelineEvent[];
  automation?: { steps: { kind: "work" | "review" | "continue"; agentId: string }[]; step: number; active: boolean };
}

export interface HallNativeActivity {
  threadId: string;
  title: string;
  startedAt: string;
  updatedAt: string;
}

export interface HallRosterAgent {
  id: string;
  name: string;
  usageCount: number | null;
  usageBasis: "sessions" | "unknown";
}

export interface HallScheduledItem {
  id: string;
  source: string;
  title: string;
  kind?: "rule" | "run";
  status: string;
  trigger?: string;
  projectId?: string | null;
  nextAt?: string | null;
  updatedAt?: string | null;
}

export interface HallScheduledActivity {
  sources: { id: string; name: string; available: boolean }[];
  items: HallScheduledItem[];
}

export interface HallSnapshot {
  tasks: HallTask[];
  agents: HallAgent[];
  total?: number;
  truncated?: boolean;
  counts?: Record<HallStatus | "completedToday", number>;
  nativeActivity?: { available: boolean; items: HallNativeActivity[]; lastCompletedAt?: string };
  scheduledActivity?: HallScheduledActivity;
  roster?: { available: boolean; items: HallRosterAgent[] };
}

type HallMutation = { taskId: string; revision: number };
export type HallAction =
  | { action: "create"; title: string; description: string; requestId: string; projectId?: string; agentId?: string;
      automation?: { handoffAgentId?: string; reviewAgentId: string; continueAgentId?: string } }
  | (HallMutation & { action: "claim"; agentId: string })
  | (HallMutation & { action: "handoff"; agentId: string; evidence: string })
  | (HallMutation & { action: "submit"; evidence: string })
  | (HallMutation & { action: "review"; verdict: "pass" | "changes"; evidence: string })
  | (HallMutation & { action: "progress" | "requeue"; agentId?: string; evidence: string });
