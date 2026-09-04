#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

async function clickAt(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function waitFor(client, expression, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return false;
}

const activityButtonExpression = `Array.from(document.querySelectorAll('button[aria-label]')).find((button) =>
  /^(查看活动|关闭活动视图|view activity|close activity view)/i.test(button.getAttribute('aria-label') || '')
)`;

async function activityButton(client) {
  return client.evaluate(`(() => {
    const button = ${activityButtonExpression};
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { label: button.getAttribute('aria-label') || '', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

const client = await connectMainCodex(9231);
try {
  let button = await activityButton(client);
  assert.ok(button, "native activity button must exist");
  if (/^(关闭活动视图|close activity view)/i.test(button.label)) {
    await clickAt(client, button.x, button.y);
    assert.equal(await waitFor(client, `!${activityButtonExpression}?.getAttribute('aria-label')?.match(/^(关闭活动视图|close activity view)/i)`), true,
      "pre-existing activity view must close");
  }

  button = await activityButton(client);
  await clickAt(client, button.x, button.y);
  assert.equal(await waitFor(client, `${activityButtonExpression}?.getAttribute('aria-label')?.match(/^(关闭活动视图|close activity view)/i)`), true,
    "one click must open the native activity view");
  await new Promise((resolve) => setTimeout(resolve, 650));

  const opened = await client.evaluate(`(() => {
    const activityOptions = Array.from(document.querySelectorAll('button[aria-label]')).find((candidate) =>
      /^(活动视图选项|activity view options)$/i.test(candidate.getAttribute('aria-label') || '')
    );
    const activityList = activityOptions?.closest('[role="list"]')
      || Array.from(document.querySelectorAll('[role="list"]')).find((list) => list.contains(activityOptions));
    const listRect = activityList?.getBoundingClientRect();
    return {
      label: ${activityButtonExpression}?.getAttribute('aria-label') || '',
      optionsVisible: Boolean(activityOptions && activityOptions.getClientRects().length),
      listVisible: Boolean(activityList && !activityList.hidden && listRect?.width > 0 && listRect?.height > 0),
      listHiddenByEnhancer: activityList?.hasAttribute('data-codex-sidebar-priority-native-hidden') || false,
      sectionTabsVisible: Boolean(document.getElementById('codex-sidebar-section-tabs')?.getClientRects().length),
      folderSwitcherVisible: Boolean(document.getElementById('codex-sidebar-folder-switcher')?.getClientRects().length),
    };
  })()`);
  assert.match(opened.label, /^(关闭活动视图|close activity view)/i);
  assert.equal(opened.optionsVisible, true, "activity controls must remain visible after enhancer sync");
  assert.equal(opened.listVisible, true, "activity list must remain visible after enhancer sync");
  assert.equal(opened.listHiddenByEnhancer, false, "activity list must never receive the project-list hidden marker");
  assert.equal(opened.sectionTabsVisible, false, "project tabs must be suspended while activity is open");
  assert.equal(opened.folderSwitcherVisible, false, "project folder controls must be suspended while activity is open");

  button = await activityButton(client);
  await clickAt(client, button.x, button.y);
  assert.equal(await waitFor(client, `Boolean(document.getElementById('codex-sidebar-section-tabs')?.getClientRects().length)`), true,
    "project tabs must recover after closing activity");
  process.stdout.write(`${JSON.stringify({ opened, recovered: true }, null, 2)}\n`);
} finally {
  const button = await activityButton(client).catch(() => null);
  if (button && /^(关闭活动视图|close activity view)/i.test(button.label)) {
    await clickAt(client, button.x, button.y).catch(() => {});
  }
  client.close();
}
