# YouTube Downloader

Download YouTube videos **reliably for video editing** — original untouched streams, perfect seeking, no re-encoding.

Built on **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**, the gold standard for YouTube downloading. It pulls the original streams straight from YouTube instead of re-encoding them on a server (which is what web downloaders like vidssave.com do — and why their files have broken seeking and blank frames in editors).

Two ways to use it:

| | **Desktop app** (Windows) | **Web app** (browser) |
|---|---|---|
| How | Tauri shell wrapping the same UI | Express + static frontend |
| Run | `npm run tauri:dev` (from source) | `npm start` → http://localhost:3001 |
| Installers | GitHub **Releases** (`.exe` / `.msi`) | — |

---

## 🖥️ Desktop app

### Install from GitHub Releases

1. Open **Releases** on the repo (e.g. the `v0.1.1-beta` release).
2. Download either:
   - `*.exe` — NSIS installer (double-click to install), or
   - `*.msi` — MSI package (silent install: `msiexec /i <file>.msi`)
3. Run it, paste a link, download.

> **"Windows protected your PC"?** That's SmartScreen — installers are unsigned, so Windows flags the *publisher*, not your code. Click **More info → Run anyway**. Optional Azure Artifact Signing is wired into the workflow (see [docs/AZURE-CODE-SIGNING.md](docs/AZURE-CODE-SIGNING.md)) — once the secrets are configured, builds come out signed and the warning goes away.

**⚠️ Beta status:** the packaged installers currently ship the **UI shell** — the download backend is ported to Rust in Phase 2 of the plan ([docs/TAURI-APP-PLAN.md](docs/TAURI-APP-PLAN.md)). For full downloads today, run from source below.

### Run from source

```bash
npm install
npm run tauri:dev     # compiles the Rust shell (~1–2 min) and opens the app window
```

`tauri:dev` auto-starts the Express backend on port 3001 and loads the UI in the app window — paste a link and download.

> If you already have `npm start` running, the dev server fails to bind 3001 — harmless, but quit one of them.

---

## 🌐 Web app

```bash
npm install
npm start             # → http://localhost:3001
```

Works offline after install; no build step — `public/` is plain HTML/CSS/JS.

---

## Requirements

- **Node.js 18+** (20/22 recommended)
- **yt-dlp** and **ffmpeg** on PATH (the app delegates downloads to them):

```bash
winget install yt-dlp      # Windows
winget install ffmpeg
brew install yt-dlp ffmpeg # macOS
```

Verify: `yt-dlp --version && ffmpeg -version`

---

## Releases & CI

Every push of a `v*` tag builds the Windows installer automatically and attaches it to a GitHub Release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Or run it manually: **Actions → Build Windows Installer → Run workflow** (leave *ref* empty for the latest commit; no tag needed). Details: [docs/RELEASE-WORKFLOW-PLAN.md](docs/RELEASE-WORKFLOW-PLAN.md).

---

## The download formats (yt-dlp reference)

The app uses these under the hood — handy when scripting directly:

```bash
# Best video + best audio merged into MP4 (the app's default):
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" "URL"
```

| What | Command |
|------|---------|
| **Best MP4** | `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" URL` |
| **1080p max** | `yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" URL` |
| **720p max** | `yt-dlp -f "bv*[height<=720]+ba/b[height<=720]" URL` |
| **Audio only (Opus)** | `yt-dlp -f "bestaudio[ext=webm]" URL` |
| **Audio only (MP3)** | `yt-dlp -x --audio-format mp3 URL` |
| **List formats** | `yt-dlp -F URL` |
| **With subs** | `yt-dlp --write-subs --embed-subs URL` |
| **Playlist** | `yt-dlp "https://www.youtube.com/playlist?list=..."` |
| **Specific items** | `yt-dlp --playlist-items 1-5,8 URL` |
| **Custom output** | `yt-dlp -o "~/Desktop/%(title)s.%(ext)s" URL` |

### Fix already-downloaded broken files

```bash
# Fast remux (no re-encode):
ffmpeg -i "broken_video.mp4" -c copy -map 0 "fixed_video.mp4"

# Full re-encode with proper keyframes (slower, more reliable):
ffmpeg -i "broken_video.mp4" -r 30 -c:v libx264 -crf 18 -c:a aac "fixed_video.mp4"
```

---

## Why not web downloaders?

| Tool | Quality | Editor Reliability | Cost |
|------|---------|-------------------|------|
| **yt-dlp** (this app) | ✅ Original untouched | ✅ Perfect seeking | Free |
| **4K Video Downloader** | ✅ Original | ✅ Perfect | Free tier |
| **vidssave.com** | ❌ Re-encoded, bad | ❌ Broken seek tables | Free |
| **y2mate** | ❌ Re-encoded, bad | ❌ Broken seek tables | Free |

Web downloaders re-encode on their servers with cheap settings that **corrupt the seek table** — the metadata that tells a player where each frame is. When an editor calls `video.currentTime = x`, the browser can't find the position and the element freezes.

---

## File structure

```
youtube-downloader/
├── public/               ← Web UI (plain HTML/CSS/JS, no build step)
├── src-tauri/            ← Tauri desktop shell (Rust)
├── .github/workflows/    ← build-tauri.yml — releases installer on v* tags
├── server.js             ← Express backend (spawns yt-dlp)
├── downloads/            ← Downloaded videos go here (gitignored)
├── docs/
│   ├── TAURI-APP-PLAN.md       ← desktop-app conversion plan (phases)
│   ├── RELEASE-WORKFLOW-PLAN.md ← CI / release pipeline
│   └── AZURE-CODE-SIGNING.md   ← SmartScreen fix: optional code signing
└── YOUTUBE-DOWNLOAD-GUIDE.md
```

---

## Troubleshooting

**"yt-dlp is not recognized"** — not installed / not on PATH: `winget install yt-dlp` (Windows) or `brew install yt-dlp` (macOS).

**"ffmpeg is not found"** — yt-dlp needs ffmpeg to merge video + audio: `winget install ffmpeg` / `brew install ffmpeg`.

**"Requested format is not available"** — YouTube dropped that resolution for this video. Drop the `[height<=...]` filter: `yt-dlp -f "bestvideo+bestaudio/best" URL`.

**"HTTP Error 429"** — rate-limited. Wait a few minutes or add `--sleep-interval 5`.

**App window opens but downloads fail** — you're likely on a packaged (beta) build whose backend isn't ported yet; run `npm run tauri:dev` instead, or check the server is on :3001.
