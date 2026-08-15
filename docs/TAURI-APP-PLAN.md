# Tauri Desktop App Plan — YouTube Downloader

> **Goal:** Turn the current local website (Node/Express + yt-dlp) into a real
> Windows desktop app with Tauri — same UI, same download engine — while
> keeping the website version working. Users download a `.exe` from GitHub
> Releases (built automatically by GitHub Actions), double-click it, paste a
> link, and download — no dev server, no Node, no manual PATH setup.

---

## 1. Why Tauri (and why keep the site)

### Why Tauri

| Concern | Current site | Tauri app |
|---|---|---|
| Run the app | `npm start` (needs Node installed) | Double-click the `.exe` |
| Spawn yt-dlp | Node `child_process.spawn` | Rust `std::process::Command` — native, no Node |
| File output | `downloads/` next to `server.js` | OS Downloads folder (or user-chosen dir) |
| Downloads as a file | HTTP `/api/download/:id` stream | Rust writes the file, Tauri opens a native save dialog |
| Bundle size | n/a | ~10–15 MB (WebView2 reuse, tiny binary) |
| Distribution | run locally | GitHub Actions → `.exe` installer on Releases |

Tauri is the right shell because the frontend is **already pure static HTML/CSS/JS**
(`public/` is 172 lines of HTML + 1,154 lines of CSS + ~1,000 lines of JS, zero
build step). That same folder becomes the Tauri webview — no rewrite of the UI.

### Why keep the site

- Zero-install usage: anyone can still `npm start` or host `public/` anywhere.
- Faster iteration: the site is the "dev harness" for the frontend; the Tauri
  app reuses it verbatim.
- Single source of truth: **one frontend, two shells** (Express backend / Tauri
  backend) behind the same API contract.

### Architecture: same frontend, swappable backend

```
                    ┌────────────────────────────┐
                    │   public/ (HTML/CSS/JS)    │   ← ONE UI, no changes
                    └────────────┬───────────────┘
                                 │  same API contract
              ┌──────────────────┴───────────────────┐
              │                                      │
     ┌────────▼─────────┐                  ┌─────────▼──────────┐
     │ Express server   │                  │ Tauri (Rust) core  │
     │  (site mode)     │                  │   (desktop mode)   │
     └────────┬─────────┘                  └─────────┬──────────┘
              │                                      │
     ┌────────▼─────────┐                  ┌─────────▼──────────┐
     │ yt-dlp + ffmpeg  │◄────────────────►│ yt-dlp + ffmpeg    │
     │  (child process) │                  │  (std::process)    │
     └──────────────────┘                  └────────────────────┘
```

The API contract the frontend already calls:

| Frontend call | Express route | Tauri replacement |
|---|---|---|
| `GET /api/info/quick?url=` | oEmbed + yt-dlp fallback | Rust command `fetch_quick_info(url)` (oEmbed via reqwest) |
| `GET /api/info?url=` | yt-dlp `--dump-json` | Rust command `fetch_full_info(url)` → spawn yt-dlp |
| `POST /api/download` | spawn yt-dlp, track state | Rust command `start_download(url, formatId, title, ext)` |
| `GET /api/progress/:id` (SSE) | in-memory map + SSE | Tauri **events** (`download:progress` emitted to JS) |
| `GET /api/download/:id` | `res.download(file)` | Rust returns the finished file path → native save dialog |

---

## 2. Project structure (new files only — `public/` untouched)

```
youtube-downloader/
├── public/                      ← UNTOUCHED (site frontend)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js                    ← UNTOUCHED (site backend)
├── src-tauri/                   ← NEW: Tauri shell
│   ├── Cargo.toml
│   ├── tauri.conf.json          ← window config, bundle config
│   ├── build.rs
│   ├── icons/                   ← app icons (generated once)
│   └── src/
│       ├── main.rs              ← entry, runs the app
│       ├── lib.rs               ← tauri builder, command registration
│       ├── commands.rs          ← the 4 API commands (info / download / progress / open)
│       ├── deps.rs              ← yt-dlp/ffmpeg detection + install hint
│       └── download.rs          ← spawn yt-dlp, parse progress lines, emit events
├── .github/workflows/
│   └── build-tauri.yml          ← NEW: GitHub Actions → .exe on Releases
└── package.json                 ← add a couple of npm scripts (see §8)
```

**Key design decision — dual backend from day one:** the frontend must work in
BOTH modes. Detection is a one-liner in `app.js`:

```js
const IS_TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
```

- In the **site**, `fetch('/api/...')` hits Express (unchanged).
- In **Tauri**, `app.js` routes the same calls to `invoke('command', { args })`
  and swaps the SSE progress listener for `listen('download:progress', ...)`.

A small `api.js` shim (~80 lines) centralizes this switch so the UI code below
it never knows which backend it is on.

---

## 3. The 4 Tauri commands (mirroring server.js exactly)

### 3.1 `fetch_quick_info(url) -> QuickInfo`
Same two-phase logic as the site:
1. Call YouTube oEmbed (`https://www.youtube.com/oembed?...`) with **reqwest**
   (timeout 5 s). Fast (~200–500 ms).
2. On failure, fall back to `yt-dlp --print title/id/duration/...` (15 s timeout).
Return `{ id, title, thumbnail, duration, uploader, uploaderUrl, viewCount }`.

### 3.2 `fetch_full_info(url) -> FullInfo`
Spawn `yt-dlp --no-playlist --skip-download --dump-json --no-warnings <url>`
(30 s timeout, 10 MB cap), parse the last JSON line, and build the **same
formats array + bestOptions** the site builds (same filters: skip storyboards,
skip <200p, codec categories H.264/VP9/AV1/H.265, best-option synthesis).

> **Duplicate-logic note:** the format-building logic currently lives in
> `server.js`. Move it to a shared module so both backends use identical rules:
> site = `server.js` requires it, Tauri = Rust reimplements it. Keep a
> **round-trip test** (see §7) that asserts both produce identical JSON for the
> same `--dump-json` fixture.

### 3.3 `start_download(url, formatId, title, ext) -> { downloadId }`
Spawn `yt-dlp` with the **exact same args** as `server.js`:
```
--no-playlist --newline --progress --no-warnings
--progress-template 'stdout:{"p":...,"s":...,"e":...,"t":...}'
-f <formatId> -o <outputTemplate> --merge-output-format <mp3|mp4> [--embed-metadata]
<sanitizedUrl>
```
- Output template: `{downloadsDir}/{downloadId}_%(title).100s.%(ext)s`
  (downloads dir = the OS **Downloads** folder in Tauri mode, via
  `dirs::download_dir()`).
- Stream stdout line-by-line, parse the `stdout:{...}` JSON progress lines,
  update an in-memory `HashMap<downloadId, DownloadState>`.
- Emit Tauri events on every tick:
  - `download:progress` → `{ progress, speed, eta, totalSize, status }`
  - `download:done` → `{ ok, path, error }` (final file path for the save dialog)
- Kill on window close (abort → `proc.kill()`).

### 3.4 `save_file(path)` / `open_downloads_folder()`
- `save_file`: after `download:done`, frontend calls this to show the native
  **save dialog** (pre-filled with the video title) and copy the file there via
  `tauri-plugin-dialog` + `std::fs::copy`. (Site mode keeps its current
  `a href="/api/download/:id"` download.)
- `open_downloads_folder`: opens the downloads directory in Explorer
  (`opener` crate or `std::process::Command` on Windows).

---

## 4. First-run dependency check (the "ffmpeg / yt-dlp" gate)

This is the exact flow you asked for — **check, then guide, then use**:

```
┌───────────────────────────────────────────────────────────────┐
│  App boots → detect_dependencies()                            │
│                                                               │
│  yt-dlp?  → try `yt-dlp --version`                            │
│             (Command::new("yt-dlp") or "yt-dlp.exe")          │
│  ffmpeg?  → try `ffmpeg -version`                             │
│             (Command::new("ffmpeg") or "ffmpeg.exe")          │
└──────────────────────────────┬────────────────────────────────┘
                               │
              ┌────────────────┴─────────────────┐
              │  both found?                     │
              │  YES → normal UI (paste link)    │
              │  NO  → onboarding screen         │
              └────────────────┬─────────────────┘
                               ▼
        ┌──────────────────────────────────────────────┐
        │  Onboarding screen (inside the app)          │
        │  "yt-dlp: ✗ not found   ffmpeg: ✗ not found" │
        │                                              │
        │  Windows:  winget install yt-dlp             │
        │            winget install ffmpeg             │
        │                                              │
        │  [Copy command]  [I've installed them —      │
        │                   re-check]                  │
        │                                              │
        │  → re-run detect_dependencies()              │
        └──────────────────────────────────────────────┘
```

Details:

1. **Detection** (`deps.rs`): run `yt-dlp --version` and `ffmpeg -version` with a
   short timeout. Success = found. Also check the common manual install paths
   (`C:\tools\yt-dlp.exe`, the app's own `resources/` folder) so the app can
   offer a "use bundled copy" option later.
2. **The gate is non-blocking** — the app window still opens, the user just sees
   the onboarding card instead of the URL input until deps exist.
3. **Platform-aware install hints**, exactly one click to copy:
   - Windows: `winget install yt-dlp` / `winget install ffmpeg`
   - macOS: `brew install yt-dlp ffmpeg`
   - Linux: `sudo apt install yt-dlp ffmpeg` (etc.)
   The app copies the command to the clipboard (`tauri-plugin-clipboard`).
4. **"Re-check" button** re-runs detection — after the user installs and returns
   to the app, no restart needed.
5. Detection result cached in `tauri-plugin-store` so boot is instant on later
   launches (re-check on demand + on every download start, cheap).

> Optional future: bundle `yt-dlp.exe` and `ffmpeg.exe` **inside** the installer
> (as `resources/`), and have the app prefer the bundled binaries — then the
> gate disappears entirely. ~100 MB installer; covered in §10 as "Phase 3".

---

## 5. GitHub Actions — build the .exe on push/release

`.github/workflows/build-tauri.yml`:

```yaml
name: Build Tauri App

on:
  push:
    tags: ['v*']        # build when you push a tag like v1.0.0
  workflow_dispatch:     # or build manually from the Actions tab

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Build (Tauri CLI via npx — no global install)
        run: npm run tauri:build

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: windows-bundle
          path: |
            src-tauri/target/release/bundle/nsis/*.exe
            src-tauri/target/release/bundle/msi/*.msi

      # Tagged releases → attach the .exe to the GitHub Release
      - name: Upload to Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: |
            src-tauri/target/release/bundle/nsis/*.exe
            src-tauri/target/release/bundle/msi/*.msi
```

**Workflow for you:**

1. `git tag v1.0.0 && git push origin v1.0.0`
2. Actions builds the installer (~2–4 min)
3. The `.exe` appears on the **Releases** page automatically
4. Users click the `.exe`, install, open — done

`package.json` scripts to make `npx` smooth:

```json
"scripts": {
  "tauri": "tauri",
  "tauri:build": "tauri build",
  "tauri:dev": "tauri dev"
}
```

---

## 6. Tauri config essentials (`src-tauri/tauri.conf.json`)

```jsonc
{
  "productName": "YouTube Downloader",
  "version": "1.0.0",
  "identifier": "com.you.ytdl",           // change to your domain
  "build": {
    "beforeDevCommand": "echo site-mode-frontend-is-static",
    "devUrl": "http://localhost:3001",     // reuse the existing site in dev!
    "beforeBuildCommand": "",
    "frontendDist": "../public"            // ← the SAME public/ folder
  },
  "app": {
    "windows": [{
      "title": "YouTube Downloader",
      "width": 980, "height": 760,
      "resizable": true
    }],
    "security": {
      "csp": null            // tighten later; the UI loads i.ytimg.com thumbnails
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"]
  }
}
```

> **Dev-time trick:** point `devUrl` at the existing Express server
> (`npm start` → `localhost:3001`). During development the Tauri window shows
> the site with the *real* Express backend; flip `IS_TAURI` routing to hit
> `invoke()` only when a `__TAURI__` global exists (i.e., in the packaged app).
> This keeps the site workflow 100% usable while you build the Rust side.

---

## 7. Migration phases & testing

### Phase 0 — scaffold (½ day)
- `npm i -D @tauri-apps/cli`, `npx tauri init` (or write `src-tauri` by hand).
- Config as in §6; icons via `npx tauri icon public/favicon.svg`.
- `npx tauri dev` → window opens with the existing UI hitting the Express
  backend. **Nothing else changed yet.**

### Phase 1 — dependency gate + shell commands (½ day)
- `deps.rs`: detect yt-dlp/ffmpeg; onboard screen with copy-button hints.
- `commands.rs`: `detect_dependencies`, `copy_command` stubs.
- Verify the gate shows correctly with deps uninstalled, then works after
  "re-check".

### Phase 2 — real commands + event bridge (1–2 days)
- Port `fetch_quick_info` (reqwest oEmbed) and `fetch_full_info` (spawn yt-dlp).
- Port `start_download` with progress events → wire `api.js` shim so the UI
  shows live progress in the Tauri window.
- Add `save_file` with the native save dialog + `open_downloads_folder`.
- **Round-trip test:** run both backends against the same video and diff the
  `/api/info` JSON and the final file bytes (same formatId → same checksum).
  This catches the "format logic drifted" class of bugs.
- Package locally: `npx tauri build` → install the `.exe` → full happy path:
  paste link → formats → download → save → play.

### Phase 3 — distribution polish (½ day)
- `.github/workflows/build-tauri.yml`; push a `v1.0.0` tag; confirm the `.exe`
  lands on Releases.
- Optional: bundle yt-dlp/ffmpeg into resources/ so the gate can offer
  "use bundled tools" (bigger installer, zero user setup).
- Optional: auto-updater (`tauri-plugin-updater` + static update endpoint) so
  users get new versions without re-downloading.

### Testing checklist (each phase)
- [ ] Site still works: `npm start` → paste URL → download (regression)
- [ ] Tauri dev window loads the same UI
- [ ] Deps missing → onboarding card with correct copy command
- [ ] Deps present → paste link → quick info (fast) → full formats → download → live progress → file opens
- [ ] Playlist URL, Shorts URL, youtu.be short link, age-restricted error path
- [ ] MP3 (audio-only) path, H.264 recommended path
- [ ] Cancel on window close kills the yt-dlp child
- [ ] Tagged build → `.exe` on Releases → clean-machine install runs

---

## 8. What stays exactly the same

| Piece | Status |
|---|---|
| `public/index.html` | untouched |
| `public/style.css` | untouched |
| `public/app.js` | + one `api.js` shim import + 3-line `IS_TAURI` routing |
| `server.js` (site backend) | untouched (optionally share format logic) |
| Download engine | same yt-dlp commands, same progress parsing, same formats |
| `.gitignore` | add `src-tauri/target/` |

---

## 9. Risks & gotchas

1. **WebView2 requirement** — Tauri on Windows uses the preinstalled WebView2
   (present on Win10/11 by default). Fine for modern Windows; note it in the
   README for old machines.
2. **Progress output on Windows** — the site already routes progress through
   **stdout** (stderr is block-buffered on Windows when piped). Keep that exact
   choice in Rust (`Stdio::piped` on stdout, parse there).
3. **oEmbed CORS** — in the webview, direct `fetch` to YouTube is fine (no CORS
   because we call through Rust `reqwest`, which has no CORS at all). Don't
   fetch oEmbed from JS in Tauri mode — always through the command.
4. **yt-dlp updates** — YouTube breaks yt-dlp regularly. Add a "check yt-dlp
   version" hint in the onboarding card (`yt-dlp -U`), and pin nothing.
5. **Rate limiting (429)** — same as site; surface the yt-dlp stderr hint
   (`--sleep-interval 5`) in the error card.
6. **Code signing** — unsigned `.exe` triggers a SmartScreen warning. For a
   personal tool, "More info → Run anyway" is acceptable; a signing cert is
   the paid fix (optional).

---

## 10. Future ideas (after the app exists)

- **Bundled binaries** (`resources/yt-dlp.exe` + `ffmpeg.exe`) → zero-install app.
- **Download queue** with multiple parallel jobs (Rust state is already a map —
  add queue semantics + progress list in the UI).
- **Auto-updater** for seamless releases.
- **macOS/Linux builds** — same workflow, add `macos-latest` / `ubuntu-latest`
  jobs to the Actions matrix.
- **Playlist browser** — list all playlist items in the UI before choosing.
- **Cookies support** — pass `--cookies` from a file picker for age-restricted
  videos (respect the existing `.gitignore`).

---

## TL;DR

1. Keep `public/` + `server.js` (the site works today, stays working).
2. Add `src-tauri/` — a thin Rust shell that implements the same 4 API
   operations with the same yt-dlp commands, plus a **first-run gate** that
   checks for yt-dlp/ffmpeg and shows one-click install commands if missing.
3. One `api.js` shim routes the frontend to Express (site) or Tauri `invoke`
   (desktop) — the UI is literally shared.
4. GitHub Actions builds the Windows `.exe` on every version tag and attaches
   it to the Release; users install and use it without Node or a dev server.
