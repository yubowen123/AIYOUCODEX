import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { hideOpenChatCutApplication, openChatCutProcesses, ownedOpenChatCutProcesses, sameOpenChatCutProcessIdentity } from "./openchatcut-process.mjs";
import { backgroundRuntimePaths, prepareBackgroundRuntime } from './openchatcut-background.mjs';

export const OPENCHATCUT_VERSION = "0.2.16";
export const OPENCHATCUT_RELEASE_URL = "https://github.com/0xsline/OpenChatCut/releases/tag/v0.2.16";
const RELEASE_API = "https://api.github.com/repos/0xsline/OpenChatCut/releases/tags/v0.2.16";
const execute = promisify(execFile);
const runtimes = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const errorWithCode = (message, code) => Object.assign(new Error(message), { code });
const exists = async file => { try { return (await stat(file)).isFile(); } catch { return false; } };

export function openChatCutInstallDirectory({ home = os.homedir(), platform = process.platform } = {}) {
  if (platform === "darwin") return path.join(home, "Applications", "AIYOUcodex", "OpenChatCut");
  if (platform === "win32") return path.join(home, "AppData", "Local", "AIYOUcodex", "Applications", "OpenChatCut");
  return path.join(home, ".local", "share", "aiyoucodex", "applications", "openchatcut");
}

function assetName(platform, arch) {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) return `OpenChatCut-${OPENCHATCUT_VERSION}-${arch}.zip`;
  if (platform === "linux" && arch === "x64") return `OpenChatCut-${OPENCHATCUT_VERSION}-x86_64.AppImage`;
  return null;
}

async function macVersion(appPath) {
  try {
    const plist = await readFile(path.join(appPath, "Contents", "Info.plist"), "utf8");
    return plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
  } catch { return null; }
}

// App packages, resumable downloads and their pointer live here. OpenChatCut owns its separate
// ~/.openchatcut and Electron userData directories; neither is modified here.
export function createOpenChatCutInstaller({
  home = os.homedir(), platform = process.platform, arch = process.arch,
  installDir = openChatCutInstallDirectory({ home, platform }), onProgress,
  fetchImpl = globalThis.fetch, execFileAsync = execute, spawnImpl = spawn,
  env = process.env, sleep = pause, requestTimeoutMs = 30_000,
  downloadTimeoutMs = 45 * 60_000, downloadAttempts = 3, startupTimeoutMs = 60_000,
  downloadChunkBytes = 32 * 1024 * 1024, downloadConcurrency = 4,
  existingAppPaths,
  listProcesses = () => openChatCutProcesses({ platform, execFileAsync }),
  signalProcess = (pid, signal) => process.kill(pid, signal), shutdownTimeoutMs = 5000,
  prepareBackground = prepareBackgroundRuntime,
} = {}) {
  const root = path.resolve(installDir);
  const selectedAsset = assetName(platform, arch);
  const supported = !!selectedAsset;
  const runtime = runtimes.get(root) ?? { state: "idle", progress: 0, message: "", install: null, launch: null };
  runtimes.set(root, runtime);
  const listeners = new Set(onProgress ? [onProgress] : []);
  const unsupportedMessage = platform === "win32" && arch === "x64"
    ? "Windows 自动安装尚未实现，请使用官方安装器；已安装的 OpenChatCut 可以连接。"
    : `官方 v${OPENCHATCUT_VERSION} 暂无可自动安装的 ${platform}/${arch} 发行包。`;
  const notify = (state, progress, message, extra = {}) => {
    Object.assign(runtime, { state, progress, message });
    for (const listener of listeners) {
      try { listener({ state, progress, message, ...extra }); } catch { /* UI listeners must not break installation. */ }
    }
  };

  async function installedPackage() {
    try {
      const manifest = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
      const packageDir = path.resolve(root, manifest.packageDirectory ?? "");
      const relative = path.relative(path.join(root, "releases"), packageDir);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)
        || manifest.platform !== platform || manifest.arch !== arch
        || manifest.version !== OPENCHATCUT_VERSION || !/^sha256:[a-f0-9]{64}$/.test(manifest.digest ?? "")) return null;
      const appPath = platform === "darwin" ? path.join(packageDir, "OpenChatCut.app") : path.join(packageDir, "OpenChatCut.AppImage");
      const executable = platform === "darwin" ? path.join(appPath, "Contents", "MacOS", "OpenChatCut") : appPath;
      if (!(await exists(executable))) return null;
      const version = platform === "darwin" ? await macVersion(appPath) : manifest.version;
      if (version !== OPENCHATCUT_VERSION) return null;
      const installed = { installed: true, managed: true, version, appPath, executable };
      if (platform === 'darwin') { const bg = backgroundRuntimePaths(installed, root); installed.backgroundAppPath = bg.appPath; installed.backgroundExecutable = bg.executable; }
      return installed;
    } catch { return null; }
  }

  async function externalPackage() {
    const candidates = existingAppPaths ?? (platform === "darwin"
      ? [path.join(home, "Applications", "OpenChatCut.app"), "/Applications/OpenChatCut.app"]
      : platform === "win32" ? [path.join(home, "AppData", "Local", "Programs", "OpenChatCut", "OpenChatCut.exe")] : []);
    for (const appPath of candidates) {
      const executable = platform === "darwin" ? path.join(appPath, "Contents", "MacOS", "OpenChatCut") : appPath;
      if (await exists(executable)) {
        const installed = { installed: true, managed: false, version: platform === "darwin" ? await macVersion(appPath) : null, appPath, executable };
        // Keep other external versions untouched while allowing the verified
        // pinned version to be installed alongside them in our managed folder.
        if (platform === 'darwin' && installed.version !== OPENCHATCUT_VERSION) continue;
        if (platform === 'darwin') { const bg = backgroundRuntimePaths(installed, root); installed.backgroundAppPath = bg.appPath; installed.backgroundExecutable = bg.executable; }
        return installed;
      }
    }
    return null;
  }

  async function status() {
    const installed = await installedPackage() ?? await externalPackage();
    if (runtime.state === "running" && runtime.origin && !await editorReady(runtime.origin)) {
      delete runtime.origin;
      Object.assign(runtime, { state: "ready", message: "OpenChatCut 已安装，请重新启动编辑器" });
    }
    const busy = ["downloading", "verifying", "installing", "launching", "stopping", "stopped", "failed"].includes(runtime.state);
    return { installed: false, managed: false, version: null, appPath: null, executable: null,
      ...installed, supported, installDirectory: root, releaseUrl: OPENCHATCUT_RELEASE_URL,
      state: busy || runtime.state === "running" ? runtime.state : installed ? "ready" : supported ? "not_installed" : "unsupported",
      message: runtime.message || (installed ? "OpenChatCut 已安装" : supported ? "按需下载安装 OpenChatCut" : unsupportedMessage),
      progress: installed && !busy ? 100 : runtime.progress,
      ...(runtime.origin ? { baseUrl: runtime.origin, editorUrl: `${runtime.origin}/`, mcpUrl: `${runtime.origin}/api/external-mcp/mcp` } : {}),
    };
  }

  async function request(url, options = {}, timeout = requestTimeoutMs) {
    if (typeof fetchImpl !== "function") throw errorWithCode("当前运行环境缺少下载能力", "FETCH_UNAVAILABLE");
    return fetchImpl(url, { ...options, signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
  }

  async function acquireLock() {
    const lock = path.join(root, ".install-lock");
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await mkdir(lock, { mode: 0o700 });
        try { await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid }), { mode: 0o600 }); }
        catch (error) { await rm(lock, { recursive: true, force: true }).catch(() => {}); throw error; }
        return async () => rm(lock, { recursive: true, force: true });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let stale = false;
        try {
          const owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8"));
          if (Number.isInteger(owner.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0); } catch (failure) { stale = failure.code === "ESRCH"; }
          }
        } catch {
          stale = Date.now() - (await stat(lock)).mtimeMs > 60_000;
        }
        if (!stale) throw errorWithCode("另一处安装正在进行，请稍后重试", "INSTALL_BUSY");
        await rm(lock, { recursive: true, force: true });
      }
    }
    throw errorWithCode("无法取得安装锁，请重试", "INSTALL_BUSY");
  }

  async function officialAsset(signal) {
    notify("downloading", 1, "读取官方发行包信息");
    const response = await request(RELEASE_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": "AIYOUcodex-OpenChatCut" }, signal });
    if (!response.ok) throw errorWithCode(`官方发行信息读取失败（HTTP ${response.status}）`, "RELEASE_UNAVAILABLE");
    const release = await response.json();
    const asset = release.assets?.find(candidate => candidate.name === selectedAsset);
    const expectedUrl = `https://github.com/0xsline/OpenChatCut/releases/download/v${OPENCHATCUT_VERSION}/${selectedAsset}`;
    if (release.tag_name !== `v${OPENCHATCUT_VERSION}` || release.draft || !asset
      || asset.browser_download_url !== expectedUrl || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")
      || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw errorWithCode("官方发行包或 SHA-256 信息不完整，未执行安装", "INVALID_RELEASE");
    }
    return asset;
  }

  async function downloadRanged(asset, destination, signal) {
    const chunkSize = Math.max(1, Math.floor(downloadChunkBytes));
    const count = Math.ceil(asset.size / chunkSize);
    const cache = path.join(root, ".downloads", asset.digest.slice(7));
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const sizes = Array(count).fill(0);
    const chunkPath = index => path.join(cache, `${index}.part`);
    const expectedSize = index => Math.min(chunkSize, asset.size - index * chunkSize);
    for (let index = 0; index < count; index++) {
      try {
        const size = (await stat(chunkPath(index))).size;
        if (size > expectedSize(index)) await rm(chunkPath(index), { force: true });
        else sizes[index] = size;
      } catch { /* New range or a previously interrupted download. */ }
    }
    const control = new AbortController();
    const rangeSignal = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
    let lastUpdate = 0;
    const report = (force = false) => {
      if (!force && Date.now() - lastUpdate < 200) return;
      lastUpdate = Date.now();
      const received = sizes.reduce((sum, size) => sum + size, 0);
      notify("downloading", Math.min(85, 2 + Math.floor(received / asset.size * 83)), "下载官方 OpenChatCut（支持断点续传）",
        { totalBytes: asset.size, downloadedBytes: received });
    };
    const part = async index => {
      const length = expectedSize(index);
      const end = index * chunkSize + length - 1;
      for (let attempt = 1; attempt <= downloadAttempts; attempt++) {
        let file;
        try {
          rangeSignal.throwIfAborted();
          if (sizes[index] === length) return;
          const start = index * chunkSize + sizes[index];
          const response = await request(asset.browser_download_url, { signal: rangeSignal,
            headers: { Range: `bytes=${start}-${end}` } }, downloadTimeoutMs);
          if (response.status === 200) {
            await response.body?.cancel().catch(() => {});
            throw errorWithCode("下载服务器未提供范围下载", "RANGE_UNSUPPORTED");
          }
          if (response.status !== 206 || !response.body
            || response.headers.get("content-range") !== `bytes ${start}-${end}/${asset.size}`) {
            await response.body?.cancel().catch(() => {});
            throw errorWithCode("官方范围下载响应无效", "INVALID_RANGE");
          }
          file = await open(chunkPath(index), "a", 0o600);
          for await (const chunk of response.body) {
            rangeSignal.throwIfAborted();
            const bytes = Buffer.from(chunk);
            if (sizes[index] + bytes.length > length) throw errorWithCode("下载范围大小不符", "INVALID_SIZE");
            let offset = 0;
            while (offset < bytes.length) {
              const written = await file.write(bytes, offset, bytes.length - offset);
              if (!written.bytesWritten) throw errorWithCode("无法写入下载文件", "DOWNLOAD_FAILED");
              offset += written.bytesWritten;
              sizes[index] += written.bytesWritten;
            }
            report();
          }
          await file.sync(); await file.close(); file = null;
          if (sizes[index] !== length) throw errorWithCode("下载范围尚未完整，继续续传", "INCOMPLETE_RANGE");
          report(true);
          return;
        } catch (error) {
          await file?.close().catch(() => {});
          if (error.code === "INVALID_SIZE") {
            await rm(chunkPath(index), { force: true }); sizes[index] = 0;
          }
          if (rangeSignal.aborted || error.code === "RANGE_UNSUPPORTED" || attempt === downloadAttempts) throw error;
          await sleep(Math.min(attempt * 500, 2000));
        }
      }
    };
    report(true);
    // Confirm official range support before starting other requests.
    await part(0);
    let next = 1;
    let failure;
    await Promise.all(Array.from({ length: Math.min(count - 1, Math.max(1, Math.floor(downloadConcurrency))) }, async () => {
      try {
        while (next < count) await part(next++);
      } catch (error) {
        if (!failure) { failure = error; control.abort(); }
      }
    }));
    if (failure) throw failure;
    signal?.throwIfAborted();
    notify("verifying", 87, "校验完整官方发行包 SHA-256");
    const hash = createHash("sha256");
    let received = 0;
    const file = await open(destination, "w", 0o600);
    try {
      for (let index = 0; index < count; index++) {
        for await (const chunk of createReadStream(chunkPath(index))) {
          signal?.throwIfAborted();
          received += chunk.length; hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) {
            const written = await file.write(chunk, offset, chunk.length - offset);
            if (!written.bytesWritten) throw errorWithCode("无法写入发行包", "DOWNLOAD_FAILED");
            offset += written.bytesWritten;
          }
        }
      }
      await file.sync();
    } finally { await file.close(); }
    if (received !== asset.size || `sha256:${hash.digest("hex")}` !== asset.digest) {
      await rm(cache, { recursive: true, force: true });
      await rmdir(path.dirname(cache)).catch(() => {});
      throw errorWithCode("发行包 SHA-256 或完整大小校验失败，未执行安装", "DIGEST_MISMATCH");
    }
    await rm(cache, { recursive: true, force: true });
    await rmdir(path.dirname(cache)).catch(() => {});
  }

  async function download(asset, destination, signal) {
    if (Number.isSafeInteger(downloadChunkBytes) && downloadChunkBytes > 0 && asset.size > downloadChunkBytes) {
      try { await downloadRanged(asset, destination, signal); return; }
      catch (error) {
        if (error.code !== "RANGE_UNSUPPORTED") throw error;
        await rm(path.join(root, ".downloads", asset.digest.slice(7)), { recursive: true, force: true });
        await rmdir(path.join(root, ".downloads")).catch(() => {});
      }
    }
    for (let attempt = 1; attempt <= downloadAttempts; attempt++) {
      let file;
      try {
        signal?.throwIfAborted();
        notify("downloading", 2, attempt === 1 ? "下载官方 OpenChatCut" : `重新下载官方发行包（${attempt}/${downloadAttempts}）`, { totalBytes: asset.size, downloadedBytes: 0 });
        const response = await request(asset.browser_download_url, { signal }, downloadTimeoutMs);
        if (!response.ok || !response.body) throw errorWithCode(`下载失败（HTTP ${response.status}）`, "DOWNLOAD_FAILED");
        file = await open(destination, "w", 0o600);
        const hash = createHash("sha256");
        let received = 0;
        let lastUpdate = 0;
        for await (const chunk of response.body) {
          signal?.throwIfAborted();
          const bytes = Buffer.from(chunk);
          received += bytes.length;
          if (received > asset.size) throw errorWithCode("下载大小与官方发行信息不符", "INVALID_SIZE");
          hash.update(bytes);
          let offset = 0;
          while (offset < bytes.length) {
            const written = await file.write(bytes, offset, bytes.length - offset);
            if (!written.bytesWritten) throw errorWithCode("无法写入下载文件", "DOWNLOAD_FAILED");
            offset += written.bytesWritten;
          }
          if (Date.now() - lastUpdate > 200 || received === asset.size) {
            lastUpdate = Date.now();
            notify("downloading", Math.min(85, 2 + Math.floor(received / asset.size * 83)), "下载官方 OpenChatCut", { totalBytes: asset.size, downloadedBytes: received });
          }
        }
        await file.sync(); await file.close(); file = null;
        notify("verifying", 87, "校验官方发行包 SHA-256");
        if (received !== asset.size) throw errorWithCode("发行包下载不完整", "INVALID_SIZE");
        if (`sha256:${hash.digest("hex")}` !== asset.digest) throw errorWithCode("发行包 SHA-256 校验失败，未执行安装", "DIGEST_MISMATCH");
        return;
      } catch (error) {
        await file?.close().catch(() => {});
        await rm(destination, { force: true });
        if (signal?.aborted || attempt === downloadAttempts) throw error;
        await sleep(Math.min(attempt * 500, 2000));
      }
    }
  }

  async function performInstall(signal) {
    let unlock; let staging; let published;
    try {
      const before = await status();
      if (before.installed) { notify("ready", 100, "OpenChatCut 已安装，保留现有安装与工程"); return status(); }
      if (!supported) { notify("unsupported", 0, unsupportedMessage); return status(); }
      unlock = await acquireLock();
      // Another process may have finished before this process obtained the lock.
      if (await installedPackage()) { notify("ready", 100, "OpenChatCut 已安装"); return status(); }
      staging = path.join(root, `.staging-${randomUUID()}`);
      await mkdir(staging, { mode: 0o700 });
      const asset = await officialAsset(signal);
      const archive = path.join(staging, selectedAsset);
      await download(asset, archive, signal);
      signal?.throwIfAborted();
      notify("installing", 91, "安装到用户应用目录");
      const packageDir = path.join(staging, "package");
      await mkdir(packageDir);
      if (platform === "darwin") {
        try { await execFileAsync("/usr/bin/ditto", ["-x", "-k", archive, packageDir], { timeout: 10 * 60_000, maxBuffer: 256 * 1024, signal }); }
        catch { throw errorWithCode("官方应用解压失败，请重试", "EXTRACT_FAILED"); }
        const appPath = path.join(packageDir, "OpenChatCut.app");
        if (await macVersion(appPath) !== OPENCHATCUT_VERSION
          || !(await exists(path.join(appPath, "Contents", "MacOS", "OpenChatCut")))) {
          throw errorWithCode("解压后的应用版本或可执行文件无效", "INVALID_PACKAGE");
        }
      } else {
        await rename(archive, path.join(packageDir, "OpenChatCut.AppImage"));
        await chmod(path.join(packageDir, "OpenChatCut.AppImage"), 0o755);
      }
      signal?.throwIfAborted();
      const relative = path.join("releases", `v${OPENCHATCUT_VERSION}-${platform}-${arch}-${randomUUID()}`);
      await mkdir(path.join(root, "releases"), { recursive: true });
      published = path.join(root, relative);
      await rename(packageDir, published);
      const pointer = path.join(root, `current-${randomUUID()}.tmp`);
      try {
        const file = await open(pointer, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify({ version: OPENCHATCUT_VERSION, platform, arch, digest: asset.digest,
            assetName: asset.name, packageDirectory: relative, installedAt: new Date().toISOString() }));
          await file.sync();
        } finally { await file.close(); }
        await rename(pointer, path.join(root, "current.json"));
        published = null; // The pointer now owns this package, even if later cleanup fails.
      } finally { await rm(pointer, { force: true }); }
      notify("ready", 100, "OpenChatCut 安装完成");
      return status();
    } catch (error) {
      notify("failed", runtime.progress, signal?.aborted ? "安装已取消，可以重试" : error.code
        ? error.message : "OpenChatCut 安装失败，请检查网络、可用空间后重试");
      return { ...await status(), errorCode: signal?.aborted ? "CANCELLED" : error.code ?? "INSTALL_FAILED" };
    } finally {
      if (published) await rm(published, { recursive: true, force: true }).catch(() => {});
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
      await unlock?.().catch(() => {});
    }
  }

  function install({ signal, onProgress: listener } = {}) {
    if (listener) listeners.add(listener);
    if (!runtime.install) runtime.install = performInstall(signal).finally(() => { runtime.install = null; });
    return runtime.install.finally(() => { if (listener) listeners.delete(listener); });
  }

  async function rememberedPort() {
    try {
      const value = Number((await readFile(path.join(home, ".openchatcut", "mcp-port"), "utf8")).trim());
      return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : null;
    } catch { return null; }
  }

  async function editorReady(origin) {
    try {
      const response = await request(`${origin}/api/external-agent/bootstrap`, { method: "POST", headers: {
        Origin: origin, "Sec-Fetch-Site": "none", "Content-Type": "application/json", "x-openchatcut-editor-bootstrap": "1",
      }, body: "{}" }, 1500);
      if (!response.ok || typeof (await response.json()).mcpToken !== "string") return false;
      const page = await request(`${origin}/`, {}, 1500);
      return page.ok && /openchatcut/i.test(await page.text());
    } catch { return false; }
  }

  const processRecordPath = path.join(root, 'runtime-processes.json');
  async function launchRecords(installed) {
    if (platform !== 'linux') return [];
    try {
      const record = JSON.parse(await readFile(processRecordPath, 'utf8'));
      if (record.version !== 1 || record.application !== installed.executable || !Array.isArray(record.processes)) return [];
      return record.processes.filter(row => Number.isInteger(row?.pid) && row.pid > 1
        && typeof row.executable === 'string' && row.executable.startsWith('/') && /^[1-9]\d*$/u.test(row.startTime || ''));
    } catch { return []; }
  }
  async function rememberLaunchedProcesses(installed, child) {
    if (platform !== 'linux' || !Number.isInteger(child?.pid)) return;
    const rows = await listProcesses();
    const launched = rows.find(row => row.pid === child.pid && /^[1-9]\d*$/u.test(row.startTime || '') && row.executable?.startsWith('/'));
    if (!launched) return;
    const processes = ownedOpenChatCutProcesses(rows, installed, platform, [launched])
      .filter(row => /^[1-9]\d*$/u.test(row.startTime || ''))
      .map(({ pid, startTime, executable }) => ({ pid, startTime, executable }));
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = `${processRecordPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, application: installed.executable, processes }), { mode: 0o600 });
      await rename(temporary, processRecordPath);
    } finally { await rm(temporary, { force: true }); }
  }

  async function performLaunch({ port = 5199, background = true, signal, timeoutMs = startupTimeoutMs } = {}) {
    let child; let exited; let spawnFailure;
    try {
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw errorWithCode("无效的本地端口", "INVALID_PORT");
      const installed = await status();
      const knownPorts = new Set([await rememberedPort(), port].filter(Boolean));
      for (const candidate of knownPorts) {
        const origin = `http://127.0.0.1:${candidate}`;
        if (await editorReady(origin)) {
          const rows = platform === 'darwin' && background ? await listProcesses() : [];
          const backgroundProcess = rows.find(row => row.executable === installed.backgroundExecutable);
          const rootProcess = backgroundProcess || rows.find(row => row.executable === installed.executable);
          if (background && !backgroundProcess) await hideOpenChatCutApplication(installed, { platform, execFileAsync, listProcesses });
          runtime.serviceId = rootProcess ? `${candidate}:${rootProcess.pid}` : runtime.serviceId;
          runtime.origin = origin; notify("running", 100, "已连接本地 OpenChatCut");
          return { ...await status(), started: true, reused: true, requestedPort: port, port: candidate, serviceId: runtime.serviceId, backgroundMode: backgroundProcess ? 'windowless' : 'hidden' };
        }
      }
      if (!installed.installed) return { ...installed, started: false, errorCode: "NOT_INSTALLED" };
      notify("launching", 100, "启动本地 OpenChatCut 编辑器");
      const launchEnv = { ...env };
      // Electron-based hosts set this; inheriting it turns the app into a Node process.
      delete launchEnv.ELECTRON_RUN_AS_NODE;
      delete launchEnv.CC_SMOKE;
      delete launchEnv.CC_SMOKE_RENDER;
      delete launchEnv.CC_DESKTOP_DEV_URL;
      if (platform === "darwin" && background) {
        const backgroundRuntime = await prepareBackground(installed, root);
        child = spawnImpl(backgroundRuntime.executable, [], { detached: true, stdio: 'ignore',
          env: { PATH: launchEnv.PATH || '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home }, windowsHide: true });
        child.on('error', () => { spawnFailure = true; });
        child.on('exit', code => { exited = code ?? -1; });
      } else {
        // Upstream persists its actual port before reporting readiness. Detached
        // apps must not retain pipes to this host, which may restart or exit.
        child = spawnImpl(installed.executable, [], { detached: true, stdio: "ignore", env: launchEnv, windowsHide: background });
        child.on("error", () => { spawnFailure = true; });
        child.on("exit", code => { exited = code ?? -1; });
      }
      const deadline = Date.now() + timeoutMs;
      do {
        signal?.throwIfAborted();
        if (spawnFailure) throw errorWithCode("无法启动 OpenChatCut 应用", "LAUNCH_FAILED");
        const remembered = await rememberedPort();
        const origins = new Set([remembered ? `http://127.0.0.1:${remembered}` : null,
          `http://127.0.0.1:${port}`].filter(Boolean));
        for (const origin of origins) {
          if (await editorReady(origin)) {
            const rows = platform === 'darwin' && background ? await listProcesses() : [];
            const rootProcess = rows.find(row => row.executable === installed.backgroundExecutable) || rows.find(row => row.executable === installed.executable);
            runtime.serviceId = `${new URL(origin).port}:${rootProcess?.pid || child?.pid || randomUUID()}`;
            if (exited === undefined) await rememberLaunchedProcesses(installed, child);
            runtime.origin = origin; notify("running", 100, "OpenChatCut 编辑器已就绪");
            child?.unref();
            return { ...await status(), started: true, reused: false, pid: child?.pid ?? null,
              requestedPort: port, port: Number(new URL(origin).port), serviceId: runtime.serviceId,
              backgroundMode: platform === 'darwin' && background ? 'windowless' : 'desktop' };
          }
        }
        if (exited !== undefined) throw errorWithCode("OpenChatCut 后台服务在就绪前退出，请检查运行依赖。", "APP_EXITED");
        await sleep(400);
      } while (Date.now() < deadline);
      throw errorWithCode("应用已启动，但本地编辑器未在时限内就绪，可以重试连接", "STARTUP_TIMEOUT");
    } catch (error) {
      child?.unref();
      notify("failed", runtime.progress, signal?.aborted ? "启动等待已取消，可以重试连接" : error.code ? error.message : "OpenChatCut 后台启动失败，请检查运行依赖。");
      return { ...await status(), started: false, errorCode: signal?.aborted ? "CANCELLED" : error.code ?? "LAUNCH_FAILED" };
    }
  }

  function launch(options = {}) {
    if (!runtime.launch) runtime.launch = performLaunch(options).finally(() => { runtime.launch = null; });
    return runtime.launch;
  }

  async function stop() {
    if (runtime.stop) return runtime.stop;
    runtime.stop = (async () => {
      if (runtime.launch) await runtime.launch;
      const installed = await installedPackage() ?? await externalPackage();
      if (!installed) return { ...await status(), stopped: true, running: false };
      notify('stopping', 100, '正在彻底关闭 OpenChatCut…');
      const records = await launchRecords(installed);
      let targets = ownedOpenChatCutProcesses(await listProcesses(), installed, platform, records);
      const identities = new Map(targets.map(row => [row.pid, row]));
      const remaining = async () => {
        const rows = await listProcesses();
        // A PID reused during shutdown is no longer an owned root. Exclude it
        // before walking descendants, so its new children are not adopted.
        const eligible = rows.filter(row => !identities.has(row.pid)
          || sameOpenChatCutProcessIdentity(row, identities.get(row.pid), platform));
        const current = ownedOpenChatCutProcesses(eligible, installed, platform, records);
        return rows.filter(row => {
          const previous = identities.get(row.pid);
          if (previous) return sameOpenChatCutProcessIdentity(row, previous, platform);
          if (!current.some(owned => owned.pid === row.pid)) return false;
          identities.set(row.pid, row); return true;
        });
      };
      const signal = async (rows, value) => {
        const observed = await listProcesses();
        for (const row of rows) if (observed.some(current => sameOpenChatCutProcessIdentity(current, row, platform))) {
          try { signalProcess(row.pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
      };
      await signal(targets, 'SIGTERM');
      const deadline = Date.now() + shutdownTimeoutMs;
      while ((targets = await remaining()).length && Date.now() < deadline) await sleep(100);
      if (targets.length) {
        await signal(targets, 'SIGKILL');
        for (let attempt = 0; attempt < 10 && (targets = await remaining()).length; attempt++) await sleep(100);
      }
      if (targets.length) throw errorWithCode('OpenChatCut 进程尚未退出，请重试彻底关闭。', 'STOP_FAILED');
      if (runtime.origin && await editorReady(runtime.origin)) throw errorWithCode('本地剪辑服务仍在运行，未确认彻底关闭。', 'STOP_FAILED');
      if (platform === 'linux') await rm(processRecordPath, { force: true });
      delete runtime.origin;
      notify('stopped', 100, 'OpenChatCut 已彻底关闭，项目已保留');
      return { ...await status(), stopped: true, running: false, baseUrl: null, editorUrl: null, mcpUrl: null };
    })().catch(async error => {
      notify('failed', 100, error.message);
      return { ...await status(), stopped: false, errorCode: error.code || 'STOP_FAILED' };
    }).finally(() => { runtime.stop = null; });
    return runtime.stop;
  }

  return { status, install, launch, stop };
}
