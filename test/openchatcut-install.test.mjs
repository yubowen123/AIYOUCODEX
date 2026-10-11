import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOpenChatCutInstaller, OPENCHATCUT_VERSION, openChatCutInstallDirectory } from "../lib/openchatcut-install.mjs";

const bytes = Buffer.from("verified-official-package-fixture");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const installerOptions = { existingAppPaths: [], sleep: async () => {}, downloadAttempts: 1 };

async function fixture(t, { platform = "darwin", arch = "arm64", ...overrides } = {}) {
  const base = process.env.AIYOUCODEX_TEST_OUTPUT_DIR || os.tmpdir();
  await mkdir(base, { recursive: true });
  const home = await mkdtemp(path.join(base, "openchatcut-install-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const installDir = path.join(home, "apps");
  const assetName = platform === "linux" ? `OpenChatCut-${OPENCHATCUT_VERSION}-x86_64.AppImage`
    : `OpenChatCut-${OPENCHATCUT_VERSION}-${arch}.zip`;
  const asset = { name: assetName, size: bytes.length, digest,
    browser_download_url: `https://github.com/0xsline/OpenChatCut/releases/download/v${OPENCHATCUT_VERSION}/${assetName}` };
  const requests = []; const commands = []; const progress = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return url.includes("api.github.com") ? json({ tag_name: `v${OPENCHATCUT_VERSION}`, assets: [asset] }) : new Response(bytes);
  };
  const extract = async (command, args, options) => {
    commands.push({ command, args, options });
    assert.equal(command, "/usr/bin/ditto");
    assert.deepEqual(args.slice(0, 2), ["-x", "-k"]);
    const app = path.join(args[3], "OpenChatCut.app", "Contents");
    await mkdir(path.join(app, "MacOS"), { recursive: true });
    await writeFile(path.join(app, "MacOS", "OpenChatCut"), "official executable");
    await writeFile(path.join(app, "Info.plist"), `<plist><dict><key>CFBundleShortVersionString</key><string>${OPENCHATCUT_VERSION}</string></dict></plist>`);
    return { stdout: "", stderr: "" };
  };
  const options = { ...installerOptions, home, platform, arch, installDir, fetchImpl, execFileAsync: extract,
    onProgress: update => progress.push(update), ...overrides };
  return { home, installDir, asset, requests, commands, progress, options,
    installer: createOpenChatCutInstaller(options), extract, fetchImpl };
}

for (const arch of ["arm64", "x64"]) {
  test(`mac ${arch}: official digest is verified before unpacking and package publication`, async t => {
    const f = await fixture(t, { arch });
    const result = await f.installer.install();
    assert.equal(result.installed, true); assert.equal(result.version, "0.2.16"); assert.equal(result.managed, true);
    assert.equal(result.state, "ready"); assert.equal(result.progress, 100);
    assert.ok(result.executable.startsWith(path.join(f.installDir, "releases")));
    assert.equal(f.commands.length, 1); assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].url, f.asset.browser_download_url);
    assert.deepEqual([...new Set(f.progress.map(event => event.state))], ["downloading", "verifying", "installing", "ready"]);
    assert.deepEqual((await readdir(f.installDir)).sort(), ["current.json", "releases"]);
    const manifest = JSON.parse(await readFile(path.join(f.installDir, "current.json"), "utf8"));
    assert.equal(manifest.digest, digest);
    await f.installer.install(); assert.equal(f.requests.length, 2, "repeat install must not download twice");
  });
}

test('incompatible external Mac versions allow a pinned managed install while preserving the external app', async t => {
  for (const version of ['0.2.15', '0.3.0', null]) await t.test(String(version), async t => {
    const f = await fixture(t);
    const appPath = path.join(f.home, 'Applications', 'OpenChatCut.app'), contents = path.join(appPath, 'Contents');
    const executable = path.join(contents, 'MacOS', 'OpenChatCut');
    await mkdir(path.dirname(executable), { recursive: true }); await writeFile(executable, 'existing external executable');
    const plist = version ? `<plist><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>` : '<plist><dict/></plist>';
    await writeFile(path.join(contents, 'Info.plist'), plist);
    const installer = createOpenChatCutInstaller({ ...f.options, existingAppPaths: [appPath] });
    const before = await installer.status();
    assert.equal(before.installed, false); assert.equal(before.supported, true); assert.equal(before.state, 'not_installed');
    const installed = await installer.install();
    assert.equal(installed.installed, true); assert.equal(installed.managed, true); assert.equal(installed.version, OPENCHATCUT_VERSION);
    assert.notEqual(installed.appPath, appPath); assert.equal(f.requests.length, 2);
    assert.equal(await readFile(executable, 'utf8'), 'existing external executable');
    assert.equal(await readFile(path.join(contents, 'Info.plist'), 'utf8'), plist);
  });
});

test('a compatible external Mac version is reused without a download', async t => {
  const f = await fixture(t);
  const appPath = path.join(f.home, 'Applications', 'OpenChatCut.app'), contents = path.join(appPath, 'Contents');
  await mkdir(path.join(contents, 'MacOS'), { recursive: true }); await writeFile(path.join(contents, 'MacOS', 'OpenChatCut'), 'external executable');
  await writeFile(path.join(contents, 'Info.plist'), `<plist><dict><key>CFBundleShortVersionString</key><string>${OPENCHATCUT_VERSION}</string></dict></plist>`);
  const installer = createOpenChatCutInstaller({ ...f.options, existingAppPaths: [appPath] });
  const installed = await installer.install();
  assert.equal(installed.installed, true); assert.equal(installed.managed, false); assert.equal(installed.appPath, appPath);
  assert.equal(f.requests.length, 0); assert.equal(f.commands.length, 0);
});

test("digest mismatch never unpacks an app or touches existing user data", async t => {
  const f = await fixture(t);
  const project = path.join(f.home, ".openchatcut", "project-store-v1.sqlite3");
  await mkdir(path.dirname(project), { recursive: true }); await writeFile(project, "existing user project");
  f.asset.digest = `sha256:${"0".repeat(64)}`;
  const result = await f.installer.install();
  assert.equal(result.installed, false); assert.equal(result.errorCode, "DIGEST_MISMATCH");
  assert.equal(f.commands.length, 0); assert.equal(await readFile(project, "utf8"), "existing user project");
  assert.deepEqual(await readdir(f.installDir), []);
});

test("untrusted release metadata and missing digest are rejected before any package request", async t => {
  const f = await fixture(t);
  delete f.asset.digest;
  const result = await f.installer.install();
  assert.equal(result.errorCode, "INVALID_RELEASE"); assert.equal(f.requests.length, 1); assert.equal(f.commands.length, 0);
});

test("duplicate clicks share the installation while interrupted downloads restart cleanly", async t => {
  let downloads = 0; let releaseRead = 0;
  const f = await fixture(t, { downloadAttempts: 2 });
  const installer = createOpenChatCutInstaller({ ...f.options, downloadAttempts: 2, fetchImpl: async (url, options) => {
    if (url.includes("api.github.com")) { releaseRead++; return f.fetchImpl(url, options); }
    downloads++;
    return new Response(downloads === 1 ? bytes.subarray(0, 8) : bytes);
  } });
  const [one, two] = await Promise.all([installer.install(), installer.install()]);
  assert.equal(one.installed, true); assert.equal(two.appPath, one.appPath);
  assert.equal(releaseRead, 1); assert.equal(downloads, 2); assert.equal(f.commands.length, 1);
});

test("extraction failure leaves no active package and a later install succeeds", async t => {
  let fail = true;
  const f = await fixture(t);
  const installer = createOpenChatCutInstaller({ ...f.options, execFileAsync: async (...args) => {
    if (fail) throw new Error("extract fixture failed"); return f.extract(...args);
  } });
  assert.equal((await installer.install()).errorCode, "EXTRACT_FAILED");
  assert.deepEqual(await readdir(f.installDir), []);
  fail = false;
  assert.equal((await installer.install()).installed, true);
});

test("range downloads resume a truncated chunk and verify the assembled official digest", async t => {
  const f = await fixture(t); const ranges = []; let interrupted = false;
  const installer = createOpenChatCutInstaller({ ...f.options, downloadChunkBytes: 8, downloadConcurrency: 2, downloadAttempts: 2,
    fetchImpl: async (url, options) => {
      if (url.includes("api.github.com")) return f.fetchImpl(url, options);
      const range = options.headers.Range; ranges.push(range);
      const [, startText, endText] = range.match(/^bytes=(\d+)-(\d+)$/);
      const start = Number(startText); const end = Number(endText);
      const part = start === 8 && !interrupted ? (interrupted = true, bytes.subarray(start, start + 3)) : bytes.subarray(start, end + 1);
      return new Response(part, { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
    } });
  const result = await installer.install();
  assert.equal(result.installed, true); assert.equal(f.commands.length, 1);
  assert.ok(ranges.includes("bytes=11-15"), "retry must continue after bytes already written");
  assert.equal(ranges.filter(range => range === "bytes=8-15").length, 1);
  assert.deepEqual((await readdir(f.installDir)).sort(), ["current.json", "releases"]);
});

test("an interrupted range install keeps its partial cache for a later click", async t => {
  const f = await fixture(t); let recover = false; const ranges = [];
  const installer = createOpenChatCutInstaller({ ...f.options, downloadChunkBytes: 8,
    fetchImpl: async (url, options) => {
      if (url.includes("api.github.com")) return f.fetchImpl(url, options);
      const range = options.headers.Range; ranges.push(range);
      const [, startText, endText] = range.match(/^bytes=(\d+)-(\d+)$/);
      const start = Number(startText); const end = Number(endText);
      return new Response(bytes.subarray(start, recover ? end + 1 : start + 3), { status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
    } });
  assert.equal((await installer.install()).errorCode, "INCOMPLETE_RANGE");
  assert.equal(f.commands.length, 0); assert.deepEqual(await readdir(f.installDir), [".downloads"]);
  recover = true;
  assert.equal((await installer.install()).installed, true);
  assert.ok(ranges.includes("bytes=3-7")); assert.equal(ranges.filter(range => range === "bytes=0-7").length, 1);
});

test("range assembly still rejects corrupt content before unpacking", async t => {
  const f = await fixture(t);
  const installer = createOpenChatCutInstaller({ ...f.options, downloadChunkBytes: 8,
    fetchImpl: async (url, options) => {
      if (url.includes("api.github.com")) return f.fetchImpl(url, options);
      const [, startText, endText] = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);
      const start = Number(startText); const end = Number(endText);
      return new Response(Buffer.alloc(end - start + 1), { status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
    } });
  assert.equal((await installer.install()).errorCode, "DIGEST_MISMATCH");
  assert.equal(f.commands.length, 0); assert.equal((await installer.status()).installed, false);
});

test("a server without Range support falls back to a complete digest-checked download", async t => {
  const f = await fixture(t); let downloads = 0;
  const installer = createOpenChatCutInstaller({ ...f.options, downloadChunkBytes: 8,
    fetchImpl: async (url, options) => {
      if (url.includes("api.github.com")) return f.fetchImpl(url, options);
      downloads++; return new Response(bytes);
    } });
  assert.equal((await installer.install()).installed, true);
  assert.equal(downloads, 2); assert.equal(f.commands.length, 1);
  assert.deepEqual((await readdir(f.installDir)).sort(), ["current.json", "releases"]);
});

test("Linux x64 installs the verified AppImage with executable mode without running it", async t => {
  const f = await fixture(t, { platform: "linux", arch: "x64" });
  const result = await f.installer.install();
  assert.equal(result.installed, true); assert.equal(f.commands.length, 0);
  assert.deepEqual(await readFile(result.executable), bytes);
  assert.equal((await stat(result.executable)).mode & 0o777, 0o755);
});

test("unsupported packages are reported honestly and never downloaded", async t => {
  for (const [platform, arch] of [["win32", "x64"], ["win32", "arm64"], ["linux", "arm64"], ["darwin", "ia32"]]) {
    const f = await fixture(t, { platform, arch });
    const result = await f.installer.install();
    assert.equal(result.installed, false); assert.equal(result.supported, false); assert.equal(result.state, "unsupported");
    assert.equal(f.requests.length, 0); assert.ok(result.releaseUrl.endsWith("v0.2.16"));
  }
});

test("a live cross-process install lock is respected without deleting it", async t => {
  const f = await fixture(t);
  const lock = path.join(f.installDir, ".install-lock");
  await mkdir(lock, { recursive: true }); await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
  const result = await f.installer.install();
  assert.equal(result.errorCode, "INSTALL_BUSY"); assert.equal(f.requests.length, 0);
  assert.ok((await stat(lock)).isDirectory());
});

test("an aborted installation releases its lock and remains retryable", async t => {
  const f = await fixture(t); const control = new AbortController(); control.abort();
  const result = await f.installer.install({ signal: control.signal });
  assert.equal(result.errorCode, "CANCELLED"); assert.equal(result.installed, false);
  assert.deepEqual(await readdir(f.installDir), []);
  assert.equal((await f.installer.install()).installed, true);
});

test("launch discovers the actual server port and uses the official bootstrap without leaking tokens", async t => {
  const f = await fixture(t); const installed = await f.installer.install();
  let started = false;
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdout.destroy = () => {}; child.stderr.destroy = () => {}; child.unref = () => {}; child.pid = 42;
  const installer = createOpenChatCutInstaller({ ...f.options, env: { ELECTRON_RUN_AS_NODE: "1", CC_SMOKE: "1", KEEP_THIS: "yes" },
    spawnImpl: (executable, args, options) => {
      assert.equal(executable, installed.executable); assert.deepEqual(args, []);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined); assert.equal(options.env.CC_SMOKE, undefined); assert.equal(options.env.KEEP_THIS, "yes");
      assert.equal(options.stdio, "ignore");
      started = true;
      queueMicrotask(async () => {
        await mkdir(path.join(f.home, ".openchatcut"), { recursive: true });
        await writeFile(path.join(f.home, ".openchatcut", "mcp-port"), "5230\n");
      });
      return child;
    }, fetchImpl: async (url, options) => {
      if (!started || !url.startsWith("http://127.0.0.1:5230")) throw new Error("unavailable");
      if (url.endsWith("/api/external-agent/bootstrap")) {
        assert.equal(options.method, "POST"); assert.equal(options.headers.Origin, "http://127.0.0.1:5230");
        assert.equal(options.headers["Sec-Fetch-Site"], "none");
        assert.equal(options.headers["x-openchatcut-editor-bootstrap"], "1");
        return json({ mcpToken: "test-runtime-only-token" });
      }
      return new Response("<title>OpenChatCut</title>");
    } });
  const result = await installer.launch({ background: false });
  assert.equal(result.started, true); assert.equal(result.port, 5230); assert.equal(result.pid, 42);
  assert.equal(result.mcpUrl, "http://127.0.0.1:5230/api/external-mcp/mcp");
  assert.equal(JSON.stringify(result).includes("test-runtime-only-token"), false);
});

test("mac cold launch uses the windowless companion and reads the actual port", async t => {
  const f = await fixture(t); const installed = await f.installer.install(); let started = false;
  const child = new EventEmitter(); child.pid = 42; child.unref = () => {};
  const installer = createOpenChatCutInstaller({ ...f.options,
    listProcesses: async () => [],
    env: { PATH: "/example/tools:/usr/bin", PRIVATE_TEST_KEY: "must-not-be-transferred", CC_SMOKE:"1", ELECTRON_RUN_AS_NODE:"1" },
    prepareBackground: async (value, root) => { assert.equal(value.appPath, installed.appPath); assert.equal(root, f.installDir); return { executable: '/fixture/background/OpenChatCut' }; },
    spawnImpl: (executable, args, options) => {
      assert.equal(executable, '/fixture/background/OpenChatCut'); assert.deepEqual(args, []);
      assert.deepEqual(options.env, { PATH: "/example/tools:/usr/bin", HOME: f.home });
      assert.equal(options.detached, true); assert.equal(options.stdio, 'ignore');
      started = true;
      return child;
    }, fetchImpl: async url => {
      if (!started || !url.startsWith("http://127.0.0.1:5199")) throw new Error("unavailable");
      return url.endsWith("bootstrap") ? json({ mcpToken: "not-returned" }) : new Response("OpenChatCut");
    } });
  const result = await installer.launch();
  assert.equal(result.started, true); assert.equal(result.editorUrl, "http://127.0.0.1:5199/");
  assert.equal(result.backgroundMode, 'windowless'); assert.equal(result.serviceId, '5199:42');
});

test("an unrelated local service is not accepted as an editor", async t => {
  const f = await fixture(t);
  const installer = createOpenChatCutInstaller({ ...f.options, fetchImpl: async url =>
    url.endsWith("bootstrap") ? json({ mcpToken: "imitated" }) : new Response("Unrelated local app") });
  const result = await installer.launch();
  assert.equal(result.started, false); assert.equal(result.errorCode, "NOT_INSTALLED");
});

test("Windows detects a manually installed app and can connect to its existing server", async t => {
  const f = await fixture(t, { platform: "win32", arch: "x64" });
  const executable = path.join(f.home, "AppData", "Local", "Programs", "OpenChatCut", "OpenChatCut.exe");
  await mkdir(path.dirname(executable), { recursive: true }); await writeFile(executable, "official installed app fixture");
  const installer = createOpenChatCutInstaller({ ...f.options, existingAppPaths: [executable], fetchImpl: async url =>
    url.endsWith("bootstrap") ? json({ mcpToken: "runtime-only" }) : new Response("OpenChatCut") });
  const installed = await installer.status(); assert.equal(installed.installed, true); assert.equal(installed.managed, false);
  const launched = await installer.launch(); assert.equal(launched.started, true); assert.equal(launched.reused, true);
});

test("application management paths stay outside plugin directories", () => {
  assert.equal(openChatCutInstallDirectory({ home: "/example", platform: "darwin" }), "/example/Applications/AIYOUcodex/OpenChatCut");
  assert.ok(openChatCutInstallDirectory({ home: "/example", platform: "linux" }).includes("applications/openchatcut"));
});

test('stop terminates only installed application descendants and retains its package', async t => {
  const f = await fixture(t); const installed = await f.installer.install();
  let rows = [{ pid: 101, parentPid: 1, executable: installed.executable },
    { pid: 102, parentPid: 101, executable: '/example/ffmpeg' },
    { pid: 103, parentPid: 1, executable: '/other/OpenChatCut.app/Contents/MacOS/OpenChatCut' }];
  const signals = [];
  const installer = createOpenChatCutInstaller({ ...f.options, listProcesses: async () => rows,
    signalProcess: (pid, signal) => { signals.push({ pid, signal }); rows = rows.filter(row => row.pid !== pid); } });
  const stopped = await installer.stop();
  assert.equal(stopped.stopped, true); assert.equal(stopped.running, false);
  assert.equal(stopped.state, 'stopped'); assert.equal(stopped.editorUrl, null);
  assert.deepEqual(signals.map(row => row.pid), [101, 102]);
  assert.equal((await installer.status()).installed, true);
  assert.equal((await stat(installed.executable)).isFile(), true);
});

test('stop escalates an unresponsive owned process without killing a reused PID', async t => {
  const f = await fixture(t); const installed = await f.installer.install();
  let rows = [{ pid: 201, parentPid: 1, executable: installed.executable }]; const signals = [];
  const installer = createOpenChatCutInstaller({ ...f.options, shutdownTimeoutMs: 0, listProcesses: async () => rows,
    signalProcess: (pid, signal) => { signals.push(signal); if (signal === 'SIGKILL') rows = [{ pid, parentPid: 1, executable: '/unrelated/process' }]; } });
  assert.equal((await installer.stop()).stopped, true);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('Linux launch records identify mounted AppImage descendants after a host restart without killing same-name apps', async t => {
  const f = await fixture(t, { platform: 'linux', arch: 'x64' }); const installed = await f.installer.install();
  const child = new EventEmitter(); child.pid = 101; child.unref = () => {};
  let started = false;
  let rows = [{ pid: 101, parentPid: 1, startTime: '1000', executable: '/tmp/.mount_occ123/OpenChatCut' },
    { pid: 102, parentPid: 101, startTime: '1010', executable: '/usr/bin/ffmpeg' },
    { pid: 103, parentPid: 1, startTime: '1020', executable: '/other/OpenChatCut' }];
  const installer = createOpenChatCutInstaller({ ...f.options, listProcesses: async () => rows,
    spawnImpl: () => { started = true; return child; }, fetchImpl: async url => {
      if (!started) throw new Error('not running');
      return url.endsWith('bootstrap') ? json({ mcpToken: 'fixture-local-token' }) : new Response('OpenChatCut');
    } });
  assert.equal((await installer.launch()).started, true);
  const recordPath = path.join(f.installDir, 'runtime-processes.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  assert.equal(record.application, installed.executable);
  assert.deepEqual(record.processes.map(row => row.pid), [101, 102]);
  assert.equal((await stat(recordPath)).mode & 0o777, 0o600);
  // The AppImage runtime has exited; its recorded render worker is now orphaned.
  rows = rows.filter(row => row.pid !== 101).map(row => ({ ...row, parentPid: 1 }));
  const signals = [];
  const restarted = createOpenChatCutInstaller({ ...f.options, listProcesses: async () => rows,
    fetchImpl: async () => { throw new Error('fixture service stopped'); },
    signalProcess: (pid, signal) => { signals.push({ pid, signal }); rows = rows.filter(row => row.pid !== pid); } });
  const stopped = await restarted.stop();
  assert.equal(stopped.stopped, true); assert.deepEqual(signals, [{ pid: 102, signal: 'SIGTERM' }]);
  assert.deepEqual(rows.map(row => row.pid), [103]);
  await assert.rejects(readFile(recordPath), { code: 'ENOENT' });
  assert.equal((await restarted.status()).installed, true);
});

test('Linux stop rejects PID reuse even when the new process has the same executable path', async t => {
  const f = await fixture(t, { platform: 'linux', arch: 'x64' }); const installed = await f.installer.install();
  let rows = [{ pid: 201, parentPid: 1, startTime: '1000', executable: installed.executable }]; const signals = [];
  const installer = createOpenChatCutInstaller({ ...f.options, shutdownTimeoutMs: 0, listProcesses: async () => rows,
    signalProcess: (pid, signal) => { signals.push({ pid, signal }); rows = [{ ...rows[0], startTime: '2000' },
      { pid: 202, parentPid: pid, startTime: '2010', executable: '/usr/bin/ffmpeg' }]; } });
  assert.equal((await installer.stop()).stopped, true);
  assert.deepEqual(signals, [{ pid: 201, signal: 'SIGTERM' }]);
  assert.equal(rows[0].startTime, '2000');
  assert.deepEqual(rows.map(row => row.pid), [201, 202]);
});

test('Linux stop rechecks process identity immediately before signalling', async t => {
  const f = await fixture(t, { platform: 'linux', arch: 'x64' }); const installed = await f.installer.install();
  const original = { pid: 301, parentPid: 1, startTime: '1000', executable: installed.executable };
  let reads = 0; const signals = [];
  const installer = createOpenChatCutInstaller({ ...f.options, shutdownTimeoutMs: 0,
    listProcesses: async () => [++reads === 1 ? original : { ...original, startTime: '2000' }],
    signalProcess: (pid, signal) => signals.push({ pid, signal }) });
  assert.equal((await installer.stop()).stopped, true);
  assert.deepEqual(signals, []);
});
