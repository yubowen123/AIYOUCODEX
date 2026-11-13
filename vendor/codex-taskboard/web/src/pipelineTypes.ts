export type PipelineTrigger = "manual" | "issue" | "issue-created" | "interval";

export interface PipelineStage {
  name: string;
  kind: "model" | "approval";
  instruction: string;
  options?: string[];
}

export interface PipelineRuleDraft {
  id?: string;
  revision?: number;
  name: string;
  enabled: boolean;
  trigger: PipelineTrigger;
  intervalMinutes?: number;
  stages: PipelineStage[];
}

export interface PipelineRule extends PipelineRuleDraft {
  id: string;
  revision: number;
  nextAt?: string | number | null;
}

export type PipelineStatus = "queued" | "running" | "waiting" | "scheduled" | "failed" | "interrupted" | "canceled" | "completed";

export interface PipelineRun {
  id: string;
  title: string;
  ruleId: string;
  taskId?: string | null;
  status: PipelineStatus;
  revision: number;
  cursor: number;
  stages: PipelineStage[];
  results: { name: string; text: string; at: string | number; usage?: unknown; decision?: boolean }[];
  question?: { name: string; text: string; options: string[] } | null;
  error?: string | null;
  nextAt?: string | number | null;
  createdAt: string | number;
  updatedAt: string | number;
  engine?: string | null;
}

export interface PipelineSnapshot {
  rules: PipelineRule[];
  runs: PipelineRun[];
  available: boolean;
  engine?: string | null;
}

export type PipelineAction =
  | { action: "save-rule"; rule: PipelineRuleDraft }
  | { action: "start"; ruleId: string; requestId: string; taskId?: string; input?: string }
  | { action: "answer"; runId: string; revision: number; option: string }
  | { action: "retry" | "cancel"; runId: string; revision: number };
