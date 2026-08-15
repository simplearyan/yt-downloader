const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Config ──────────────────────────────────────────────────────────────────
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const YT_DLP = 'yt-dlp';
const MAX_FILE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Strip tracking parameters from a YouTube URL */
function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    const trackingParams = ['si', 'feature', 'pp', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    trackingParams.forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

/** Validate that a string looks like a YouTube URL */
function isValidYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]{11}/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
    /^https?:\/\/youtu\.be\/[\w-]{11}/,
    /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=/,
  ];
  return patterns.some((p) => p.test(url.trim()));
}

/** Extract video ID from a YouTube URL */
function extractVideoId(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  return match ? match[1] : null;
}

/** Sanitize a string for use as a filename */
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
}

/** Auto-clean old download files */
function cleanOldDownloads() {
  const now = Date.now();
  if (!fs.existsSync(DOWNLOADS_DIR)) return;
  for (const file of fs.readdirSync(DOWNLOADS_DIR)) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > MAX_FILE_AGE_MS) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }
}
setInterval(cleanOldDownloads, 30 * 60 * 1000); // every 30 min

/** Run yt-dlp asynchronously, resolving with { stdout, stderr }. */
function runYtDlp(args, { timeout = 30000, maxBuffer = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP, args);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`yt-dlp timed out after ${timeout}ms`));
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error('yt-dlp output exceeded maxBuffer'));
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const err = new Error(`yt-dlp exited with code ${code}`);
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** In-memory format cache — 30 min TTL, LRU eviction at 50 entries */
const formatCache = new Map();
const FORMAT_CACHE_TTL = 30 * 60 * 1000;
const FORMAT_CACHE_MAX = 50;

function formatCacheGet(url) {
  const entry = formatCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > FORMAT_CACHE_TTL) {
    formatCache.delete(url);
    return null;
  }
  formatCache.delete(url); // touch -> move to end (LRU recency)
  formatCache.set(url, entry);
  return entry.data;
}

function formatCacheSet(url, data) {
  formatCache.delete(url);
  formatCache.set(url, { data, timestamp: Date.now() });
  if (formatCache.size > FORMAT_CACHE_MAX) {
    formatCache.delete(formatCache.keys().next().value); // evict oldest
  }
}

/** In-flight dedupe — concurrent identical /api/info calls share one yt-dlp run */
const inflightInfo = new Map();

// ── Routes ──────────────────────────────────────────────────────────────────

/** GET /api/info — fetch video metadata from yt-dlp (async, cached, deduped) */
app.get('/api/info', async (req, res) => {
  const url = sanitizeUrl(req.query.url?.trim());
  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL. Please enter a valid YouTube URL.' });
  }

  // Cache hit -> instant repeat loads (including after a page refresh)
  const cached = formatCacheGet(url);
  if (cached) return res.json(cached);

  // In-flight dedupe -> concurrent requests for the same URL share one yt-dlp run
  const inflight = inflightInfo.get(url);
  if (inflight) {
    try {
      return res.json(await inflight);
    } catch {
      return res.status(500).json({
        error: 'Failed to fetch video info. The video might be private, age-restricted, or unavailable.',
      });
    }
  }

  const fetchPromise = (async () => {
    const args = [
      '--no-playlist',
      '--skip-download',
      '--dump-json',
      '--no-warnings',
      url,
    ];

    const { stdout } = await runYtDlp(args, {
      timeout: 30000, // 30 seconds
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });

    // yt-dlp --dump-json outputs one JSON line per video
    const lines = stdout.trim().split('\n');
    const data = JSON.parse(lines[lines.length - 1]);

    // Build format list for the user to pick from
    const formats = (data.formats || [])
      .filter((f) => (f.vcodec !== 'none' || f.acodec !== 'none'))
      // Skip storyboard and very low-res formats (height < 200 or format_id starts with 'sb')
      .filter((f) => {
        if (String(f.format_id || '').startsWith('sb')) return false;
        if (f.height && f.height > 0 && f.height < 200) return false;
        return true;
      })
      .map((f) => {
        // Categorize the video codec for display
        let codecCategory = '';
        const vc = (f.vcodec || '').toLowerCase();
        if (vc.startsWith('avc') || vc.startsWith('h.264') || vc.startsWith('x264')) codecCategory = 'H.264';
        else if (vc.startsWith('vp9')) codecCategory = 'VP9';
        else if (vc.startsWith('av01')) codecCategory = 'AV1';
        else if (vc.startsWith('hev') || vc.startsWith('h.265') || vc.startsWith('x265')) codecCategory = 'H.265';
        else if (vc.startsWith('vp8')) codecCategory = 'VP8';
        else if (f.vcodec !== 'none') codecCategory = (f.vcodec || '').split('.')[0].toUpperCase();

        return {
          formatId: f.format_id,
          ext: f.ext,
          quality: f.height ? `${f.height}p` : f.abr ? `${Math.round(f.abr)}kbps` : 'audio only',
          vcodec: f.vcodec || 'none',
          acodec: f.acodec || 'none',
          codecCategory,
          filesize: f.filesize || f.filesize_approx || 0,
          fps: f.fps || 0,
          hasVideo: f.vcodec !== 'none',
          hasAudio: f.acodec !== 'none',
        };
      })
      .filter((f) => f.hasVideo || f.hasAudio);

    // Estimate file sizes for recommended options from individual format data
    // Sort video formats by resolution (height), pick the largest
    const videoFormats = formats.filter((f) => f.hasVideo && !f.hasAudio);
    const audioFormats = formats.filter((f) => f.hasAudio && !f.hasVideo);

    // Largest video-only format size (any codec)
    const bestVideoSize = videoFormats.reduce((max, f) => Math.max(max, f.filesize || 0), 0);
    // Largest H.264 video-only format size
    const bestH264VideoSize = videoFormats
      .filter((f) => f.codecCategory === 'H.264')
      .reduce((max, f) => Math.max(max, f.filesize || 0), 0);
    // Largest audio-only format size
    const bestAudioSize = audioFormats.reduce((max, f) => Math.max(max, f.filesize || 0), 0);

    // Add convenience options at the top
    const bestOptions = [
      {
        label: '\uD83C\uDFAC Best Video + Audio (MP4)',
        formatId: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        ext: 'mp4',
        quality: 'Best',
        codecCategory: '',
        filesize: bestVideoSize + bestAudioSize,
        hasVideo: true,
        hasAudio: true,
        isBest: true,
      },
      {
        label: '\uD83C\uDFB5 H.264 Video + Audio (MP4)',
        formatId: 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        ext: 'mp4',
        quality: 'H.264',
        codecCategory: 'H.264',
        filesize: bestH264VideoSize + bestAudioSize,
        hasVideo: true,
        hasAudio: true,
        isBest: true,
      },
      {
        label: '\uD83C\uDFB5 Best Audio Only (MP3)',
        formatId: 'bestaudio/best',
        ext: 'mp3',
        quality: 'Best',
        codecCategory: '',
        filesize: bestAudioSize,
        hasVideo: false,
        hasAudio: true,
        isBest: true,
      },
    ];

    return {
      id: data.id,
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration,
      uploader: data.uploader,
      uploaderUrl: data.uploader_url,
      viewCount: data.view_count,
      formats,
      bestOptions,
    };
  })();

  inflightInfo.set(url, fetchPromise);

  try {
    const response = await fetchPromise;
    formatCacheSet(url, response);
    res.json(response);
  } catch (err) {
    console.error('yt-dlp info error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch video info. The video might be private, age-restricted, or unavailable.',
    });
  } finally {
    inflightInfo.delete(url);
  }
});

/** Simple in-memory cache for oEmbed responses (10 min TTL) */
const oembedCache = new Map();
const OEMBED_CACHE_TTL = 10 * 60 * 1000;
function getCachedOembed(url) {
  const cached = oembedCache.get(url);
  if (cached && Date.now() - cached.timestamp < OEMBED_CACHE_TTL) return cached.data;
  return null;
}
function setCachedOembed(url, data) {
  oembedCache.set(url, { data, timestamp: Date.now() });
}

/** GET /api/info/quick — fetch only video metadata via YouTube oEmbed (~200ms) */
app.get('/api/info/quick', async (req, res) => {
  const url = sanitizeUrl(req.query.url?.trim());
  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL. Please enter a valid YouTube URL.' });
  }

  // Check cache first
  const cached = getCachedOembed(url);
  if (cached) {
    return res.json(cached);
  }

  try {
    // Use YouTube's oEmbed API — lightweight HTTP call, no child process
    // Typically returns in 200-500ms vs 6-12s for yt-dlp
    const videoId = extractVideoId(url);
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const oembedResponse = await fetch(oembedUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!oembedResponse.ok) {
      throw new Error(`oEmbed returned HTTP ${oembedResponse.status}`);
    }

    const oembedData = await oembedResponse.json();

    // oEmbed thumbnail is always hqdefault; offer maxres as well if available
    const result = {
      id: videoId || '',
      title: oembedData.title || 'Unknown',
      // oEmbed returns hqdefault thumbnail; we'll upgrade when full data arrives
      thumbnail: oembedData.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: 0, // oEmbed doesn't provide duration — will appear in Phase 2
      uploader: oembedData.author_name || '',
      uploaderUrl: oembedData.author_url || '',
      viewCount: 0, // oEmbed doesn't provide view count — will appear in Phase 2
    };

    // Cache for repeat lookups
    setCachedOembed(url, result);

    res.json(result);
  } catch (err) {
    console.error('Quick info (oEmbed) error:', err.message);
    // Fallback: try yt-dlp --print (slower but more complete)
    try {
      console.log('Falling back to yt-dlp --print for quick info...');
      const { stdout } = await runYtDlp([
        '--no-playlist',
        '--skip-download',
        '--no-warnings',
        '--print', 'title: %(title)s',
        '--print', 'id: %(id)s',
        '--print', 'duration: %(duration)s',
        '--print', 'thumbnail: %(thumbnail)s',
        '--print', 'view_count: %(view_count)s',
        '--print', 'uploader: %(uploader)s',
        '--print', 'uploader_url: %(uploader_url)s',
        url,
      ], {
        timeout: 15000,
        maxBuffer: 1 * 1024 * 1024,
      });

      const lines = stdout.trim().split('\n');
      const info = {};
      for (const line of lines) {
        const idx = line.indexOf(': ');
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const value = line.slice(idx + 2).trim();
          if (key === 'duration' || key === 'view_count') {
            info[key] = parseInt(value, 10) || 0;
          } else {
            info[key] = value;
          }
        }
      }

      const fallbackResult = {
        id: info.id || videoId || '',
        title: info.title || 'Unknown',
        thumbnail: info.thumbnail || '',
        duration: info.duration || 0,
        uploader: info.uploader || '',
        uploaderUrl: info.uploader_url || '',
        viewCount: info.view_count || 0,
      };

      setCachedOembed(url, fallbackResult);
      return res.json(fallbackResult);
    } catch (fallbackErr) {
      console.error('yt-dlp fallback also failed:', fallbackErr.message);
      return res.status(500).json({
        error: 'Failed to fetch video info. The video might be private, age-restricted, or unavailable.',
      });
    }
  }
});

/** Track active downloads for progress streaming */
const activeDownloads = new Map();

/** POST /api/download — start downloading a video */
app.post('/api/download', (req, res) => {
  const { url, formatId, title, ext } = req.body || {};

  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL.' });
  }
  if (!formatId) {
    return res.status(400).json({ error: 'No format selected.' });
  }
  // Validate formatId against known-safe pattern
  if (!/^[\w.*+\-\/\[\]=^]+$/.test(formatId)) {
    return res.status(400).json({ error: 'Invalid format identifier.' });
  }

  const downloadId = crypto.randomUUID();
  const safeTitle = sanitizeFilename(title || 'video');
  const outputTemplate = path.join(DOWNLOADS_DIR, `${downloadId}_%(title).100s.%(ext)s`);

  // Progress template outputs JSON to stdout for real-time progress
  // On Windows, stderr is fully buffered when piped, so we must use stdout
  const progressTemplate =
    'stdout:{"p":"%(progress._percent_str)s","s":"%(progress._speed_str)s","e":"%(progress._eta_str)s","t":"%(progress._total_bytes_str)s"}';

  const args = [
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-warnings',
    '--progress-template', progressTemplate,
    '-f', formatId,
    '-o', outputTemplate,
    '--merge-output-format', ext === 'mp3' ? 'mp3' : 'mp4',
    '--embed-metadata',
    sanitizeUrl(url),
  ];

  // If no audio is needed, don't embed metadata (avoid ffmpeg errors)
  if (formatId.startsWith('bestvideo')) {
    args.push('--no-embed-metadata');
  }

  const proc = spawn(YT_DLP, args, {
    cwd: DOWNLOADS_DIR,
    shell: false,
  });

  const downloadState = {
    id: downloadId,
    proc,
    outputPath: null,
    progress: 0,
    speed: '',
    eta: '',
    totalSize: '',
    status: 'downloading',
    error: null,
    createdAt: Date.now(),
  };

  activeDownloads.set(downloadId, downloadState);

  // Parse real-time progress from stdout JSON lines
  // The --progress-template outputs lines like: stdout:{"p":" 45.2%","s":" 2.3MiB/s","e":"00:12","t":" 50.23MiB"}
  let stdoutBuf = '';
  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdoutBuf += text;

    // Split by newline and process complete lines
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete line in buffer

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Progress JSON lines start with "stdout:{..."
      if (line.startsWith('stdout:{') && line.endsWith('}')) {
        try {
          const jsonStr = line.slice(7); // strip "stdout:" prefix
          const data = JSON.parse(jsonStr);

          // Parse percent (e.g., " 45.2%" -> 45.2)
          if (data.p && data.p !== 'NA') {
            const pct = parseFloat(data.p.replace('%', '').trim());
            if (!isNaN(pct)) downloadState.progress = pct;
          }

          // Speed (e.g., " 2.3MiB/s")
          if (data.s && data.s !== 'NA') {
            downloadState.speed = data.s.trim();
          }

          // ETA (e.g., "00:12")
          if (data.e && data.e !== 'NA') {
            downloadState.eta = data.e.trim();
          }

          // Total size (e.g., " 50.23MiB")
          if (data.t && data.t !== 'NA') {
            downloadState.totalSize = data.t.trim();
          }

          // When progress hits 100%, mark as processing
          if (downloadState.progress >= 100) {
            downloadState.status = 'processing';
          }
        } catch {
          // skip malformed JSON lines
        }
      } else if (line && !line.startsWith('[') && !line.startsWith('stdout:') && fs.existsSync(line)) {
        // yt-dlp outputs the final filename on stdout (non-JSON, non-bracket lines)
        downloadState.outputPath = line;
      }
    }
  });

  // Log stderr for debugging (progress goes to stdout now)
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.log('yt-dlp:', text.split('\n').pop());
  });

  proc.on('close', (code) => {
    if (code === 0) {
      // Find the output file
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const file = files.find((f) => f.startsWith(downloadId));
      if (file) {
        downloadState.outputPath = path.join(DOWNLOADS_DIR, file);
      }
      downloadState.status = 'completed';
      downloadState.progress = 100;
    } else {
      downloadState.status = 'failed';
      downloadState.error = `yt-dlp exited with code ${code}`;
    }

    // Clean up download state after a delay
    setTimeout(() => {
      activeDownloads.delete(downloadId);
    }, 5 * 60 * 1000);
  });

  proc.on('error', (err) => {
    downloadState.status = 'failed';
    downloadState.error = err.message;
  });

  res.json({ downloadId });
});

/** GET /api/progress/:id — SSE stream for download progress */
app.get('/api/progress/:id', (req, res) => {
  const { id } = req.params;
  const state = activeDownloads.get(id);

  if (!state) {
    return res.status(404).json({ error: 'Download not found or expired.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendProgress = () => {
    const s = activeDownloads.get(id);
    if (!s) {
      res.write(`data: ${JSON.stringify({ status: 'expired' })}\n\n`);
      res.end();
      return;
    }

    res.write(
      `data: ${JSON.stringify({
        progress: s.progress,
        speed: s.speed,
        eta: s.eta,
        totalSize: s.totalSize,
        status: s.status,
        error: s.error,
      })}\n\n`
    );

    if (s.status === 'completed' || s.status === 'failed') {
      res.end();
    } else {
      setTimeout(sendProgress, 500);
    }
  };

  sendProgress();

  req.on('close', () => {
    // client disconnected, nothing to clean
  });
});

/** GET /api/download/:id — serve the completed file */
app.get('/api/download/:id', (req, res) => {
  const { id } = req.params;

  // Check active downloads
  const state = activeDownloads.get(id);
  if (state && state.outputPath && fs.existsSync(state.outputPath)) {
    const filename = path.basename(state.outputPath);
    res.download(state.outputPath, filename, (err) => {
      if (err) console.error('Download stream error:', err.message);
    });
    return;
  }

  // Check downloads folder directly (in case state expired)
  const files = fs.readdirSync(DOWNLOADS_DIR);
  const file = files.find((f) => f.startsWith(id));
  if (file) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    res.download(filePath, file.replace(id + '_', ''), (err) => {
      if (err) console.error('Download stream error:', err.message);
    });
    return;
  }

  res.status(404).json({ error: 'File not found. It may have expired.' });
});

// ── Serve SPA (catch-all) ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎬 YouTube Downloader running at http://localhost:${PORT}`);
});
