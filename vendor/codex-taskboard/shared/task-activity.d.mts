import type { Task } from "../web/src/types";
export type ThreadActivity = Record<string, string | null>;
export function taskActivity(task: Task, threadActivity?: ThreadActivity): { time: number; timestamp: string | null; source: "conversation" | "comment" | "created" | "unknown" };
export function compareTaskActivity(left: Task, right: Task, threadActivity?: ThreadActivity): number;
export function taskActivityLabel(task: Task, threadActivity?: ThreadActivity): string;
