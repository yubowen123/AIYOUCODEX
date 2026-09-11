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

- First click requests a native tab. Subsequent clicks toggle the same tab without sending a URL again, preserving an already-open canvas rather than navigating back to its home page.
- Tab identity is isolated by conversation, shortcut and configured URL. Same-document enhancer reinjection retains it. Across a full app restart, native tab restoration remains Codex-owned; singleton restoration across restarts is not yet verified.
- `keepAlive` means AIYOUcodex does not explicitly destroy/reload the tab. Codex still controls background suspension. This is **not** a guarantee of uninterrupted hidden execution.
- A request is reported as `requested`, not `loaded`. After ten seconds without a matching completion snapshot, it becomes `unconfirmed`; no automatic retries create duplicate pages. `loaded` denotes a matching native document snapshot, not logged-in canvas/Skill acceptance.
- An unavailable host browser feature or missing current task is not bypassed. Inspect the native browser error/availability instead. Legacy iframe policy failures expose a user-initiated browser-panel alternative.
- Existing Skills bound to a named legacy iframe are not compatible with the new tab identity by themselves. Use the supported in-app browser tools against the actual tab; do not silently create a replacement iframe or switch to an unrelated external browser.

## Validation boundary

The adapter uses messages observed in Codex 26.901.51231 (`open-browser-tab`, `toggle-browser-panel`, `browser-sidebar-state`). They are implementation contracts, not a promised stable public plugin API. Regression tests cover dispatch, reuse, task isolation and failure handling in isolation. Real macOS native loading, login retention, reopening, background execution and Windows behavior must be verified separately before promoting this preview to a default.

Private shortcut names, origins and credentials must remain outside the public repository and release package.
