#!/usr/bin/env node

import assert from "node:assert/strict";

import { readManagedShortcuts } from "../lib/managed-shortcuts.mjs";
import {
  CdpClient,
  connectCodexTarget,
  readTargets,
  selectMainCodexTarget,
} from "./cdp-client.mjs";

const port = Number(process.env.CODEX_CDP_PORT || 9231);
const timeoutMs = Number(process.env.CODEX_VERIFY_TIMEOUT_MS || 30_000);

async function waitFor(check, message, waitMs = timeoutMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(message);
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function selectShortcutTarget(targets, mainTarget, shortcutUrl, knownTargetId = "") {
  const frames = targets.filter((target) =>
    target.type === "iframe" && target.webSocketDebuggerUrl,
  );
  if (knownTargetId) {
    const known = frames.find((target) => target.id === knownTargetId);
    if (known) return known;
  }

  const children = frames.filter((target) => target.parentId === mainTarget.id);
  return children.find((target) => target.url === shortcutUrl)
    || children.find((target) => sameOrigin(target.url, shortcutUrl))
    || frames.find((target) => target.url === shortcutUrl)
    || frames.find((target) => sameOrigin(target.url, shortcutUrl))
    || null;
}

async function waitForShortcutTarget(mainTarget, shortcutUrl, knownTargetId = "") {
  return waitFor(
    async () => selectShortcutTarget(
      await readTargets(port),
      mainTarget,
      shortcutUrl,
      knownTargetId,
    ),
    "keep-alive iframe target was not created",
  );
}

async function readFrameState(frame) {
  return frame.evaluate(`(() => ({
    timeOrigin: performance.timeOrigin,
    innerWidth,
    innerHeight,
    readyState: document.readyState,
    operational: Boolean(document.documentElement),
  }))()`);
}

async function readCloseButtonPoint(main) {
  return main.evaluate(`(() => {
    const button = document.querySelector('[data-codex-custom-shortcut-close]');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      width: rect.width,
      height: rect.height,
      hit: hit === button || button.contains(hit),
    };
  })()`);
}

async function clickCloseButton(main) {
  const point = await readCloseButtonPoint(main);
  assert.ok(point, "managed shortcut close button was not rendered");
  assert.ok(point.width >= 36 && point.height >= 36, "managed shortcut close button hit area is too small");
  assert.equal(point.hit, true, "managed shortcut close button is covered by another control");
  await main.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
  });
  await main.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await main.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  return point;
}

const shortcuts = await readManagedShortcuts();
const shortcut = shortcuts.find((item) => item.openMode === "internal" && item.keepAlive === true);
assert.ok(shortcut, "no keep-alive internal managed shortcut is configured on this computer");

const targets = await readTargets(port);
const mainTarget = selectMainCodexTarget(targets);
assert.ok(mainTarget, "main Codex renderer target was not found");

const main = await connectCodexTarget(mainTarget);
let frame = null;

try {
  const injectionReady = await waitFor(
    () => main.evaluate(`typeof window.__codexConversationPreviewInjection__?.ensureManagedShortcut === 'function'`),
    "managed shortcut keep-alive API was not injected",
  );
  assert.equal(injectionReady, true);

  const initiallyVisible = await main.evaluate(
    `document.getElementById('codex-custom-shortcut-page')?.dataset.codexCustomShortcutState === 'visible'`,
  );
  if (initiallyVisible) {
    await clickCloseButton(main);
    assert.equal(await waitFor(
      () => main.evaluate(`document.getElementById('codex-custom-shortcut-page')?.dataset.codexCustomShortcutState !== 'visible'`),
      "visible managed shortcut panel could not be closed before silent verification",
    ), true);
  }

  const silentMount = await main.evaluate(`window.__codexConversationPreviewInjection__.ensureManagedShortcut(
    ${JSON.stringify(shortcut.id)},
    { visible: false }
  )`);
  assert.equal(silentMount?.ok, true, "silent keep-alive mount failed");
  assert.equal(await main.evaluate(`document.getElementById('codex-custom-shortcut-page')?.dataset.codexCustomShortcutState === 'parked'`), true,
    "silent keep-alive mount unexpectedly displayed the managed shortcut panel");
  await waitFor(
    () => main.evaluate(`(() => {
      const page = document.getElementById('codex-custom-shortcut-page');
      const frame = page?.querySelector('iframe[data-codex-custom-shortcut-frame]');
      if (page?.dataset.codexCustomShortcutState !== 'parked' || page.hidden || !frame) return false;
      const rect = frame.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })()`),
    "parked keep-alive iframe did not retain a layout viewport",
  );

  const target = await waitForShortcutTarget(mainTarget, shortcut.url);
  frame = new CdpClient(target.webSocketDebuggerUrl, { requestTimeoutMs: timeoutMs });
  await frame.connect();
  const baseline = await waitFor(
    async () => {
      const state = await readFrameState(frame);
      return state.operational
        && state.readyState === "complete"
        && state.innerWidth > 0
        && state.innerHeight > 0
        ? state
        : null;
    },
    "keep-alive iframe did not become operational",
  );

  const shown = await main.evaluate(`window.__codexConversationPreviewInjection__.ensureManagedShortcut(
    ${JSON.stringify(shortcut.id)},
    { visible: true }
  )`);
  assert.equal(shown?.ok, true, "managed shortcut could not be shown");
  assert.equal(await waitFor(
    () => main.evaluate(`document.getElementById('codex-custom-shortcut-page')?.dataset.codexCustomShortcutState === 'visible'`),
    "managed shortcut panel did not become visible",
  ), true);

  const closePoint = await clickCloseButton(main);
  assert.equal(await waitFor(
    () => main.evaluate(`document.getElementById('codex-custom-shortcut-page')?.dataset.codexCustomShortcutState === 'parked'`),
    "real pointer click did not close the managed shortcut panel",
  ), true);

  const hiddenTarget = await waitForShortcutTarget(mainTarget, shortcut.url, target.id);
  assert.equal(hiddenTarget.id, target.id, "closing the panel replaced the keep-alive iframe target");
  const hidden = await readFrameState(frame);
  assert.equal(hidden.timeOrigin, baseline.timeOrigin, "closing the panel reloaded the keep-alive iframe");
  assert.ok(hidden.innerWidth > 0 && hidden.innerHeight > 0, "hidden keep-alive iframe lost its layout viewport");
  assert.equal(hidden.operational, true, "hidden keep-alive iframe is not scriptable");

  const silentWhileHidden = await main.evaluate(`window.__codexConversationPreviewInjection__.ensureManagedShortcut(
    ${JSON.stringify(shortcut.id)},
    { visible: false }
  )`);
  assert.equal(silentWhileHidden?.ok, true, "hidden keep-alive iframe could not be ensured");
  assert.equal(await main.evaluate(`document.getElementById('codex-custom-shortcut-page')?.dataset.codexCustomShortcutState === 'parked'`), true,
    "silent ensure unexpectedly displayed the managed shortcut panel");

  const reopened = await main.evaluate(`window.__codexConversationPreviewInjection__.ensureManagedShortcut(
    ${JSON.stringify(shortcut.id)},
    { visible: true }
  )`);
  assert.equal(reopened?.ok, true, "managed shortcut could not be reopened");
  assert.equal(await waitFor(
    () => main.evaluate(`document.getElementById('codex-custom-shortcut-page')?.dataset.codexCustomShortcutState === 'visible'`),
    "managed shortcut panel did not reopen",
  ), true);

  const reopenedTarget = await waitForShortcutTarget(mainTarget, shortcut.url, target.id);
  assert.equal(reopenedTarget.id, target.id, "reopening the panel replaced the keep-alive iframe target");
  const afterReopen = await readFrameState(frame);
  assert.equal(afterReopen.timeOrigin, baseline.timeOrigin, "reopening the panel reloaded the keep-alive iframe");

  await clickCloseButton(main);
  assert.equal(await waitFor(
    () => main.evaluate(`document.getElementById('codex-custom-shortcut-page')?.dataset.codexCustomShortcutState === 'parked'`),
    "verification cleanup could not hide the managed shortcut panel",
  ), true);

  process.stdout.write(`${JSON.stringify({
    shortcutId: shortcut.id,
    targetId: target.id,
    timeOrigin: baseline.timeOrigin,
    preflightClosedVisiblePanel: initiallyVisible,
    silentMount: true,
    closeHitTest: closePoint.hit,
    pointerClose: true,
    targetPreservedAfterClose: hiddenTarget.id === target.id,
    timeOriginPreservedAfterClose: hidden.timeOrigin === baseline.timeOrigin,
    hiddenViewportPreserved: hidden.innerWidth > 0 && hidden.innerHeight > 0,
    hiddenOperationAvailable: hidden.operational,
    silentEnsureStayedHidden: true,
    targetPreservedAfterReopen: reopenedTarget.id === target.id,
    timeOriginPreservedAfterReopen: afterReopen.timeOrigin === baseline.timeOrigin,
    finalState: "hidden-running",
  }, null, 2)}\n`);
} finally {
  frame?.close();
  main.close();
}
