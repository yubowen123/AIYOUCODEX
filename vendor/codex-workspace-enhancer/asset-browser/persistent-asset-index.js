import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createPathPrefixMatcher } from "./asset-index-update-utils.js";

const SCHEMA_VERSION = 1;

function normalizedFolders(folders = []) {
  return [...new Set((Array.isArray(folders) ? folders : [])
    .map((folder) => path.resolve(String(folder || "")))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, projects: {} };
}

function normalizeProjectEntry(projectId, value = {}) {
  const assets = Array.isArray(value.assets)
    ? value.assets.filter((asset) => asset && typeof asset === "object" && asset.id)
    : [];
  return {
    projectId,
    projectName: String(value.projectName || projectId),
    folders: normalizedFolders(value.folders),
    initializedAt: String(value.initializedAt || value.updatedAt || ""),
    updatedAt: String(value.updatedAt || ""),
    revision: Number.isSafeInteger(value.revision) ? value.revision : 0,
    assets,
  };
}

function normalizeState(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || !value.projects || typeof value.projects !== "object" || Array.isArray(value.projects)) {
    throw new Error("资产索引格式不支持或已损坏；保留原文件，不自动覆盖。请从备份恢复或明确重新扫描。");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    projects: Object.fromEntries(Object.entries(value.projects)
      .map(([projectId, project]) => [projectId, normalizeProjectEntry(projectId, project)])),
  };
}

export class PersistentAssetIndex {
  constructor({ filePath }) {
    if (!filePath) throw new Error("Asset index path is required");
    this.filePath = path.resolve(filePath);
    this.state = null;
    this.loadPromise = null;
    this.writeQueue = Promise.resolve();
    this.pendingMutations = [];
    this.flushScheduled = false;
  }

  async load() {
    if (this.state) return this.state;
    if (!this.loadPromise) {
      this.loadPromise = fs.readFile(this.filePath, "utf8")
        .then((raw) => normalizeState(JSON.parse(raw.replace(/^\uFEFF/, ""))))
        .catch((error) => { if (error.code === "ENOENT") return emptyState(); throw error; })
        .then((state) => {
          this.state = state;
          return state;
        }).catch((error) => { this.loadPromise = null; throw error; });
    }
    return this.loadPromise;
  }

  async getProject(projectId) {
    const state = await this.load();
    const entry = state.projects[String(projectId || "")];
    return entry ? normalizeProjectEntry(entry.projectId, entry) : null;
  }

  async getProjectRevision(projectId) {
    const state = await this.load();
    const entry = state.projects[String(projectId || "")];
    return entry ? { revision: entry.revision || 0, updatedAt: entry.updatedAt } : null;
  }

  async getProjectSnapshot(projectId) {
    // Internal read-only snapshot. All internal writes replace project entries
    // and asset arrays; serving a page must not copy tens of thousands of rows.
    const state = await this.load();
    return state.projects[String(projectId || "")] || null;
  }

  async replaceProject(project, assets, now = new Date().toISOString()) {
    return this.mutate((state) => {
      const previous = state.projects[project.id];
      state.projects[project.id] = normalizeProjectEntry(project.id, {
        projectName: project.name,
        folders: project.folders,
        initializedAt: previous?.initializedAt || now,
        updatedAt: now,
        revision: (previous?.revision || 0) + 1,
        assets,
      });
      return state.projects[project.id];
    }, { copyOnWrite: true });
  }

  async patchProject(project, {
    upserts = [],
    removeIds = [],
    removePrefixes = [],
    folders = project.folders,
  } = {}, now = new Date().toISOString()) {
    const results = await this.patchProjects([{ project, patch: { upserts, removeIds, removePrefixes, folders } }], now);
    return results[0];
  }

  async patchProjects(updates = [], now = new Date().toISOString()) {
    return this.mutate((state) => {
      const results = [];
      for (const { project, patch = {} } of updates) {
        const {
          upserts = [],
          removeIds = [],
          removePrefixes = [],
          folders = project.folders,
        } = patch;
        const current = normalizeProjectEntry(project.id, state.projects[project.id] || {
          projectName: project.name,
          folders,
          initializedAt: now,
          updatedAt: now,
          revision: 0,
          assets: [],
        });
        const removeIdSet = new Set(removeIds.map(String));
        const matchesRemovedPrefix = createPathPrefixMatcher(removePrefixes);
        const byId = new Map(current.assets
          .filter((asset) => !removeIdSet.has(String(asset.id)))
          .filter((asset) => {
            const assetPath = String(asset.sourcePath || "");
            if (!assetPath) return true;
            return !matchesRemovedPrefix(assetPath);
          })
          .map((asset) => [String(asset.id), asset]));
        for (const asset of upserts) {
          if (asset?.id) byId.set(String(asset.id), asset);
        }
        const nextAssets = [...byId.values()];
        if (state.projects[project.id] && current.projectName === project.name && sameAssetIndexFolders(current.folders, folders) && isDeepStrictEqual(current.assets, nextAssets)) {
          results.push(state.projects[project.id]);
          continue;
        }
        state.projects[project.id] = normalizeProjectEntry(project.id, {
          ...current,
          projectName: project.name,
          folders,
          updatedAt: now,
          revision: current.revision + 1,
          assets: nextAssets,
        });
        results.push(state.projects[project.id]);
      }
      return results;
    }, { copyOnWrite: true });
  }

  async removeProjectsExcept(projectIds) {
    const keep = new Set(projectIds.map(String));
    return this.mutate((state) => {
      for (const projectId of Object.keys(state.projects)) {
        if (!keep.has(projectId)) delete state.projects[projectId];
      }
      return state;
    }, { copyOnWrite: true });
  }

  mutate(mutator, { copyOnWrite = false } = {}) {
    const operation = new Promise((resolve, reject) => {
      this.pendingMutations.push({ mutator, resolve, reject, copyOnWrite });
    });
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      // Fold mutations arriving in the same event-loop turn into one durable
      // snapshot; callers still resolve only after the atomic rename succeeds.
      this.writeQueue = this.writeQueue.then(() => new Promise((resolve) => setImmediate(resolve))).then(() => this.flushMutations());
    }
    return operation;
  }

  async flushMutations() {
    try {
      while (this.pendingMutations.length) {
        const batch = this.pendingMutations.splice(0);
        try {
          const current = await this.load();
          // The three built-in mutators never edit existing entries/assets.
          // Keep full isolation for arbitrary mutate callbacks, including mixed batches.
          const draft = batch.every((item) => item.copyOnWrite)
            ? { ...current, projects: { ...current.projects } }
            : structuredClone(current);
          const results = [];
          for (const { mutator } of batch) results.push(await mutator(draft));
          if (!isDeepStrictEqual(current, draft)) await this.persistState(draft);
          this.state = draft;
          batch.forEach(({ resolve }, index) => resolve(results[index]));
        } catch (error) {
          // Failed I/O must not expose uncommitted changes to subsequent reads.
          batch.forEach(({ reject }) => reject(error));
        }
      }
    } finally {
      this.flushScheduled = false;
    }
  }

  async persistState(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = path.join(path.dirname(this.filePath), `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, `${JSON.stringify(state)}\n`, "utf8");
      await fs.rename(temporary, this.filePath);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
}

export function sameAssetIndexFolders(left = [], right = []) {
  const a = normalizedFolders(left);
  const b = normalizedFolders(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
