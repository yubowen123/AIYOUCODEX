import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createMediaPlaybackManager } from "../vendor/codex-workspace-enhancer/asset-browser/public/asset-media-lifecycle.js";

class Media {
  constructor() { this.attributes = {}; this.paused = true; this.loads = 0; this.requests = 0; this.events = {}; }
  setAttribute(key, value) { this.attributes[key] = value; if (key === "src") this.requests++; }
  hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
  removeAttribute(key) { delete this.attributes[key]; }
  pause() { this.paused = true; }
  load() { this.loads++; }
  async play() { this.paused = false; if (this.pending) await this.pending; }
  addEventListener(name, callback) { this.events[name] = callback; }
}

test("120 idle video cards set no media source; a single hover owns the only active source", async () => {
  const manager = createMediaPlaybackManager();
  const timers = [];
  const nodes = [];
  const document = { hidden: false, createElement() {
    const media = new Media();
    const node = { media, isConnected: true, dataset: {}, classList: { add() {}, remove() {} }, events: {},
      querySelector: (selector) => ["audio", "video"].includes(selector) ? media : { addEventListener() {} },
      addEventListener(name, callback) { this.events[name] = callback; },
    };
    nodes.push(node); return node;
  } };
  const source = readFileSync(new URL("../vendor/codex-workspace-enhancer/asset-browser/public/app.js", import.meta.url), "utf8");
  const context = vm.createContext({ document, mediaPlayback: manager, pendingMediaHover: new WeakMap(),
    els: { mediaPreviewDialog: { open: false } }, formatDuration: () => "--:--", commonCardMarkup: () => "", assetById: () => null,
    setTimeout: (fn) => { timers.push(fn); return fn; }, clearTimeout() {}, useAssetInCodex() {},
  });
  vm.runInContext(source.slice(source.indexOf("function renderAudioCard("), source.indexOf("function previewAsset(")), context);
  for (let index = 0; index < 120; index++) context.renderVideoCard({ id: `video-${index}`, kind: "video", mediaUrl: `/media?id=${index}` });
  const audio = context.renderAudioCard({ id: "audio", mediaUrl: "/media?id=audio" });
  for (const node of nodes) {
    assert.doesNotMatch(node.innerHTML, /<(?:audio|video)[^>]*\ssrc=/);
    assert.match(node.innerHTML, /preload="none"/);
    assert.equal(node.media.requests, 0);
  }
  nodes[0].events.mouseenter();
  assert.equal(nodes[0].media.requests, 0, "incidental hover waits briefly before requesting");
  await timers.shift()();
  assert.equal(nodes[0].media.requests, 1);
  nodes[1].events.mouseenter();
  await timers.shift()();
  assert.equal(nodes[0].media.hasAttribute("src"), false);
  assert.equal(nodes[1].media.hasAttribute("src"), true);
  audio.events.mouseenter();
  await timers.shift()();
  assert.equal(nodes[1].media.hasAttribute("src"), false);
  assert.equal(audio.media.hasAttribute("src"), true);
  audio.events.mouseleave();
  assert.equal(nodes.filter((node) => node.media.hasAttribute("src")).length, 0);
});

test("late play resolution cannot retain a decoder after closing or switching media", async () => {
  const manager = createMediaPlaybackManager();
  const a = new Media(), b = new Media();
  let resolve;
  a.pending = new Promise((yes) => { resolve = yes; });
  let activated = 0;
  const pending = manager.start(a, "/media?a", { onStart: () => activated++ });
  await manager.start(b, "/media?b");
  resolve();
  assert.equal(await pending, false);
  assert.equal(activated, 0);
  assert.equal(a.hasAttribute("src"), false);
  assert.equal(b.hasAttribute("src"), true);
  manager.stop();
  assert.equal(b.hasAttribute("src"), false);
  assert.equal(b.paused, true);
});
