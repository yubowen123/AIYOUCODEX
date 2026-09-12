import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, access, copyFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createArenaHandler } from "../lib/model-arena/http.mjs";
import { ArenaService } from "../lib/model-arena/service.mjs";
import { inspectMedia, runMediaTool, composeVideos } from "../lib/model-arena/media.mjs";
import { streamAssetFile } from "../vendor/codex-workspace-enhancer/asset-browser/media-file-response.js";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable; for (const candidate of candidates) if (await access(candidate).then(() => true, () => false)) { executable = candidate; break; }
let ffmpegAvailable; try { await runMediaTool("ffmpeg", ["-version"]); ffmpegAvailable = true; } catch {}
test("isolated Model Arena browser: H3 configuration, references, preview gate, results, mute composition and reload", {
  timeout: 60000, skip: (!executable || !ffmpegAvailable) && "Requires isolated Chrome and FFmpeg",
}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "arena-ui-")), calls = [];
  const video = path.join(root, "fixture.mp4"), img = path.join(root, "fixture.png");
  await runMediaTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=24", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", video]);
  await runMediaTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=512x512", "-frames:v", "1", img]);
  const arena = new ArenaService({ root: path.join(root, "state"), interval: 100,
    provider: { credentials: { setSession() {} }, preflight: async () => {}, liveCheck: async () => {}, upload: async () => "https://fixture.example/reference.png",
      submit: async model => { calls.push(model.id); return { id: `fixture-task-${model.id}` }; }, poll: async () => ({ state: "succeeded", url: "https://fixture.example/result.mp4" }) },
    download: async (_, destination) => { await copyFile(video, destination); return inspectMedia(destination, "result.mp4"); },
    compose: async (...args) => { try { return await composeVideos(...args); } catch (error) { assert.fail(error.cause?.message || error.message); } },
  }); await arena.ready;
  const json = (res, body, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const readBody = async req => { let data = ""; for await (const chunk of req) { data += chunk; if (data.length > 600000) throw new Error("too large"); } return JSON.parse(data || "{}"); };
  const serveMedia = (req,res,file) => streamAssetFile(req,res,file,{contentType:file.endsWith(".png") ? "image/png" : "video/mp4"});
  const handler = createArenaHandler({ service: arena, readBody, sendJson: json, serveFile: serveMedia, resolveAsset: async ref => { assert.equal(ref, "fixture-image"); return img; } });
  let firstStateRequest = true;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture.local");
    if (url.pathname === "/api/arena/state" && firstStateRequest) { firstStateRequest = false; return json(res, { error: "fixture service starting" }, 503); }
    if (url.pathname === "/api/projects") return json(res, { projects: [{ id: "fixture", name: "测试资产项目" }] });
    if (url.pathname === "/api/library") return json(res, { assets: [{ id: "fixture-image", kind: "image", name: "fixture.png", size: 1000, mediaUrl: "/fixture.png" }], page: { hasMore: false } });
    if (url.pathname === "/fixture.png") return streamAssetFile(req, res, img);
    try { if (!await handler(req, res, url)) { res.writeHead(404); res.end(); } } catch (e) { json(res, { error: e.message }, 500); }
  }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, profile = path.join(root, "browser");
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=980,1200", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => { client?.close(); browser.kill("SIGTERM"); await Promise.race([new Promise(r => browser.once("exit", r)), delay(1000)]); if (browser.exitCode == null) browser.kill("SIGKILL");
    await arena.close(); for (let i = 0; (arena.busy || arena.composing) && i < 200; i++) await delay(20);
    server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: origin + "/model-arena/?threadId=fixture-thread&threadTitle=模型竞技场验证" }));
  const wait = (expression, message, timeout = 12000) => waitForBrowserState(client, expression, message, timeout);
  const evalJS = expression => client.evaluate(expression);
  await wait("!document.getElementById('retry-connect').hidden", "Temporary startup failure offers recovery without closing the panel");
  await evalJS("document.getElementById('retry-connect').click()");
  await wait("document.querySelectorAll('[data-model]').length===6", "Six model configurations load");
  assert.deepEqual(await evalJS("Array.from(document.querySelector('[data-model=h3] select').options).map(o=>o.value)"), ["768P", "2K"]);
  assert.equal(await evalJS("Array.from(document.querySelectorAll('[data-identity-field]')).every(label=>label.hidden)"), true, "Official protocols do not request an unrelated account identity");
  await evalJS("(()=>{const section=document.querySelector('[data-family=seedance]');section.querySelector('[data-secret]').value='fixture-key-not-a-credential';const select=section.querySelector('[data-field=protocol]');select.value='ark';select.dispatchEvent(new Event('change',{bubbles:true}))})()");
  assert.equal(await evalJS("document.querySelector('[data-model=seedance20] [data-model-field=apiId]').value"), "", "Account-specific endpoint IDs are not guessed");
  await evalJS("(()=>{const select=document.querySelector('[data-family=seedance] [data-field=protocol]');select.value='las';select.dispatchEvent(new Event('change',{bubbles:true}))})()");
  assert.equal(await evalJS("document.querySelector('[data-model=seedance20] [data-model-field=apiId]').value"), "dreamina-seedance-2-0-260128", "Switching protocol reads model IDs from runtime metadata");
  assert.equal(await evalJS("document.querySelector('[data-family=seedance] [data-secret]').value"), "fixture-key-not-a-credential", "Protocol changes preserve unsaved key input");
  await evalJS("document.querySelector('[data-family=seedance] [data-secret]').value=''");
  await evalJS("document.querySelectorAll('[data-field=baseUrl]').forEach(i=>{if(!i.value)i.value='https://fixture.example'});document.getElementById('save-config').click()");
  await wait("!document.getElementById('generate-view').hidden", "Save opens generation view immediately");
  assert.equal(await evalJS("document.querySelectorAll('[data-pick]').length"), 6);
  assert.match(await evalJS("document.getElementById('limits').textContent"), /4–15.*9 张图/);
  await evalJS("document.getElementById('library-open').click()"); await wait("document.querySelector('[data-import]')!==null", "Library picker loads persisted project assets");
  await evalJS("document.querySelector('[data-import]').click()"); await wait("document.querySelector('#assets [data-slot]')!==null", "Reference imports without supplier upload");
  assert.equal(calls.length, 0);
  await evalJS("document.getElementById('library-dialog').close();document.querySelector('#assets [data-slot]').click();document.getElementById('prompt').value+='人物从门口走入，固定镜头。';document.getElementById('prompt').dispatchEvent(new Event('input'));document.getElementById('preview').click()");
  await wait("document.getElementById('preview-dialog').open", "Preview displays before billed calls"); assert.equal(calls.length, 0);
  assert.match(await evalJS("document.getElementById('preview-content').textContent"), /768P/);
  await evalJS("document.getElementById('confirm').click();document.getElementById('confirm').click()");
  await wait("document.querySelectorAll('.result-card video').length===6", "All six mocked providers finish and results render", 20000);
  assert.equal(calls.length, 6, "Double click does not create extra model requests");
  assert.equal(await evalJS("Array.from(document.querySelectorAll('video')).every(v=>v.preload==='none')"), true);
  await evalJS("(()=>{const v=document.querySelector('.result-card video');v.muted=true;v.play().catch(()=>{})})()");
  await wait("document.querySelector('.result-card video').currentTime>0", "A result actually plays through the local media endpoint");
  await evalJS("(()=>{const v=document.querySelectorAll('.result-card video')[1];v.muted=true;v.play().catch(()=>{})})()");
  await wait("document.querySelector('.result-card video').paused&&document.querySelectorAll('.result-card video')[1].currentTime>0", "Playing a second result pauses the first");
  assert.equal(await evalJS("document.querySelector('.results-strip').scrollWidth>document.querySelector('.results-strip').clientWidth"), true);
  await evalJS("document.querySelectorAll('[data-select-job]').forEach((input,i)=>input.checked=i<2);document.querySelector('[data-compose=grid]').click()");
  try { await wait("document.querySelector('.composite video')!==null", "Real local FFmpeg composite completes", 20000); }
  catch (error) { assert.fail(`${error.message}; ${JSON.stringify([...arena.runs.values()][0].composite)}`); }
  const output = [...arena.runs.values()][0].composite.output;
  const raw = JSON.parse(await runMediaTool("ffprobe", ["-v", "error", "-show_streams", "-of", "json", arena.assetPath(output)]));
  assert.equal(raw.streams.filter(s => s.codec_type === "audio").length, 0, "Composite contains zero audio streams");
  assert.equal(raw.streams[0].width, 1920); assert.equal(raw.streams[0].height, 540);
  await evalJS("(()=>{const v=document.querySelector('.composite video');v.muted=true;v.play().catch(()=>{})})()");
  await wait("document.querySelector('.composite video').currentTime>0", "Composite plays with real frames");
  if (process.env.AIYOU_ARENA_SCREENSHOT_DIR) {
    const dir = path.resolve(process.env.AIYOU_ARENA_SCREENSHOT_DIR); await mkdir(dir, { recursive: true });
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(path.join(dir, "results.png"), Buffer.from(screenshot.data, "base64"));
  }
  await client.send("Page.reload"); await wait("document.querySelectorAll('[data-pick]').length===6", "Reload restores configured panel");
  assert.match(await evalJS("document.getElementById('prompt').value"), /@图片1/);
  assert.equal(calls.length, 6); await evalJS("document.querySelector('[data-view=results]').click()"); await wait("document.querySelector('.composite video')!==null", "Result and composite survive reload");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 440, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evalJS("document.documentElement.scrollWidth<=innerWidth+1"), true, "Narrow side panel has no page-level horizontal overflow");
});

test("real media composition supports six mixed-aspect videos and full-length muted sequence", {
  timeout: 60000, skip: !ffmpegAvailable && "Requires FFmpeg",
}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "arena-six-media-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const landscape = path.join(root, "landscape.mp4"), portrait = path.join(root, "portrait.mp4");
  for (const [file, size, duration] of [[landscape, "320x180", 1], [portrait, "180x320", 2]]) {
    await runMediaTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=navy:s=${size}:r=24`, "-f", "lavfi", "-i", "sine=frequency=440", "-t", String(duration), "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", file]);
  }
  const inputs = await Promise.all(Array.from({ length: 6 }, async (_, i) => ({
    ...await inspectMedia(i % 2 ? portrait : landscape, "fixture.mp4"), path: i % 2 ? portrait : landscape, label: `Model ${i + 1}`,
  })));
  for (const mode of ["grid", "sequence"]) {
    const destination = path.join(root, `${mode}.mp4`);
    const meta = await composeVideos(inputs, destination, mode);
    const probe = JSON.parse(await runMediaTool("ffprobe", ["-v", "error", "-show_streams", "-of", "json", destination]));
    assert.equal(probe.streams.some(s => s.codec_type === "audio"), false);
    assert.equal(meta.width, mode === "grid" ? 1920 : 1280);
    assert.equal(meta.height, 720);
    assert.ok(Math.abs(meta.duration - (mode === "grid" ? 1 : 9)) < 0.1);
  }
});
