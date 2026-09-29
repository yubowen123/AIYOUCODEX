# Native browser shortcuts (compatibility preview)

Managed shortcuts may use `openMode: "in-app"` to open a Codex browser tab in the conversation side panel. This is separate from `internal` (legacy iframe) and `browser` (external browser). No app bundle, CSP, signature or browser feature gate is modified.

Example **local** managed configuration:

```json
{
  "schemaVersion": 1,
  "shortcuts": [{
    "id": "workspace",
    "name": "Workspace",
    "url": "https://workspace.example/",
    "icon": "play",
    "openMode": "in-app",
    "keepAlive": true
  }]
}
```

- First click requests a native tab through the host's URL-open message (`toggle-browser-panel`, `open: true`, `url`). Subsequent clicks toggle a loaded tab without sending a URL again, preserving an already-open canvas rather than navigating back to its home page. An unconfirmed tab is revealed instead of accidentally toggled closed.
- An active native sidebar row can supply the task ID. If the newer host omits that row, the adapter does **not** treat the window's `initialRoute` as the current task: it asks the host to resolve the current route by omitting `conversationId`, then binds only the matching `browser-sidebar-state` for the generated tab ID. The route is scoped to this renderer and its Navigation API entry; if that context is unavailable, opening fails visibly rather than guessing another conversation.
- Newer hosts may report a `client-new-thread:` identity instead of the saved task UUID. The adapter binds that identity only from a trusted snapshot for its unique tab while the owning task is active. An explicitly idle, empty tab can receive its configured URL once in that same tab. Missing snapshots, login redirects, loading pages and already-navigated canvases never trigger this recovery.
- Tab identity is isolated by conversation, shortcut and configured URL. Same-document enhancer reinjection retains it. Across a full app restart, native tab restoration remains Codex-owned; singleton restoration across restarts is not yet verified.
- `keepAlive` means AIYOUcodex does not explicitly destroy/reload the tab. Codex still controls background suspension. This is **not** a guarantee of uninterrupted hidden execution.
- A request is reported as `requested`, not `loaded`. After ten seconds without a matching completion snapshot, it becomes `unconfirmed`; no automatic retries create duplicate pages. `loaded` denotes a matching native document snapshot, not logged-in canvas/Skill acceptance.
- An unavailable host browser feature or unresolved current route is not bypassed. `nativeShortcutStatus(shortcutId)` reports `idle`, `requested`, `unconfirmed`, `loaded` or `failed` without exposing private URLs. Inspect the native browser error/availability instead. Legacy iframe policy failures expose a user-initiated browser-panel alternative.
- Existing Skills bound to a named legacy iframe are not compatible with the new tab identity by themselves. Use the supported in-app browser tools against the actual tab; do not silently create a replacement iframe or switch to an unrelated external browser.

## Upgrade and installation gate

Before treating a Codex upgrade or local installation as working, check the configured `openMode`, installed renderer version/source hash, and attached renderer health. A running injector checks the renderer source/configuration hash every five seconds and reattaches on a valid change without restarting Codex; an already-running injector must first load this watchdog update once. Then perform a real-app smoke check from both Home and a conversation: open the shortcut, observe a matching native tab and committed URL, close/reopen it without changing the canvas, and verify that another conversation gets an isolated tab. A successful request, unit test, HTTP response or injector process is not the smoke check. If computer access to the app is unavailable, keep the result at **unverified** and request a user-side click/readback; do not mark DramaTV loaded.

## Validation boundary

The adapter uses messages observed in Codex 26.901.51231 (`open-browser-tab`, `toggle-browser-panel`, `browser-sidebar-state`). They are implementation contracts, not a promised stable public plugin API. Regression tests cover dispatch, reuse, task isolation and failure handling in isolation. Real macOS native loading, login retention, reopening, background execution and Windows behavior must be verified separately before promoting this preview to a default.

Private shortcut names, origins and credentials must remain outside the public repository and release package.
