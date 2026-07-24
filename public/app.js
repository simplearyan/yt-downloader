/* ════════════════════════════════════════════════════════
   YouTube Downloader — App Logic
   ════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────
  let state = {
    url: '',
    videoInfo: null,
    selectedFormatId: null,
    downloadId: null,
    isDownloading: false,
    isFetching: false,
  };

  // ── DOM References ──────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const el = {
    themeToggle: $('#themeToggle'),
    urlInput: $('#urlInput'),
    fetchBtn: $('#fetchBtn'),
    urlCard: $('#urlCard'),
    loadingCard: $('#loadingCard'),
    videoCard: $('#videoCard'),
    thumbnail: $('#thumbnail'),
    durationBadge: $('#durationBadge'),
    videoTitle: $('#videoTitle'),
    videoUploader: $('#videoUploader'),
    videoMeta: $('#videoMeta'),
    formatCard: $('#formatCard'),
    formatOptions: $('#formatOptions'),
    progressCard: $('#progressCard'),
    progressTitle: $('#progressTitle'),
    progressStatus: $('#progressStatus'),
    progressBar: $('#progressBar'),
    progressSpeed: $('#progressSpeed'),
    progressEta: $('#progressEta'),
    progressSize: $('#progressSize'),
    downloadBtn: $('#downloadBtn'),
    newDownloadBtn: $('#newDownloadBtn'),
    errorCard: $('#errorCard'),
    errorMessage: $('#errorMessage'),
    retryBtn: $('#retryBtn'),
  };

  // ── Theme ───────────────────────────────────────────
  function getPreferredTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = el.themeToggle.querySelector('.material-symbols-outlined');
    icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Init theme
  applyTheme(getPreferredTheme());
  el.themeToggle.addEventListener('click', toggleTheme);

  // ── Helpers ─────────────────────────────────────────
  function show(...elements) {
    elements.forEach((el) => {
      if (el) el.style.display = '';
    });
  }

  function hide(...elements) {
    elements.forEach((el) => {
      if (el) el.style.display = 'none';
    });
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatCount(n) {
    if (!n) return '';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  }

  function formatSize(str) {
    return str || '—';
  }

  function showError(message) {
    el.errorMessage.textContent = message;
    hide(el.loadingCard, el.videoCard, el.formatCard, el.progressCard);
    show(el.errorCard);
  }

  function resetUI() {
    hide(
      el.loadingCard,
      el.videoCard,
      el.formatCard,
      el.progressCard,
      el.errorCard
    );
    el.progressBar.style.width = '0%';
    el.progressStatus.textContent = '0%';
    el.downloadBtn.style.display = 'none';
    el.newDownloadBtn.style.display = 'none';
    state.downloadId = null;
    state.isDownloading = false;
  }

  // ── URL Input ───────────────────────────────────────
  el.urlInput.addEventListener('input', () => {
    state.url = el.urlInput.value.trim();
    el.fetchBtn.disabled = !state.url;
  });

  el.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !el.fetchBtn.disabled) {
      fetchVideoInfo();
    }
  });

  // Auto-paste removed — users paste manually to avoid clipboard permission prompt

  el.fetchBtn.addEventListener('click', () => {
    if (!state.isFetching) fetchVideoInfo();
  });
  el.retryBtn.addEventListener('click', fetchVideoInfo);
  el.newDownloadBtn.addEventListener('click', () => {
    resetUI();
    show(el.urlCard, el.videoCard, el.formatCard);
    el.urlInput.focus();
  });

  // ── Fetch Video Info ────────────────────────────────
  async function fetchVideoInfo() {
    if (!state.url || state.isFetching) return;

    state.isFetching = true;
    el.fetchBtn.disabled = true;
    resetUI();
    show(el.loadingCard);

    try {
      const encodedUrl = encodeURIComponent(state.url);
      const response = await fetch(`/api/info?url=${encodedUrl}`);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Server error (${response.status})`);
      }

      const info = await response.json();
      state.videoInfo = info;

      renderVideoInfo(info);
      renderFormats(info);
      hide(el.loadingCard);
      show(el.videoCard, el.formatCard);
    } catch (err) {
      console.error('Fetch info error:', err);
      showError(err.message || 'Failed to fetch video information. Check the URL and try again.');
    } finally {
      state.isFetching = false;
      el.fetchBtn.disabled = !el.urlInput.value.trim();
    }
  }

  // ── Render Video Info ───────────────────────────────
  function renderVideoInfo(info) {
    el.thumbnail.src = info.thumbnail || '';
    el.thumbnail.alt = info.title || 'Video thumbnail';
    el.durationBadge.textContent = formatDuration(info.duration);
    el.videoTitle.textContent = info.title || 'Unknown Title';
    el.videoUploader.textContent = info.uploader || '';
    el.videoMeta.textContent = [
      formatDuration(info.duration),
      info.viewCount ? `${formatCount(info.viewCount)} views` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // ── Render Formats ──────────────────────────────────
  function renderFormats(info) {
    el.formatOptions.innerHTML = '';

    // Best options first
    if (info.bestOptions) {
      info.bestOptions.forEach((opt) => {
        const option = createFormatOption(opt);
        el.formatOptions.appendChild(option);
      });

      // Separator
      const separator = document.createElement('div');
      separator.style.cssText =
        'height:1px;background:var(--color-outline-variant);margin:4px 0;';
      el.formatOptions.appendChild(separator);
    }

    // Individual formats
    if (info.formats && info.formats.length > 0) {
      info.formats.forEach((fmt) => {
        const option = createFormatOption(fmt);
        el.formatOptions.appendChild(option);
      });
    }

    // Select first option by default
    const firstRadio = el.formatOptions.querySelector('.format-option');
    if (firstRadio) {
      firstRadio.classList.add('selected');
      state.selectedFormatId = firstRadio.dataset.formatId;
    }

    // Add download button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-primary download-format-btn';
    downloadBtn.innerHTML = `
      <span class="material-symbols-outlined">file_download</span>
      <span class="btn-label">Download</span>
    `;
    downloadBtn.addEventListener('click', startDownload);
    el.formatOptions.appendChild(downloadBtn);
  }

  function createFormatOption(fmt) {
    const div = document.createElement('div');
    div.className = 'format-option';
    div.dataset.formatId = fmt.formatId;
    div.dataset.ext = fmt.ext || 'mp4';
    div.dataset.title = fmt.title || state.videoInfo?.title || 'video';
    div.dataset.isBest = fmt.isBest ? 'true' : 'false';

    // Determine label
    let name = fmt.label || '';
    let desc = '';

    if (fmt.isBest) {
      // Best options already have nice labels
      name = fmt.label || (fmt.hasVideo ? 'Best Video + Audio' : 'Best Audio Only');
      desc = fmt.hasVideo
        ? 'Highest quality video with audio (recommended)'
        : 'Best quality audio as MP3';
    } else if (fmt.hasVideo && fmt.hasAudio) {
      name = `${fmt.quality} ${fmt.vcodec !== 'none' ? fmt.vcodec.split('.')[0].toUpperCase() : 'Video'}`;
      desc = `${fmt.ext.toUpperCase()} · ${fmt.fps > 0 ? `${fmt.fps}fps · ` : ''}${fmt.acodec !== 'none' ? 'With audio' : 'No audio'}`;
      if (fmt.filesize) {
        const sizeMB = (fmt.filesize / 1024 / 1024).toFixed(1);
        desc += ` · ~${sizeMB}MB`;
      }
    } else if (fmt.hasVideo) {
      name = `${fmt.quality} Video Only`;
      desc = `${fmt.ext.toUpperCase()} · ${fmt.vcodec !== 'none' ? fmt.vcodec.split('.')[0].toUpperCase() : 'Video'}${fmt.fps > 0 ? ` · ${fmt.fps}fps` : ''}`;
      if (fmt.filesize) {
        const sizeMB = (fmt.filesize / 1024 / 1024).toFixed(1);
        desc += ` · ~${sizeMB}MB`;
      }
    } else if (fmt.hasAudio) {
      name = `${fmt.quality} Audio Only`;
      desc = `${fmt.ext.toUpperCase()} · ${fmt.acodec !== 'none' ? fmt.acodec.split('.')[0].toUpperCase() : 'Audio'}`;
      if (fmt.filesize) {
        const sizeMB = (fmt.filesize / 1024 / 1024).toFixed(1);
        desc += ` · ~${sizeMB}MB`;
      }
    }

    div.innerHTML = `
      <div class="format-radio"></div>
      <div class="format-label">
        <div class="format-name">${name}</div>
        <div class="format-desc">${desc}</div>
      </div>
      <span class="format-ext">${fmt.ext || '—'}</span>
    `;

    div.addEventListener('click', () => {
      el.formatOptions
        .querySelectorAll('.format-option')
        .forEach((o) => o.classList.remove('selected'));
      div.classList.add('selected');
      state.selectedFormatId = fmt.formatId;
    });

    return div;
  }

  // ── Start Download ──────────────────────────────────
  async function startDownload() {
    if (!state.selectedFormatId || !state.url || state.isDownloading) return;

    const selectedOption = el.formatOptions.querySelector('.format-option.selected');
    const ext = selectedOption?.dataset?.ext || 'mp4';

    state.isDownloading = true;
    hide(el.videoCard, el.formatCard, el.errorCard);
    show(el.progressCard);
    el.downloadBtn.style.display = 'none';
    el.newDownloadBtn.style.display = 'none';
    el.progressTitle.textContent = 'Downloading…';
    el.progressBar.style.width = '0%';
    el.progressStatus.textContent = '0%';
    el.progressSpeed.textContent = '—';
    el.progressEta.textContent = '—';
    el.progressSize.textContent = '—';

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: state.url,
          formatId: state.selectedFormatId,
          title: state.videoInfo?.title || 'video',
          ext: ext,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Download failed (${response.status})`);
      }

      const { downloadId } = await response.json();
      state.downloadId = downloadId;

      // Start listening to progress via SSE
      listenToProgress(downloadId);
    } catch (err) {
      console.error('Download start error:', err);
      showError(err.message || 'Failed to start download.');
      state.isDownloading = false;
    }
  }

  // ── Progress via SSE ────────────────────────────────
  function listenToProgress(downloadId) {
    const evtSource = new EventSource(`/api/progress/${downloadId}`);

    let sseTimeout = setTimeout(handleTimeout, 30000);
    let isDone = false;

    function handleTimeout() {
      evtSource.close();
      if (!isDone && state.isDownloading) {
        el.progressTitle.textContent = 'Connection lost';
        el.progressStatus.textContent = '?';
        el.newDownloadBtn.style.display = '';
        el.newDownloadBtn.querySelector('.btn-label').textContent = 'Check your server';
        state.isDownloading = false;
      }
    }

    function finish(status) {
      if (isDone) return;
      isDone = true;
      clearTimeout(sseTimeout);
      evtSource.close();

      if (status === 'completed') {
        el.progressBar.style.width = '100%';
        el.progressStatus.textContent = '100%';
        el.progressTitle.textContent = 'Download complete!';
        el.downloadBtn.style.display = '';
        el.newDownloadBtn.style.display = '';
        el.newDownloadBtn.querySelector('.btn-label').textContent = 'New Download';
      } else if (status === 'failed' || status === 'expired') {
        showError(status === 'failed' ? (state.lastError || 'Download failed.') : 'Download session expired. Please try again.');
      }
      state.isDownloading = false;
    }

    evtSource.onmessage = (e) => {
      // Reset the inactivity timeout on every update
      clearTimeout(sseTimeout);
      sseTimeout = setTimeout(handleTimeout, 30000);

      try {
        const data = JSON.parse(e.data);
        state.lastError = data.error;

        if (data.status === 'downloading' || data.status === 'processing') {
          const pct = Math.round(data.progress || 0);
          el.progressBar.style.width = `${pct}%`;
          el.progressStatus.textContent = `${pct}%`;
          el.progressSpeed.textContent = data.speed ? `Speed: ${data.speed}` : '—';
          el.progressEta.textContent = data.eta ? `ETA: ${data.eta}` : '—';
          el.progressSize.textContent = data.totalSize ? `Size: ${data.totalSize}` : '—';
          if (data.status === 'processing') {
            el.progressTitle.textContent = 'Processing…';
          }
        } else if (data.status === 'completed') {
          finish('completed');
        } else if (data.status === 'failed') {
          finish('failed');
        } else if (data.status === 'expired') {
          finish('expired');
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    evtSource.onerror = () => {
      if (isDone) return;
      // Reset timeout on error too — Firefox fires onerror during reconnect
      clearTimeout(sseTimeout);
      sseTimeout = setTimeout(handleTimeout, 30000);
    };
  }

  // ── Download File ───────────────────────────────────
  el.downloadBtn.addEventListener('click', () => {
    if (!state.downloadId) return;
    const a = document.createElement('a');
    a.href = `/api/download/${state.downloadId}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // ── Keyboard Shortcut: Escape = reset ───────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !state.isDownloading) {
      resetUI();
      show(el.urlCard);
      el.urlInput.focus();
    }
  });
})();
