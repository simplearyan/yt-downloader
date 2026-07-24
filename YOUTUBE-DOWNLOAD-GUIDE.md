# YouTube Download Guide

A quick reference for downloading YouTube videos reliably for video editing — avoiding the broken seeking issues caused by web-based downloaders like vidssave.com.

## Recommended: yt-dlp + ffmpeg

**[yt-dlp](https://github.com/yt-dlp/yt-dlp)** is the gold standard — free, open-source, and downloads the **original untouched streams** from YouTube without re-encoding.

**Why this matters:** Web-based downloaders (vidssave.com, y2mate, savefrom.net) re-encode your video on their server with cheap encoder settings that **corrupt the seek table**. When the editor calls `video.currentTime = x` to jump to a frame, the browser can't find the right position and the video element enters an error state. yt-dlp avoids this entirely by grabbing the original streams.

---

## Installation

### Windows (easiest — via winget)

```bash
winget install yt-dlp
winget install ffmpeg
```

### Windows (manual — no winget)

1. Download `yt-dlp.exe` from [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases)
2. Place it in a folder (e.g., `C:\tools\`)
3. Add that folder to your **PATH** environment variable
4. Install ffmpeg from [ffmpeg.org](https://ffmpeg.org/download.html) — add `ffmpeg.exe` to PATH too

### macOS

```bash
brew install yt-dlp ffmpeg
```

### Linux

```bash
sudo apt install yt-dlp ffmpeg   # Debian/Ubuntu
sudo dnf install yt-dlp ffmpeg   # Fedora
```

---

## Basic Usage

### Download best quality MP4 (simplest command)

```bash
yt-dlp "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

This automatically selects the best available MP4 format with video + audio merged.

### Download best quality with explicit format selection

```bash
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

- `bestvideo[ext=mp4]` — highest-quality video stream in MP4 container
- `bestaudio[ext=m4a]` — highest-quality audio stream
- `+` — merge them with ffmpeg into a single file
- `/best[ext=mp4]` — fallback to a single merged stream if separate streams aren't available

### Download at a specific quality

```bash
yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

Change `1080` to `720`, `480`, `2160` (4K), etc.

### List available formats first

```bash
yt-dlp -F "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

This shows all available video + audio formats with their format codes, resolution, bitrate, etc. Then you can pick specific codes:

```bash
yt-dlp -f 137+140 "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

(Where `137` = 1080p video, `140` = AAC audio — check `-F` output for actual codes on each video.)

---

## Common Options

| Flag | Purpose |
|------|---------|
| `-o "%(title)s.%(ext)s"` | Output filename template (default) |
| `-o "~/Desktop/%(title)s.%(ext)s"` | Save to a specific folder |
| `--embed-thumbnail` | Embed video thumbnail as cover art |
| `--embed-metadata` | Embed title, uploader, description, etc. |
| `--write-auto-subs` | Download auto-generated subtitles |
| `--write-subs` | Download manually uploaded subtitles |
| `--embed-subs` | Embed subtitles into the file |
| `--no-mtime` | Don't set file modification time to upload date |

### Download a playlist

```bash
yt-dlp "https://www.youtube.com/playlist?list=PLAYLIST_ID"
```

### Download only specific videos from a playlist

```bash
yt-dlp --playlist-items 1-5,8 "https://www.youtube.com/playlist?list=PLAYLIST_ID"
```

---

## Full Example

```bash
# List formats to see what's available
yt-dlp -F "https://youtu.be/dQw4w9WgXcQ"

# Download best MP4 at 1080p, embed thumbnail and metadata
yt-dlp \
  -f "bv*[height<=1080]+ba/b[height<=1080]" \
  --embed-thumbnail \
  --embed-metadata \
  -o "~/Downloads/YouTube/%(title)s.%(ext)s" \
  "https://youtu.be/dQw4w9WgXcQ"
```

---

## Fixing Already-Downloaded Problem Files

If you already have a video from vidssave.com (or similar) that has seeking issues:

```bash
# Re-encode with proper keyframes and Constant Frame Rate:
ffmpeg -i "problematic_video.mp4" -r 30 -c:v libx264 -crf 18 -c:a aac "fixed_video.mp4"

# Or just remux (fast, no re-encoding) — try this first:
ffmpeg -i "problematic_video.mp4" -c copy -map 0 "remuxed_video.mp4"
```

---

## Summary

| Tool | Video Quality | Seeking Reliability | Effort |
|------|-------------|-------------------|--------|
| **yt-dlp** | ✅ Original, untouched | ✅ Perfect | CLI (one command) |
| **4K Video Downloader** | ✅ Original | ✅ Perfect | GUI (click & go) |
| **JDownloader 2** | ✅ Original | ✅ Perfect | GUI (complex) |
| **Web services (vidssave, y2mate)** | ❌ Re-encoded, poor | ❌ Broken seek tables | Very easy |

**Rule of thumb:** Desktop tools that download the original streams (`yt-dlp`, 4K Video Downloader) produce files that work reliably in browser-based video editors. Avoid web-based "one-click" downloaders for any video you plan to edit.

---

*For more detail on why certain YouTube downloads have seeking/decoder issues in browser editors, see [docs/YouTube-Download-Tools.md](docs/YouTube-Download-Tools.md).*
