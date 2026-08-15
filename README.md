# 🎬 YouTube Downloader

**Download YouTube videos as original, untouched streams — MP4 & MP3 — free, open source, and built for video editing.**

Paste any YouTube link, pick a format, download. No re-encoding, no broken seek tables, no ads, no sign-up, no limits. Built on **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — the gold standard for YouTube downloading — with a clean, modern UI in both a **Windows desktop app** and a **browser web app**.

[![Latest Release](https://img.shields.io/github/v/release/simplearyan/yt-downloader?include_prereleases&sort=semver&label=release&color=8b6ffb)](https://github.com/simplearyan/yt-downloader/releases)
[![Release Downloads](https://img.shields.io/github/downloads/simplearyan/yt-downloader/total?label=downloads&color=8b6ffb)](https://github.com/simplearyan/yt-downloader/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Web-242424?logo=windows)](https://simplearyan.github.io/yt-downloader/)
[![Powered by yt-dlp](https://img.shields.io/badge/powered%20by-yt--dlp-8b6ffb)](https://github.com/yt-dlp/yt-dlp)

> 🚀 **Live download site:** [simplearyan.github.io/yt-downloader](https://simplearyan.github.io/yt-downloader/) — browse versions and grab the installer right from the browser.

---

## Table of contents

- [Why this downloader](#why-this-downloader)
- [✨ Features](#-features)
- [🖥️ Desktop app](#-desktop-app)
- [🌐 Web app](#-web-app)
- [Requirements](#requirements)
- [Releases & CI](#releases--ci)
- [The download formats (yt-dlp reference)](#the-download-formats-yt-dlp-reference)
- [Why not web downloaders?](#why-not-web-downloaders)
- [File structure](#file-structure)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

---

## Why this downloader

Most web downloaders re-encode videos on their servers with cheap settings — that **corrupts the seek table** (the metadata a player uses to find each frame), so files freeze and glitch in editors. This app pulls the **original untouched streams straight from YouTube** with yt-dlp, giving you:

- ✅ **Original quality** — no re-encoding, no generational loss
- ✅ **Perfect seeking** — clean, editor-friendly MP4 files
- ✅ **Free forever** — no ads, no sign-up, no daily limits
- ✅ **Works offline** — the web app is self-contained; the desktop app needs no server

---

## ✨ Features

| | |
|---|---|
| 🎞️ **MP4 & MP3** | Best video+audio merged MP4, H.264 MP4, or audio-only MP3 — plus every individual format |
| ⚡ **Fast & reliable** | Two-phase loading (video card appears in ~0.4s), server-side format cache for instant repeat loads, background yt-dlp warm-up on start |
| 🔎 **Recent searches** | Search history dropdown with thumbnails, auto-fill, and clear option |
| 🌙 **Light & dark themes** | Clean CapCut-inspired neutral gray palettes (WCAG AA contrast) |
| 🔔 **Update checker** | "Check for updates" modal + a dot indicator on the header when a new release is out |
| 🖼️ **Rich video card** | Thumbnail, title, uploader, duration, views — then a clean format picker with codec filters |
| 📊 **Live progress** | Real-time download progress streaming (speed, ETA, %) |
| 💾 **Save anywhere** | Downloads land in `downloads/`; old files auto-cleaned after 2 hours |

---

## 🖥️ Desktop app

### Install (Windows)

1. Grab the latest installer from the **[download site](https://simplearyan.github.io/yt-downloader/)** or **[GitHub Releases](https://github.com/simplearyan/yt-downloader/releases)** (e.g. the `v0.2.0-beta` release).
2. Download either:
   - **`*.exe`** — NSIS installer (double-click to install), or
   - **`*.msi`** — MSI package (silent install: `msiexec /i <file>.msi`)
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

The **download site** is deployed automatically to GitHub Pages from `site/` ([docs/DOWNLOAD-SITE-PLAN.md](docs/DOWNLOAD-SITE-PLAN.md)).

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
├── site/                 ← Marketing/download landing page (GitHub Pages)
├── src-tauri/            ← Tauri desktop shell (Rust)
├── .github/workflows/
│   ├── build-tauri.yml   ← builds Windows installer on v* tags
│   └── pages.yml         ← deploys site/ + refreshes the release snapshot
├── server.js             ← Express backend (spawns yt-dlp, format cache, warm-up)
├── downloads/            ← Downloaded videos go here (gitignored)
└── docs/                 ← plans & guides (see below)
```

---

## Troubleshooting

**"yt-dlp is not recognized"** — not installed / not on PATH: `winget install yt-dlp` (Windows) or `brew install yt-dlp` (macOS).

**"ffmpeg is not found"** — yt-dlp needs ffmpeg to merge video + audio: `winget install ffmpeg` / `brew install ffmpeg`.

**"Requested format is not available"** — YouTube dropped that resolution for this video. Drop the `[height<=...]` filter: `yt-dlp -f "bestvideo+bestaudio/best" URL`.

**"HTTP Error 429"** — rate-limited. Wait a few minutes or add `--sleep-interval 5`.

**Formats load slowly the very first time** — the first fetch after server start warms up yt-dlp caches (a background warm-up runs automatically on boot); repeat loads are served instantly from the in-memory cache.

**App window opens but downloads fail** — you're likely on a packaged (beta) build whose backend isn't ported yet; run `npm run tauri:dev` instead, or check the server is on :3001.

---

## Documentation

| Doc | What it covers |
|-----|----------------|
| [YOUTUBE-DOWNLOAD-GUIDE.md](YOUTUBE-DOWNLOAD-GUIDE.md) | End-to-end usage guide |
| [docs/TAURI-APP-PLAN.md](docs/TAURI-APP-PLAN.md) | Desktop-app conversion plan (phases) |
| [docs/RELEASE-WORKFLOW-PLAN.md](docs/RELEASE-WORKFLOW-PLAN.md) | CI / release pipeline |
| [docs/DOWNLOAD-SITE-PLAN.md](docs/DOWNLOAD-SITE-PLAN.md) | Marketing/download site plan |
| [docs/FORMAT-FETCH-COLD-START-PLAN.md](docs/FORMAT-FETCH-COLD-START-PLAN.md) | First-fetch performance analysis & fixes |
| [docs/PROFESSIONAL-INSTALL-PLAN.md](docs/PROFESSIONAL-INSTALL-PLAN.md) | Making installs feel professional |
| [docs/AZURE-CODE-SIGNING.md](docs/AZURE-CODE-SIGNING.md) | SmartScreen fix: optional code signing |
