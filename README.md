# YouTube Downloader

A local command-line tool for downloading YouTube videos reliably for video editing in StudioPro.

Uses **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — the gold standard for YouTube downloading. It downloads the **original untouched streams** directly from YouTube instead of re-encoding them (which is what web-based downloaders like vidssave.com do, causing the broken seeking and blank frame issues you've seen in the editor).

---

## Quick Start

### 1. Install yt-dlp and ffmpeg

**Windows:**
```bash
winget install yt-dlp
winget install ffmpeg
```

**macOS:**
```bash
brew install yt-dlp ffmpeg
```

**Linux:**
```bash
sudo apt install yt-dlp ffmpeg        # Debian/Ubuntu
sudo dnf install yt-dlp ffmpeg        # Fedora
```

**Verify installation:**
```bash
yt-dlp --version
ffmpeg -version
```

### 2. Download a video

From the project root, run:

```bash
# Simplest — best quality MP4 automatically:
yt-dlp "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

Or use the explicit format selector for reliable editing exports:

```bash
# Best video + best audio merged into MP4:
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

The file saves to your current directory with the video title as the filename.

---

## Running Locally

### Download video to this folder

```bash
yt-dlp \
  -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" \
  --embed-thumbnail \
  --embed-metadata \
  -o "./youtube-downloader/downloads/%(title)s.%(ext)s" \
  "YOUR_YOUTUBE_URL"
```

This saves the video into `youtube-downloader/downloads/` with thumbnail and metadata embedded.

### Download multiple videos

```bash
# Download a playlist (each video saves to downloads/)
yt-dlp \
  -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" \
  -o "./youtube-downloader/downloads/%(playlist_index)s - %(title)s.%(ext)s" \
  --embed-thumbnail \
  --embed-metadata \
  "https://www.youtube.com/playlist?list=PLAYLIST_ID"
```

### Super handy: list all available formats first

```bash
yt-dlp -F "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

This shows resolution, bitrate, codec, and format code for every available stream.

---

## Fixing Already-Downloaded Problem Files

If you already have a broken video (from vidssave.com or similar) with seeking issues:

```bash
# Fast remux (no re-encode, just repackage):
ffmpeg -i "broken_video.mp4" -c copy -map 0 "fixed_video.mp4"

# Full re-encode with proper keyframes (slower but more reliable):
ffmpeg -i "broken_video.mp4" -r 30 -c:v libx264 -crf 18 -c:a aac "fixed_video.mp4"
```

---

## Common Commands Reference

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

---

## Why Not Web Downloaders?

| Tool | Quality | Editor Reliability | Cost |
|------|---------|-------------------|------|
| **yt-dlp** (this tool) | ✅ Original untouched | ✅ Perfect seeking | Free |
| **4K Video Downloader** | ✅ Original | ✅ Perfect | Free tier |
| **vidssave.com** | ❌ Re-encoded, bad | ❌ Broken seek tables | Free |
| **y2mate** | ❌ Re-encoded, bad | ❌ Broken seek tables | Free |

Web-based downloaders re-encode your video on their server with cheap settings that **corrupt the seek table** — the metadata that tells a video player where each frame is. When the editor calls `video.currentTime = x`, the browser can't find the right position and the element enters an error state (the freeze bug you saw).

---

## File Structure

```
youtube-downloader/
├── README.md        ← This file
├── .gitignore       ← Ignores downloaded videos and configs
└── downloads/       ← Your downloaded videos go here (create it)
```

After you create the `downloads/` folder, videos saved there will not be tracked by git (they're listed in `.gitignore`).

---

## Troubleshooting

**"yt-dlp is not recognized"** — yt-dlp is not installed or not in your PATH. Run `winget install yt-dlp` (Windows) or `brew install yt-dlp` (macOS).

**"ffmpeg is not found"** — yt-dlp needs ffmpeg to merge video + audio streams. Install it: `winget install ffmpeg` or `brew install ffmpeg`.

**"Requested format is not available"** — YouTube sometimes removes certain resolutions for some videos. Remove the `[height<=...]` filter and try: `yt-dlp -f "bestvideo+bestaudio/best" URL`.

**"HTTP Error 429"** — YouTube is rate-limiting you. Wait a few minutes and try again, or use `--sleep-interval 5` to add delays between requests.

---

*For a deeper technical explanation of why some YouTube downloads have seeking issues in browser editors, see [../docs/YouTube-Download-Tools.md](../docs/YouTube-Download-Tools.md).*
