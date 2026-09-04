import assert from "node:assert/strict";
import test from "node:test";

import { CdpConnection } from "../scripts/codex-injector-runtime.mjs";

class FakeWebSocket extends EventTarget {
  constructor(mode) {
    super();
    this.mode = mode;
    this.readyState = 0;
    queueMicrotask(() => {
      if (mode === "close-before-open") {
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
        return;
      }
      if (mode !== "stall-connect") {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      }
    });
  }

  send() {}

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

async function withFakeWebSocket(mode, run) {
  const NativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends FakeWebSocket {
    constructor() {
      super(mode);
    }
  };
  try {
    await run();
  } finally {
    globalThis.WebSocket = NativeWebSocket;
  }
}

test("a renderer that closes during the handshake rejects instead of suspending the watch loop", async () => {
  await withFakeWebSocket("close-before-open", async () => {
    const connection = new CdpConnection("ws://renderer", { connectTimeoutMs: 30 });
    await assert.rejects(connection.open(), /CDP WebSocket closed/);
    assert.equal(connection.closed, true);
  });
});

test("a stalled renderer handshake has a finite timeout", async () => {
  await withFakeWebSocket("stall-connect", async () => {
    const connection = new CdpConnection("ws://renderer", { connectTimeoutMs: 20 });
    await assert.rejects(
      connection.open(),
      /CDP WebSocket connection timed out after 20ms/,
    );
    assert.equal(connection.closed, true);
  });
});

test("an unanswered renderer command times out and closes the stale connection", async () => {
  await withFakeWebSocket("open", async () => {
    const connection = new CdpConnection("ws://renderer", { requestTimeoutMs: 20 });
    await connection.open();
    await assert.rejects(
      connection.send("Runtime.evaluate", { expression: "true" }),
      /CDP Runtime\.evaluate timed out after 20ms/,
    );
    assert.equal(connection.socket.readyState, 3);
  });
});
