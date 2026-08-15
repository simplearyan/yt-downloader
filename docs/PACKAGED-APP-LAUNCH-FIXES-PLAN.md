# Packaged App Launch Fixes — v0.2.2-beta issues

**Date:** 2026-08-15
**Status:** Analysis done — ready to implement

Three user-reported issues in the installed v0.2.2-beta app, each with a confirmed root cause:

---

## Issue 1 — A CMD window pops open on every app launch

**Report:** launching the installed app opens a console window titled
`C:\Program Files\nodejs\node` showing "YouTube Downloader running at
http://localhost:3021".

**Root cause:** `lib.rs` spawns the bundled Node backend with a plain
`std::process::Command::spawn()`. On Windows, spawning a *console* app (node.exe)
from a *GUI* app (Tauri) without extra flags creates a new console window.
There are **two** spawn sites that need the flag:
1. the `node --version` probe in `start_backend()` (brief window flash), and
2. the actual `node backend/server.js` spawn in `spawn_node_backend()` (the
   persistent window the user sees).

**Fix:** use `std::os::windows::process::CommandExt` and set
`creation_flags(0x08000000)` (`CREATE_NO_WINDOW`) on both `Command`s. No console
window is created; stdout/stderr still flow through the pipe (logged by Tauri's
`eprintln!`, which goes nowhere visible in release — acceptable).

---

## Issue 2 — Still can't load formats: "Unexpected token '<', "<!DOCTYPE … is not valid JSON"

**Report:** the same JSON-parse error as before the backend fix, even though the
backend is clearly running (the CMD window proves Node is up on :3021).

**Root cause:** the frontend's packaged-app detection is wrong for Windows:

```js
const IS_TAURI = location.protocol.startsWith('tauri') || location.hostname.endsWith('.tauri.localhost');
```

- On **macOS/Linux**, Tauri v2 serves the app from `tauri://localhost`
  (protocol `tauri:`) — the first check catches it.
- On **Windows** (WebView2), the app is served from `http://tauri.localhost` —
  protocol is `http:` (first check fails) and the hostname is exactly
  `tauri.localhost`, which does **not** end with `.tauri.localhost` (that needs a
  subdomain). So `IS_TAURI` is `false` → `API_BASE = ''` → every API call goes
  **relative** → hits Tauri's asset server → returns `index.html` → the
  `<!DOCTYPE` JSON error.

This also explains why dev (`localhost:3001`) and `tauri dev` worked while the
packaged app didn't — both are `localhost`, where the detection correctly stays
web-mode, and our earlier verification never ran the actual installed app.

**Fix:** treat the exact host as Tauri too:

```js
const IS_TAURI = location.protocol.startsWith('tauri')
  || location.hostname === 'tauri.localhost'
  || location.hostname.endsWith('.tauri.localhost');
```

**Verify:** once `API_BASE` is set, quick-info hits `127.0.0.1:3021` (Node today,
Rust in later builds), CORS allows the webview, and the existing boot-retry
covers backend startup. The friendly "backend not reachable / needs Node" error
only appears if the backend genuinely never answers.

---

## Issue 3 — Update modal shows "Running a dev build" instead of the real version

**Report:** opening Check for Updates in the installed app says "Running a dev
build — This instance runs from source…".

**Root cause:** CI correctly writes `public/version.js`
(`window.YTDL_VERSION = '0.2.2-beta';`) before `tauri build`, and
`frontendDist` is `../public` — so the file **is** bundled. But `index.html`
**never loads it**: the only script tag is `<script src="/app.js"></script>`
(line 212). `window.YTDL_VERSION` is therefore undefined at runtime, `APP_VERSION`
falls back to `0.0.0-dev`, and the dev-mode guard kicks in.

**Fix:** add `<script src="/version.js"></script>` to `index.html` **before**
`app.js`. In source/dev builds the file doesn't exist → 404 → `window.YTDL_VERSION`
stays undefined → `0.0.0-dev` dev behavior preserved. In packaged builds the
real version is exposed and the modal shows the correct current pill (and the
semver compare from `51b6ca1` already prevents the bogus 0.9.0 → 0.2.0
"upgrade").

---

## Implementation checklist

1. `src-tauri/src/lib.rs` — `CREATE_NO_WINDOW` (0x08000000) on the `node
   --version` probe and the backend spawn, `#[cfg(windows)]` guarded.
2. `public/app.js` — fix `IS_TAURI` hostname check (exact `tauri.localhost`).
3. `public/index.html` — `<script src="/version.js"></script>` before `app.js`.
4. Validate: `cargo check --release` + `node --check`, sanity-check the three
   detection branches in a browser, confirm dev mode still shows the dev-build
   state.
5. Rebuild + install: force-move `v0.2.2-beta` or tag `v0.2.3-beta`; verify in
   the installed app — no CMD window, formats load, modal shows real version.

## Acceptance criteria

- No console window on launch (installed app).
- Paste a URL → formats load (quick card + format list).
- Check for Updates shows the real installed version; "You're up to date" when
  equal, correct `[current] → [new]` pills when newer.
- Web app + `tauri dev` behavior unchanged.
