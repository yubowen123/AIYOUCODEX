import path from "node:path";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  "node_modules",
  "bower_components",
  "coverage",
  ".cache",
  "cache",
  "caches",
  "dist",
  "build",
  "out",
  "tmp",
  "temp",
]);

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function isIgnoredAssetPath(filePath, root = "") {
  const absolute = path.resolve(String(filePath || ""));
  const relative = root && isPathInside(root, absolute) ? path.relative(path.resolve(root), absolute) : absolute;
  return relative.split(path.sep)
    .filter(Boolean)
    .some((segment) => IGNORED_DIRECTORY_NAMES.has(segment.toLocaleLowerCase("en-US")) || segment.startsWith(".asset-"));
}

export function changeAffectsProject(project, change, assignments = {}) {
  const changedPath = path.resolve(String(change?.changedPath || change || ""));
  const candidates = Array.isArray(change?.candidates) ? change.candidates : [];
  if (candidates.some((candidate) => {
    const resolved = path.resolve(candidate);
    const assignment = assignments[resolved];
    return assignment ? assignment === project.id : project.folders.some((folder) => isPathInside(folder, resolved));
  })) return true;

  const directAssignment = assignments[changedPath];
  if (directAssignment) return directAssignment === project.id;
  if (project.folders.some((folder) => isPathInside(folder, changedPath) || isPathInside(changedPath, folder))) return true;

  return Object.entries(assignments).some(([assignedPath, projectId]) =>
    projectId === project.id && isPathInside(changedPath, assignedPath));
}

export function createPathPrefixMatcher(prefixes = []) {
  const normalized = new Set(prefixes.map((prefix) => path.resolve(String(prefix || ""))).filter(Boolean));
  return (filePath) => {
    let current = path.resolve(String(filePath || ""));
    while (true) {
      if (normalized.has(current)) return true;
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  };
}

export function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

export class CoalescingPathUpdateQueue {
  constructor(worker) {
    if (typeof worker !== "function") throw new Error("Path update worker is required");
    this.worker = worker;
    this.pending = new Set();
    this.waiters = [];
    this.running = false;
  }

  enqueue(paths = []) {
    for (const filePath of paths) {
      const value = String(filePath || "").trim();
      if (value) this.pending.add(path.resolve(value));
    }
    if (!this.pending.size) return Promise.resolve({ paths: 0, projects: 0 });
    const result = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    if (!this.running) void this.#drain();
    return result;
  }

  async #drain() {
    this.running = true;
    try {
      while (this.pending.size) {
        const batch = [...this.pending];
        const waiters = this.waiters.splice(0);
        this.pending.clear();
        try {
          const result = await this.worker(batch);
          waiters.forEach(({ resolve }) => resolve(result));
        } catch (error) {
          waiters.forEach(({ reject }) => reject(error));
        }
        await yieldToEventLoop();
      }
    } finally {
      this.running = false;
      if (this.pending.size) void this.#drain();
    }
  }
}
