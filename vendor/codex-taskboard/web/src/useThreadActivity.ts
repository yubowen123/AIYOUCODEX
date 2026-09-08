import { useEffect, useState } from "react";
import type { Task } from "./types";
import { readThreadActivity } from "./api";

export function useThreadActivity(tasks: Task[]) {
  const [activity, setActivity] = useState<Record<string, string | null>>({});
  const idsKey = JSON.stringify([...new Set(tasks.map((task) => task.threadId).filter((id): id is string => typeof id === "string"
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)).map((id) => id.toLowerCase()))].sort());
  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[];
    const controller = new AbortController();
    let timer: number | undefined;
    let reading = false;
    let panelVisible = true;
    setActivity({});
    async function refresh() {
      if (reading || controller.signal.aborted || document.hidden || !panelVisible || !ids.length) return;
      window.clearTimeout(timer);
      reading = true;
      try {
        const next: Record<string, string | null> = {};
        for (let start = 0; start < ids.length; start += 500) {
          Object.assign(next, await readThreadActivity(ids.slice(start, start + 500), controller.signal));
        }
        if (!controller.signal.aborted) setActivity(next);
      } catch {
        if (!controller.signal.aborted) setActivity({});
      } finally {
        reading = false;
        if (!controller.signal.aborted && panelVisible) timer = window.setTimeout(refresh, 5000);
      }
    }
    function visibility(event: MessageEvent) {
      if (window.parent === window || event.source !== window.parent || event.origin !== window.location.origin
        || event.data?.type !== "taskboard:visibility" || typeof event.data.visible !== "boolean") return;
      panelVisible = event.data.visible;
      window.clearTimeout(timer);
      if (panelVisible) void refresh();
    }
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("message", visibility);
    return () => {
      controller.abort(); window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("message", visibility);
    };
  }, [idsKey]);
  return activity;
}
