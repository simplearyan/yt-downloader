# Performance Optimization Guide

## Current Architecture

The YouTube Downloader currently works in two steps:

1. **Fetch info** — `yt-dlp --dump-json --skip-download` to get video metadata and available formats
2. **Download** — `yt-dlp -f <format>` to download the selected format

Both steps run yt-dlp as a child process and wait for it to complete (via `spawnSync` for info, `spawn` for download with real-time progress).

## Why Fetching Is Slow

The `/api/info` endpoint calls `yt-dlp --dump-json` which:
- Fetches the video page HTML
- Parses all available formats (often 20–50+)
- Returns the full format list as JSON

A single info call typically takes **2–8 seconds** depending on:
- Network latency to YouTube
- Video length and complexity
- Number of available formats

## Why Downloading Is Slow

Download speed is primarily limited by:
- **YouTube's bandwidth throttling** (usually 5–20 MB/s for free users)
- **Video length** (longer videos take longer)
- **ffmpeg merge** (downloading separate video+audio streams requires muxing)

Current speeds: typically **0.5× to 2× real-time** (a 10-minute video downloads in 5–20 minutes).

---

## Future Optimizations

### 1. Parallel Format Resolution (Cached Info)

**Idea:** Instead of calling `--dump-json` on every fetch, cache the results.

```js
// Simple in-memory cache
const infoCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

app.get('/api/info', async (req, res) => {
  const url = sanitizeUrl(req.query.url?.trim());
  if (!url) return res.status(400)...;
  
  // Check cache first
  const cached = infoCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }
  
  // Fetch fresh data...
  const info = await fetchInfo(url);
  infoCache.set(url, { data: info, timestamp: Date.now() });
  res.json(info);
});
```

**Estimated improvement:** Subsequent fetches of the same URL → **instant** (0ms instead of 2–8s)

### 2. Selective Format Fetching

**Idea:** Use `--print` instead of `--dump-json` to fetch only the fields needed for display, reducing output size and parse time.

```bash
yt-dlp --print '%(title)s\t%(duration)s\t%(thumbnail)s' --skip-download <url>
```

Or fetch format data separately with a lighter query:

```bash
yt-dlp --print-json --skip-download --no-playlist \
  -f 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]' \
  <url>
```

**Estimated improvement:** 20–40% faster info fetching for simple format queries.

### 3. yt-dlp Native Progress Polling (Avoid SSE)

**Idea:** Instead of parsing stdout JSON lines and sending SSE events, use yt-dlp's built-in progress output more efficiently. The current approach (see `server.js`) already does this — but we could:

- **Reduce polling interval** from 500ms to 200ms for smoother progress updates
- **Use `--progress-delta 0.1`** for more frequent progress updates

```js
const args = [
  '--progress-delta', '0.1',  // update every 0.1%
  '--newline',
  '--progress',
  '--progress-template', progressTemplate,
  ...
];
```

**Estimated improvement:** Smoother progress, no architectural change needed.

### 4. Chunked / Partial Audio Merge

**Idea:** For long videos, start streaming the video as soon as the first video chunk is available, rather than waiting for the entire download + merge to complete.

This is complex to implement because:
- YouTube's DASH streams are fragmented (separate video + audio)
- ffmpeg needs both streams to produce a playable file
- Partial muxing is not well-supported by yt-dlp

**Estimated improvement:** 0% for file download, but could enable **progressive playback** in the browser.

### 5. Concurrent Downloads (Queue System)

**Idea:** Allow users to queue multiple downloads and run them concurrently (up to N parallel processes).

```js
const MAX_CONCURRENT = 3;
let activeJobs = 0;
const jobQueue = [];

function enqueueDownload(params) {
  return new Promise((resolve) => {
    jobQueue.push({ params, resolve });
    processQueue();
  });
}

function processQueue() {
  while (activeJobs < MAX_CONCURRENT && jobQueue.length > 0) {
    const job = jobQueue.shift();
    activeJobs++;
    startDownload(job.params).finally(() => {
      activeJobs--;
      processQueue();
    });
  }
}
```

**Estimated improvement:** With 3 concurrent downloads, total throughput for multiple videos increases by up to **3×** (limited by network bandwidth).

### 6. Format Pre-selection with Reasonable Defaults

**Idea:** Skip showing all 50+ formats. Instead:
- Show only the **top 5 most useful** formats by default
- Offer an "Show all formats" toggle for power users
- Pre-select the best format automatically

This doesn't make downloads faster, but it **reduces decision time** for users.

### 7. Use Native Node.js HTTP Instead of yt-dlp for Info

**Idea:** For extremely fast info fetching, parse YouTube's player response directly using Node's built-in `http` module instead of shelling out to yt-dlp.

This is the **most impactful** optimization but also the most complex:
- Requires understanding YouTube's player API and oEmbed endpoint
- Must handle signature deciphering (used for some older streams)
- YouTube frequently changes their API, requiring constant maintenance

**Estimated improvement:** Info fetching in **200–500ms** instead of 2–8s (10× faster).

---

## Summary of Potential Speed Gains

| Optimization | Info Fetch | Download | Complexity |
|---|---|---|---|
| Cached info | **Instant** (0ms) | — | Low |
| Selective format fetch | **20–40% faster** | — | Low |
| Progress polling | — | **Smoother UI** | Low |
| Partial audio merge | — | **0%** (complex) | High |
| Concurrent downloads | — | **3× throughput** | Medium |
| Format pre-selection | **Faster UX** | — | Low |
| Native HTTP (no yt-dlp) | **10× faster** | — | Very High |

## Implementation Status

| Optimization | Status | Date |
|---|---|---|
| In-memory info cache | ⬜ Not implemented | — |
| Selective format fetching | ⬜ Not implemented | — |
| Progress polling | ✅ Already implemented | Built-in |
| Two-phase fetch (quick + full) | ✅ Implemented | 2026-07-24 |
| oEmbed quick API (no yt-dlp spawn) | ✅ Implemented | 2026-07-24 |
| oEmbed response caching | ✅ Implemented | 2026-07-24 |
| Partial audio merge | ⬜ Not implemented | — |
| Concurrent downloads | ⬜ Not implemented | — |
| Format pre-selection | ⬜ Not implemented | — |
| Native HTTP (no yt-dlp) | ⬜ Not implemented | — |

## Recommendations

1. **Start with** in-memory info caching (easiest, biggest impact for repeat URLs)
2. **Add** a download queue with 2–3 concurrent downloads
3. **Explore** native HTTP info fetching as a long-term investment
