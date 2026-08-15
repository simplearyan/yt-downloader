# Format-Fetch Cold-Start Plan

**Date:** 2026-08-15
**Status:** Analysis done — fix not yet implemented
**Repro:** First `/api/info` call after the server starts takes 6–8s; the 2nd–4th calls (and the same video after a page refresh) drop to ~2s; repeat calls after that are ~2.2s regardless of which video.

---

## 1. Root-cause analysis (measured)

The format options come from `GET /api/info` in `server.js`, which runs:

```js
const result = spawnSync(YT_DLP, ['--no-playlist', '--skip-download', '--dump-json', '--no-warnings', url], { timeout: 30000 });
```

Timed on this machine (`yt-dlp 2026.07.04`, pip-installed Python 3.13 shim):

| Run | Time | Notes |
|---|---|---|
| Run 1 (fresh) | **6.8s** | Cold: Defender scan, Python bytecode compile, DNS + TLS, player JS download |
| Run 2 | 4.6s | Warm-up in progress |
| Run 3 | 2.1s | Steady state reached |
| Runs 4–5 (same video) | 2.4s / 2.4s | Steady state |
| Different video (warm) | 2.2s | Warming is **video-independent** |

Three distinct problems:

### 1a. The event loop is blocked the whole time
`spawnSync` blocks Node for the full yt-dlp duration. During a first-ever fetch (~7s) the server cannot answer **any** other request — a second search, the oEmbed quick-info call, the download-progress SSE stream, even static files. So the first search *feels* even slower than it is, and a second video pasted mid-fetch just queues.

### 1b. First-run cold-start costs (after server start / on a fresh machine)
- **Windows Defender** real-time scans the freshly spawned Python process and modules (first spawn only).
- **Python bytecode** (`.pyc`) compiles on first import, cached afterwards.
- **DNS + TCP + TLS** to YouTube/CDN is cold; the OS and Node cache it afterwards.
- **yt-dlp player fetch**: the watch page + player JS are downloaded and nsig/signature extraction runs every time — the `%LOCALAPPDATA%\yt-dlp` cache dir is currently **empty**, so nothing persists between runs. It just gets faster as the OS-level caches warm.

### 1c. No caching or dedupe on the server
Every `/api/info` call re-runs yt-dlp, even for the identical URL seconds later. Nothing is cached server-side, so a page refresh re-pays the full cost (it only feels fast because yt-dlp is warm). Consecutive rapid runs also risk YouTube rate limiting (observed a 429/empty response after ~10 back-to-back calls during this analysis — there is no retry or backoff).

---

## 2. Fix plan

### Phase 1 — Unblock the event loop, cache, dedupe  *(do first, biggest win)*
- Replace `spawnSync` with an async `spawn` wrapper in `/api/info` (and in the `/api/info/quick` yt-dlp fallback path).
- Add an in-memory LRU format cache keyed by sanitized URL, TTL ~30 min. Repeat loads (including after page refresh) return in <50ms.
- Add in-flight dedupe: concurrent requests for the same URL share one yt-dlp run instead of spawning two.
- **Result:** first load is still ~7s (unavoidable cold cost) but the server stays responsive during it — second searches, progress SSE, and static files all keep working. Every repeat load is instant.

### Phase 2 — Cut the first-load latency
- **Server-start warm-up:** after boot, fire one background yt-dlp info fetch (e.g. a short evergreen video) to prime Defender, Python `.pyc`, DNS/TLS, and player caches before the user searches. Non-blocking, idempotent, ~7s once.
- **Verify the yt-dlp cache dir:** confirm `%LOCALAPPDATA%\yt-dlp` is writable so the player JS / nsig extraction persists across runs; if it's being blocked, point `--cache-dir` at an explicit writable folder.
- **Client UX:** Phase 1 (oEmbed) already shows the video card instantly — keep that. Add a hint line in the format-loading placeholder on first-ever load ("First fetch can take a few seconds…").

### Phase 3 — Faster extractor client *(test before enabling, risky)*
- Measured: `youtube:player_client=android` is consistently faster (~2.3s) but returns only **5 formats** (muxed-only — breaks the video-only/audio-only tabs and merge options), so it is **not** a drop-in.
- Test `youtube:player_client=default,-tv` or `android,web` (client merging) and compare format counts against plain `web`. Enable only if the full adaptive set still comes back.
- Risk: PO-token negotiation can intermittently 403/429; add `--retries 2 --socket-timeout 15` and a server-side backoff on rate-limit responses.

### Phase 4 — Hardening
- Add `--retries 2`, `--socket-timeout 15`, `--no-call-home` to the info args.
- On rate-limit/429, return a soft error so the client keeps the already-shown oEmbed card (the client already falls back gracefully — make the server cooperate).

---

## 3. Acceptance criteria
- First `/api/info` after server start: **≤3s** once Phase 2 warm-up has run (cold is ~7s — acceptable).
- Repeat `/api/info` for the same URL (incl. after page refresh): **<50ms** (cache hit).
- Server stays responsive during a first fetch: a parallel `/api/info/quick` call answers in its normal <500ms instead of queueing behind the 7s spawn.
- Format counts identical to today (no regression from any client-args change).
