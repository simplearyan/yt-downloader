const express = require('express');
const { spawn, spawnSync } = require('child_process');
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

// ── Routes ──────────────────────────────────────────────────────────────────

/** GET /api/info — fetch video metadata from yt-dlp */
app.get('/api/info', async (req, res) => {
  const url = req.query.url?.trim();
  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL. Please enter a valid YouTube URL.' });
  }

  try {
    const args = [
      '--no-playlist',
      '--skip-download',
      '--dump-json',
      '--no-warnings',
      url,
    ];

    const result = spawnSync(YT_DLP, args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      timeout: 30000, // 30 seconds
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`yt-dlp exited with code ${result.status}`);
    }

    const raw = result.stdout;

    // yt-dlp --dump-json outputs one JSON line per video
    const lines = raw.trim().split('\n');
    const data = JSON.parse(lines[lines.length - 1]);

    // Build format list for the user to pick from
    const formats = (data.formats || [])
      .filter((f) => f.vcodec !== 'none' || f.acodec !== 'none')
      .map((f) => ({
        formatId: f.format_id,
        ext: f.ext,
        quality: f.height ? `${f.height}p` : f.abr ? `${Math.round(f.abr)}kbps` : 'audio only',
        vcodec: f.vcodec || 'none',
        acodec: f.acodec || 'none',
        filesize: f.filesize || f.filesize_approx || 0,
        fps: f.fps || 0,
        hasVideo: f.vcodec !== 'none',
        hasAudio: f.acodec !== 'none',
      }))
      .filter((f) => f.hasVideo || f.hasAudio);

    // Add convenience options at the top
    const bestOptions = [
      {
        label: '🎬 Best Video + Audio (MP4)',
        formatId: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        ext: 'mp4',
        quality: 'Best',
        hasVideo: true,
        hasAudio: true,
        isBest: true,
      },
      {
        label: '🎵 Best Audio Only (MP3)',
        formatId: 'bestaudio/best',
        ext: 'mp3',
        quality: 'Best',
        hasVideo: false,
        hasAudio: true,
        isBest: true,
      },
    ];

    res.json({
      id: data.id,
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration,
      uploader: data.uploader,
      uploaderUrl: data.uploader_url,
      viewCount: data.view_count,
      formats,
      bestOptions,
    });
  } catch (err) {
    console.error('yt-dlp info error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch video info. The video might be private, age-restricted, or unavailable.',
    });
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
  if (!/^[\w.*+\-\/\[\]=]+$/.test(formatId)) {
    return res.status(400).json({ error: 'Invalid format identifier.' });
  }

  const downloadId = crypto.randomUUID();
  const safeTitle = sanitizeFilename(title || 'video');
  const outputTemplate = path.join(DOWNLOADS_DIR, `${downloadId}_%(title).100s.%(ext)s`);

  const args = [
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-warnings',
    '-f', formatId,
    '-o', outputTemplate,
    '--merge-output-format', ext === 'mp3' ? 'mp3' : 'mp4',
    '--embed-metadata',
    url,
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
    totalSize: 0,
    downloadedSize: 0,
    status: 'downloading',
    error: null,
    createdAt: Date.now(),
  };

  activeDownloads.set(downloadId, downloadState);

  // Parse progress lines from yt-dlp stderr
  proc.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (!line) return;

    // yt-dlp progress format: [download]  45.2% of ~50.23MiB at  2.3MiB/s ETA 00:12
    const progressMatch = line.match(
      /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+[KMGTP]?i?B)\s+at\s+([\d.]+[KMGTP]?i?B\/s)\s+ETA\s+([\w:]+)/
    );
    if (progressMatch) {
      downloadState.progress = parseFloat(progressMatch[1]);
      downloadState.totalSize = progressMatch[2];
      downloadState.speed = progressMatch[3];
      downloadState.eta = progressMatch[4];
    }

    // yt-dlp final line: [download] 100% of 50.23MiB
    const completedMatch = line.match(/\[download\]\s+100%/);
    if (completedMatch) {
      downloadState.progress = 100;
      downloadState.status = 'processing';
    }

    // Success: [Merger] or "has already been downloaded"
    const successMatch = line.match(/\[(Merger|Metadata|EmbedSubtitle|ffmpeg|ExtractAudio)\]/);
    if (successMatch && downloadState.progress >= 100) {
      downloadState.status = 'processing';
    }
  });

  proc.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    // yt-dlp outputs the final filename on stdout
    if (line && !line.startsWith('[') && fs.existsSync(line)) {
      downloadState.outputPath = line;
    }
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
