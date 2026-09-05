import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

// Rendering and navigation are asynchronous, especially with concurrent browser
// tests on CI. Observe the required state instead of assuming a fixed frame time.
// A missing result still fails with the last observed value and a bounded wait.
export async function waitForBrowserState(client, expression, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let observed;
  let lastError;
  do {
    try {
      observed = await client.evaluate(expression);
      lastError = undefined;
      if (observed === true) return;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail(`${message}; last browser state: ${lastError?.message || JSON.stringify(observed)}`);
}
