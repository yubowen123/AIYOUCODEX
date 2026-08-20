import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const browserRoot = new URL("../vendor/codex-workspace-enhancer/asset-browser/", import.meta.url);
const consoleRoot = new URL("../vendor/codex-workspace-enhancer/asset-console/public/", import.meta.url);

test("local asset manager exposes project navigation and four asset workspaces", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  assert.match(html, /id="localProjectList"/);
  assert.match(html, /data-asset-kind="text"/);
  assert.match(html, /data-asset-kind="image"/);
  assert.match(html, /data-asset-kind="audio"/);
  assert.match(html, /data-asset-kind="video"/);
  assert.match(html, /id="assetColumnRange"/);
  assert.match(html, /id="tagManager"/);
});

test("local asset cards implement media-specific interactions", async () => {
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(source, /renderTextCard/);
  assert.match(source, /renderImageCard/);
  assert.match(source, /renderAudioCard/);
  assert.match(source, /renderVideoCard/);
  assert.match(source, /mouseenter/);
  assert.match(source, /requestFullscreen/);
  assert.match(source, /dblclick/);
  assert.match(source, /saveTextAsset/);
});

test("local asset manager exposes zero-token smart groups and manual overrides", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(html, /id="smartGroupTabs"/);
  assert.match(html, /data-smart-group="asset"/);
  assert.match(html, /data-smart-group="review"/);
  assert.match(html, /data-smart-group="noise"/);
  assert.match(source, /classificationReason/);
  assert.match(source, /classificationSource/);
  assert.match(source, /form\.get\("smartGroup"\)/);
});

test("review cards expose direct manual category and tag actions", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.match(source, /asset\.smartGroup === "review"/);
  assert.match(source, /data-action="manual-category"/);
  assert.match(source, /data-action="manual-tags"/);
  assert.match(source, /addEventListener\("pointerdown"/);
  assert.match(source, /openManualReviewAction/);
  assert.match(source, /mergeManualTags/);
  assert.match(source, /defaultManualSmartGroup/);
});

test("asset service supports multi-folder projects and non-destructive project reassignment", async () => {
  const server = await readFile(new URL("server.js", browserRoot), "utf8");
  assert.match(server, /textExts/);
  assert.match(server, /listLibraryAssets/);
  assert.match(server, /project\.folders/);
  assert.match(server, /assignAssetToProject/);
  assert.match(server, /renameLibraryAsset/);
  assert.match(server, /deleteLibraryAsset/);
  assert.match(server, /readTextAsset/);
  assert.match(server, /saveTextAsset/);
  assert.match(server, /\/api\/library/);
  assert.match(server, /\/api\/assets\/assign/);
  assert.match(server, /\/api\/assets\/rename/);
  assert.match(server, /\/api\/assets\/delete/);
  assert.match(server, /\/api\/text/);
});

test("embedded and service-served asset manager builds stay synchronized", async () => {
  for (const file of ["index.html", "app.js", "asset-metadata-ui.js", "ui-v3.css"]) {
    const embedded = await readFile(new URL(file, consoleRoot), "utf8");
    const served = await readFile(new URL(`public/${file}`, browserRoot), "utf8");
    assert.equal(embedded, served, `${file} differs between the embedded and service builds`);
  }
});
