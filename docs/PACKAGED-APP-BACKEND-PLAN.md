# Packaged App Backend Plan — how to make the installed app actually download

**Date:** 2026-08-15
**Status:** Option B PARKED 2026-08-15 (axum::serve wedges in-process — see §7); shipping Node on :3021 (v0.2.4-beta); Phases 0–2 code kept in-tree

---

## 1. The bug (v0.2.0-beta)

Installing and running the packaged app, then searching a video shows:

```
Unexpected token '<', "<!DOCTYPE ... is not valid JSON"
```

**Root cause:** the packaged app has **no backend**. The frontend calls relative
URLs (`/api/info/quick`, `/api/info`, …). In development the page is served from
`http://localhost:3001`, so those requests hit the Express server. In the
packaged app the page is served from Tauri's own origin (`http://tauri.localhost`),
so `/api/info` is answered by Tauri's asset server, which returns the SPA's
`index.html` (HTML) — and `JSON.parse` chokes on `<!DOCTYPE`.

`src-tauri/src/lib.rs` is a bare window shell — nothing starts the Express
backend. This was a known beta limitation ("UI shell only, backend ported to
Rust in Phase 2"), but it makes the installed app unusable, so it needs a real
fix.

**Backend surface that must run inside the app** (5 endpoints):

| Endpoint | What it does |
|---|---|
| `GET /api/info/quick` | YouTube oEmbed fetch (+ yt-dlp `--print` fallback), 10-min cache |
| `GET /api/info` | spawn `yt-dlp --dump-json`, build format list + best options (30-min cache, dedupe) |
| `POST /api/download` | spawn yt-dlp with progress template, track state by id |
| `GET /api/progress/:id` | SSE stream of progress/speed/ETA parsed from yt-dlp stdout |
| `GET /api/download/:id` | serve the finished file to the browser |

---

## 1.5 Non-negotiable constraint — both shells must keep working

- **Site / web app (`npm start`) keeps running on the Node/Express backend
  unchanged** — same code, same features, same dev loop.
- **Desktop app works fully offline** — packaged builds get their own backend;
  `tauri dev` keeps using Express on :3001.
- One frontend, two backends behind the **same API contract**: the only
  frontend difference is an `API_BASE` switch (relative URL in web mode,
  `http://127.0.0.1:3021` under the packaged app).
- Any change must be verified in **both** modes before shipping (web app E2E +
  installed-app E2E).

## 2. Option analysis (size is the deciding factor)

Current installer sizes (measured from the v0.2.0-beta release assets):

| Asset | Size |
|---|---|
| `YouTube.Downloader_0.2.0_x64-setup.exe` | **2.0 MB** |
| `YouTube.Downloader_0.2.0_x64_en-US.msi` | **2.9 MB** |

### Option A — Node sidecar (compile `server.js` + Express into an exe with `pkg`)

- Spawned by Tauri on startup; frontend points at `http://127.0.0.1:3021`.
- **Installer size impact: the Node runtime alone is ~50–90 MB → installer grows
  from ~2 MB to roughly 40–60 MB.** The app would become a "Node app wearing a
  Tauri coat" and still needs yt-dlp/ffmpeg on PATH.
- Pros: reuses 100% of the tested Express backend; smallest code change.
- Cons: **~20–30× bigger installer**, extra process to manage, pkg can be
  finicky in CI, still requires Node runtime even though the point of Tauri was
  to be Node-free.

### Option B — Rust backend embedded in the app *(recommended)*

- Port the 5 endpoints to a small Rust HTTP server bound to `127.0.0.1:3021`,
  keeping the **exact same API contract** so the frontend only needs a tiny
  `API_BASE` change. This is what the plan ([TAURI-APP-PLAN.md](TAURI-APP-PLAN.md))
  already calls Phase 2.
- **Installer size impact: +2–5 MB → total ~4–7 MB.** Fully self-contained; the
  only external deps stay yt-dlp/ffmpeg (already a documented requirement).
- Implementation: `axum` (or `tiny_http`) + `tokio` + `reqwest` + `serde_json`.
  Estimate 300–500 lines of Rust covering all 5 endpoints, reusing the exact
  yt-dlp argument sets and progress-template parsing from `server.js`.
- Pros: smallest app, no Node anywhere, "professional" end state, aligns with
  the existing plan, removes the beta disclaimer.
- Cons: real implementation work this session; must keep behavior parity with
  the Node backend (args, JSON shapes, SSE format).

### Option C — require Node on the system (stopgap only)

- The packaged app checks for `node` on PATH and runs the bundled `server.js`
  from a writable folder; if Node is missing, show a clear setup message.
- **Size impact: ~0 MB.** Works today on the developer's own machine (has Node).
- Cons: end users without Node can't use it — not a product solution. Fine as a
  temporary unblock, not as the shipped answer.

### Option D — Tauri `invoke()` commands instead of HTTP

- Port the backend to Rust **commands** and rewrite the frontend from
  `fetch`/`EventSource` to `invoke`/events.
- Same size as B, but breaks the "one frontend, two shells" architecture (the
  web app must keep `fetch`), needs a wrapper layer for both modes, and is more
  frontend churn for no size benefit. **Rejected.**

---

## 3. Recommendation

**Go with Option B (Rust backend, same API contract).** It keeps the installer
small (~4–7 MB), removes the Node dependency entirely, and is the phase the
project already planned for. Option C can be used as a temporary local unblock
while B is being built.

All options share two small frontend/backend prerequisites (do them first):

1. `server.js`: add CORS headers (the packaged webview calls the local server
   cross-origin). Harmless in web mode.
2. `public/app.js`: `API_BASE` detection (relative when served from the web app,
   `http://127.0.0.1:3021` when running under Tauri) + a small boot retry so the
   first search succeeds while the backend is still starting.

**Current state (both shipped):**
- **Option C stopgap (committed `8e7950e`, released v0.2.1+/v0.2.2-beta):** Express is bundled as a Tauri resource, `lib.rs` spawns `node backend/server.js` on :3021 in release builds (Node 18+ required), `app.js` has `API_BASE` + boot retry + a clear Node-missing error.
- **Option B Phase 0–1 (in progress):** `backend.rs` implements the Rust server — `GET /api/info/quick` natively (oEmbed + 10-min cache + yt-dlp `--print` fallback, same JSON shape), every not-yet-ported route is **proxied to the Node stopgap on :3022** so the app keeps working while the port proceeds, and if Rust can't bind, `lib.rs` falls back to Node directly on :3021. CORS handled by middleware (single consistent set, Node's own headers dropped on proxy).

---

## 4. Implementation plan (Option B)

### Phase 0 — Shared prerequisites
- Add CORS middleware to `server.js` (web mode unaffected).
- Add `API_BASE` + boot-retry to `public/app.js`.
- Measure: build a minimal Rust skeleton and record the exe/installer size.

### Phase 1 — Rust server skeleton + quick info
- New crate module (e.g. `src-tauri/src/backend/`) with a tiny HTTP server on
  `127.0.0.1:3021`.
- `GET /api/info/quick`: `reqwest` oEmbed call + 10-min in-memory cache + the
  yt-dlp `--print` fallback, same JSON shape.

- **Status: DONE** (`src-tauri/src/backend.rs`, compiled into release builds only). Verified: `cargo check --release` + debug clean, real-network test (`cargo test --release quick_info_serves_json_with_cors -- --ignored`) returns JSON with the right video id + CORS header.
- Remaining: exercise the proxy fallback path in a test and confirm the full `tauri build` bundles it (covered in Phase 4).

### Phase 2 — Full format fetch
- `GET /api/info`: spawn `yt-dlp --dump-json`, parse with `serde_json`, port the
  format filtering/codec-category/best-options mapping 1:1 from `server.js`,
  keep the 30-min cache + in-flight dedupe.

- **Status: DONE** (`src-tauri/src/backend.rs`). Same args, filters, codec categories, best-options, 30-min LRU cache, and in-flight dedupe via a shared future. Verified: `cargo check --release` + debug clean; live tests (`cargo test --release -- --ignored`) pass — real yt-dlp run returns the right id, 20 formats, 3 best options, CORS header; sequential cache hit + concurrent requests both OK. **Parity checked against Node**: identical id, 20 formats, 3 best options, and byte-equal first format entry.

### Phase 3 — Downloads + progress + file serve
- `POST /api/download`: spawn yt-dlp with the exact same args/progress template,
  parse stdout JSON lines into state.
- `GET /api/progress/:id`: SSE stream of `{p,s,e,t}` (same messages as today).
- `GET /api/download/:id`: stream the file with the same headers; files land in
  the app-data `downloads/` folder (writable, unlike the install dir).
- Keep the 2-hour auto-clean.

### Phase 4 — Wire into the app + CI
- `lib.rs`: start the Rust backend in `setup()` (release builds), stop it on
  exit. No sidecar, no external binary.
- Verify with a local `tauri build`; check installer size; test the installed
  app end-to-end (search → formats → download → file opens).

### Phase 5 — Docs & cleanup
- Remove the "beta: UI shell only" disclaimer; update
  [README](../README.md) + [TAURI-APP-PLAN.md](TAURI-APP-PLAN.md) status.

---

## 5. Acceptance criteria

- Packaged app: paste URL → video card → formats → download all work (parity
  with the web app).
- Installer size ≤ ~8 MB (target ~5–7 MB).
- No Node runtime bundled or required.
- yt-dlp/ffmpeg remain the only external requirements (already documented).
- Web app (`npm start`) unchanged.

---

## 6. Risks

- **Behavior parity**: yt-dlp args, progress-template parsing, and JSON shapes
  must match exactly — mitigated by reusing the same argument strings and by
  testing each endpoint against the Node server's responses.
- **SSE in Rust**: straightforward with `axum` (`Sse`), but must flush correctly
  and match the client's expected event/message format.
- **Port conflict**: use a dedicated port (3021) so a running web app on 3001
  doesn't clash.
- **Binary size creep**: `reqwest`/`tokio`/`axum` add weight — acceptable at
  +2–5 MB; strip + LTO in release to stay lean.

---

## 7. Status update — 2026-08-15: Rust backend parked

**The Rust server wedges in the packaged process.** `axum::serve` accepts TCP connections but never answers, on every runtime pattern tried (multi-thread and current-thread, `Builder` + `block_on` in a spawned thread, direct-await and `tokio::spawn`). Reproduced in isolation with a minimal router (HTTP 000 after 6–45s, while a hand-rolled raw-socket accept loop on the identical runtime answers in <1 ms and the bundled Node backend answers in ~0.5 s).

- **Decision:** v0.2.4-beta ships **Node on :3021 as the app backend** (the proven Option C path, with the v0.2.3 launch fixes). `start_backend` in `lib.rs` now spawns Node directly; `backend.rs` (Phases 1–2, quick-info + full formats, cache + dedupe, passing live tests) stays in the tree behind `#[allow(dead_code)]`.
- **Frontend hardening:** `fetchWithRetry` now aborts after 20 s per attempt and the download POST after 30 s — the UI can never spin forever on a silent backend; it shows a clear timeout error instead.
- **To resume Option B:** debug the tokio/hyper interaction (start with `axum::serve` on a `#[tokio::test]` runtime vs `Builder`+`block_on` — the former works, the latter wedges; suspect the runtime construction inside `std::thread::spawn`), then flip `start_backend` back to `backend::spawn`. Phases 0–2 remain valid; Phase 3 (downloads/progress/file-serve in Rust) is deferred until the wedge is fixed.
