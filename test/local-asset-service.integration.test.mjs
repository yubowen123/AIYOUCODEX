import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../vendor/codex-workspace-enhancer/asset-browser/server.js", import.meta.url));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [fileName, content] of Object.entries(files)) {
    const name = Buffer.from(fileName);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(directory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, eocd]);
}

test("local asset API scans multiple folders and keeps project moves logical", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-local-assets-"));
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const target = path.join(root, "target");
  await Promise.all([mkdir(first), mkdir(second), mkdir(target)]);
  const promptPath = path.join(first, "hero-prompt.md");
  const audioPath = path.join(first, "character-voice.mp3");
  const imagePath = path.join(second, "角色海报.png");
  const videoPath = path.join(second, "final-trailer.mp4");
  const wordPath = path.join(first, "production-notes.docx");
  await Promise.all([
    writeFile(promptPath, "# Hero\nOriginal prompt"),
    writeFile(audioPath, "audio-fixture"),
    writeFile(imagePath, "image-fixture"),
    writeFile(videoPath, "video-fixture"),
    writeFile(wordPath, createStoredZip({
      "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"></Types>",
      "word/document.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Word original</w:t></w:r></w:p><w:sectPr/></w:body></w:document>",
    })),
  ]);

  const port = await freePort();
  const token = "local-asset-service-integration-token-0000000001";
  const tokenPath = path.join(root, "token");
  await writeFile(tokenPath, token);
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      ASSET_BROWSER_TOKEN_FILE: tokenPath,
      ASSET_BROWSER_CONFIG: path.join(root, "config.json"),
      ASSET_BROWSER_LEDGER: path.join(root, "ledger.json"),
      GENERATION_TICKETS: path.join(root, "generation.json"),
      GENERATION_THREAD_BINDINGS: path.join(root, "bindings.json"),
      DUPLICATE_CLEANUP_LEDGER: path.join(root, "duplicates.json"),
      DUPLICATE_QUARANTINE: path.join(root, "quarantine"),
      RHYTHM_CONTROL_REGISTRY: path.join(root, "rhythm.json"),
      PROMPT_LIBRARY_ROOT: path.join(root, "prompts"),
      THREE_D_TASKS: path.join(root, "three-d.json"),
      ASSET_ACTION_TRASH: path.join(root, "trash"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  async function request(route, options = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      ...options,
      headers: { "content-type": "application/json", "x-asset-console-token": token, ...(options.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || String(response.status));
    return data;
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { await request("/api/config"); ready = true; break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, logs);

    const sourceProject = (await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Source", folders: [first, second] }),
    })).project;
    const targetProject = (await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Target", folders: [target] }),
    })).project;
    assert.deepEqual(sourceProject.folders, [first, second]);

    const initial = await request(`/api/library?project=${sourceProject.id}`);
    assert.deepEqual(initial.counts, { all: 5, text: 2, image: 1, audio: 1, video: 1 });
    assert.equal(initial.assets.find((asset) => asset.name === "hero-prompt.md").category, "提示词");
    assert.equal(initial.assets.find((asset) => asset.name === "character-voice.mp3").category, "角色声音");

    const prompt = initial.assets.find((asset) => asset.name === "hero-prompt.md");
    const read = await request(`/api/text?id=${encodeURIComponent(prompt.id)}`);
    assert.match(read.content, /Original prompt/);
    await request("/api/text", { method: "PUT", body: JSON.stringify({ assetId: prompt.id, content: "# Hero\nEdited locally" }) });
    assert.match((await request(`/api/text?id=${encodeURIComponent(prompt.id)}`)).content, /Edited locally/);

    const word = initial.assets.find((asset) => asset.name === "production-notes.docx");
    assert.match((await request(`/api/text?id=${encodeURIComponent(word.id)}`)).content, /Word original/);
    await request("/api/text", { method: "PUT", body: JSON.stringify({ assetId: word.id, content: "Word edited\nSecond line" }) });
    assert.match((await request(`/api/text?id=${encodeURIComponent(word.id)}`)).content, /Word edited\nSecond line/);

    await request("/api/assets/metadata", {
      method: "PATCH",
      body: JSON.stringify({ assetId: prompt.id, category: "剧本", tags: ["已审核"] }),
    });
    const tagged = (await request(`/api/library?project=${sourceProject.id}`)).assets.find((asset) => asset.id === prompt.id);
    assert.equal(tagged.category, "剧本");
    assert.deepEqual(tagged.tags, ["已审核"]);

    await request("/api/assets/assign", {
      method: "POST",
      body: JSON.stringify({ assetId: prompt.id, targetProjectId: targetProject.id }),
    });
    assert.equal((await request(`/api/library?project=${sourceProject.id}`)).assets.some((asset) => asset.id === prompt.id), false);
    assert.equal((await request(`/api/library?project=${targetProject.id}`)).assets.some((asset) => asset.id === prompt.id), true);
    assert.equal(existsSync(promptPath), true, "logical move must not move the file on disk");

    const assigned = (await request(`/api/library?project=${targetProject.id}`)).assets.find((asset) => asset.id === prompt.id);
    const renamed = await request("/api/assets/rename", {
      method: "POST",
      body: JSON.stringify({ assetId: assigned.id, name: "hero-script" }),
    });
    assert.equal(renamed.result.name, "hero-script.md");
    const renamedPath = path.join(first, "hero-script.md");
    assert.equal(existsSync(renamedPath), true);

    await assert.rejects(() => request("/api/assets/delete", {
      method: "DELETE",
      body: JSON.stringify({ assetId: renamed.result.assetId, confirmName: "wrong.md" }),
    }), /完整文件名/);
    await request("/api/assets/delete", {
      method: "DELETE",
      body: JSON.stringify({ assetId: renamed.result.assetId, confirmName: "hero-script.md" }),
    });
    assert.equal(existsSync(renamedPath), false);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  }
});
