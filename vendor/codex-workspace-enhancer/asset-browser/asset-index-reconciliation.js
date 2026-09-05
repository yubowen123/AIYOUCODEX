import { promises as fs } from "node:fs";
import path from "node:path";
import { isIgnoredAssetPath, yieldToEventLoop } from "./asset-index-update-utils.js";

export function isMissingFileError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

// Enumeration reads only directory entries. The caller decodes media only for
// added/changed files. Failed subtrees are explicit so they cannot become deletes.
export async function collectAssetDirectory(directory, supportedExtensions, { io = fs, limit = 100000 } = {}) {
  const root = path.resolve(directory);
  const pending = [root];
  const files = [];
  const failedPaths = [];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await io.readdir(current, { withFileTypes: true }); }
    catch (error) {
      // A disappearing subfolder is a valid deletion; a missing configured root
      // could instead be an unmounted volume and must retain its cached assets.
      if (current === root || !isMissingFileError(error)) failedPaths.push(current);
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const filePath = path.join(current, entry.name);
      if (entry.isSymbolicLink() || isIgnoredAssetPath(filePath, root)) continue;
      if (entry.isDirectory()) pending.push(filePath);
      else if (entry.isFile() && supportedExtensions.has(path.extname(filePath).toLowerCase())) files.push(filePath);
      if (files.length >= limit) return { files, failedPaths: [root], truncated: true, limit };
      if (++visited % 128 === 0) await yieldToEventLoop();
    }
  }
  return { files, failedPaths, truncated: false };
}

export async function changedAssetCandidates(candidates, previousAssets, { io = fs } = {}) {
  const previous = new Map(previousAssets.map((asset) => [path.resolve(asset.sourcePath), asset]));
  const changed = [];
  const failedPaths = [];
  const missingPaths = [];
  for (const [index, filePath] of candidates.entries()) {
    try {
      const stats = await io.lstat(filePath);
      const old = previous.get(path.resolve(filePath));
      if (stats.isFile() && !stats.isSymbolicLink() && (!old || old.mtimeMs !== stats.mtimeMs || old.size !== stats.size)) changed.push(filePath);
      else if (!stats.isFile() || stats.isSymbolicLink()) missingPaths.push(filePath);
    } catch (error) {
      if (isMissingFileError(error)) missingPaths.push(filePath);
      else failedPaths.push(filePath);
    }
    if (index && index % 128 === 0) await yieldToEventLoop();
  }
  return { changed, failedPaths, missingPaths };
}

// Remembers the directory inode, not just the watcher handle. Replaced roots
// require re-registration even if fs.watch never raises an error.
export class RecoveringAssetWatchers {
  constructor({ watch, onChange, onDirty, onError = () => {}, stat = fs.stat }) {
    this.watch = watch;
    this.stat = stat;
    this.onChange = onChange;
    this.onDirty = onDirty;
    this.onError = onError;
    this.handles = new Map();
    this.reconcilePromise = Promise.resolve();
  }

  reconcile(roots) {
    const next = this.reconcilePromise.catch(() => {}).then(() => this.#reconcile(roots));
    this.reconcilePromise = next;
    return next;
  }

  async #reconcile(roots) {
    const desired = new Set(roots.map((root) => path.resolve(root)));
    for (const root of this.handles.keys()) if (!desired.has(root)) this.close(root);
    for (const root of desired) {
      let stats;
      try { stats = await this.stat(root); }
      catch (error) { this.close(root); this.onError(error); continue; }
      if (!stats.isDirectory()) { this.close(root); continue; }
      const identity = `${stats.dev}:${stats.ino}`;
      if (this.handles.get(root)?.identity === identity) continue;
      this.close(root);
      try {
        const watcher = this.watch(root, { recursive: true }, (eventType, filename) => {
          if (!filename) { this.onDirty(root); return; }
          const changedPath = path.resolve(root, String(filename));
          const relative = path.relative(root, changedPath);
          if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
          if (!isIgnoredAssetPath(changedPath, root)) this.onChange(changedPath, root, eventType);
        });
        this.handles.set(root, { watcher, identity });
        const lost = (error) => {
          if (this.handles.get(root)?.watcher !== watcher) return;
          this.handles.delete(root);
          watcher.close();
          this.onDirty(root);
          if (error) this.onError(error);
        };
        watcher.on("error", lost);
        watcher.on("close", () => lost());
        this.onDirty(root);
      } catch (error) { this.onError(error); this.onDirty(root); }
    }
  }

  close(root) {
    const entry = this.handles.get(root);
    this.handles.delete(root);
    entry?.watcher.close();
  }

  closeAll() { for (const root of this.handles.keys()) this.close(root); }
}
