/* ════════════════════════════════════════════════════════
   YouTube Downloader — App Logic
   ════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────
  let state = {
    url: '',
    videoInfo: null,
    allFormats: [],
    selectedFormatId: null,
    downloadId: null,
    isDownloading: false,
    isFetching: false,
    activeTab: 'recommended',
    activeCodecFilter: 'all',
    selectedThumbnailQuality: 'maxres',
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
    formatTabs: $('#formatTabs'),
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
    historyCard: $('#historyCard'),
    historyItems: $('#historyItems'),
    clearHistoryBtn: $('#clearHistoryBtn'),
    searchHistory: $('#searchHistory'),
    codecSubTabs: $('#codecSubTabs'),
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

  function showError(message) {
    el.errorMessage.textContent = message;
    hide(el.loadingCard, el.progressCard);
    show(el.errorCard);
  }

  function resetUI() {
    hide(el.loadingCard, el.formatCard, el.progressCard, el.errorCard);
    el.progressBar.style.width = '0%';
    el.progressStatus.textContent = '0%';
    el.downloadBtn.style.display = 'none';
    el.newDownloadBtn.style.display = 'none';
    state.downloadId = null;
    state.isDownloading = false;
  }

  // ── History (localStorage) ──────────────────────────
  const HISTORY_KEY = 'ytdl_history';

  function getHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }

  function addToHistory(entry) {
    const history = getHistory();
    // Insert at the beginning, keep max 50 entries
    history.unshift(entry);
    if (history.length > 50) history.length = 50;
    saveHistory(history);
    renderHistory();
  }

  function clearHistory() {
    saveHistory([]);
    renderHistory();
  }

  function formatTimeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function renderHistory() {
    const history = getHistory();
    if (history.length === 0) {
      el.historyCard.style.display = 'none';
      return;
    }

    el.historyCard.style.display = '';
    el.historyItems.innerHTML = '';

    history.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'history-item';

      div.innerHTML = `
        <div class="history-thumb">
          <img src="${item.thumbnail || ''}" alt="" loading="lazy" />
          <span class="history-ext">${item.ext || '?'}</span>
        </div>
        <div class="history-info">
          <div class="history-title">${item.title || 'Unknown'}</div>
          <div class="history-meta">${item.uploader || ''} &middot; ${formatTimeAgo(item.date)}</div>
        </div>
        <button class="history-reuse" data-url="${item.url || ''}" title="Download again">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      `;

      // Click on the refresh button re-fetches the same URL
      div.querySelector('.history-reuse').addEventListener('click', (e) => {
        e.stopPropagation();
        el.urlInput.value = item.url || '';
        state.url = item.url || '';
        el.fetchBtn.disabled = false;
        el.urlInput.focus();
        fetchVideoInfo();
      });

      el.historyItems.appendChild(div);
    });
  }

  // Clear history button
  el.clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Clear all download history?')) {
      clearHistory();
    }
  });

  // Load history on startup
  renderHistory();

  // ── Search History (localStorage) ────────────────────
  const SEARCHES_KEY = 'ytdl_searches';

  function getSearches() {
    try {
      const raw = localStorage.getItem(SEARCHES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSearches(searches) {
    try {
      localStorage.setItem(SEARCHES_KEY, JSON.stringify(searches));
    } catch {}
  }

  function trackSearch(url) {
    const searches = getSearches();
    // Remove duplicate if exists
    const existingIdx = searches.findIndex((s) => s.url === url);
    if (existingIdx !== -1) searches.splice(existingIdx, 1);
    // Add to front
    searches.unshift({ url, date: new Date().toISOString() });
    if (searches.length > 20) searches.length = 20;
    saveSearches(searches);
  }

  function clearSearchHistory() {
    saveSearches([]);
    el.searchHistory.classList.remove('visible');
  }

  function renderSearchHistory(filterText) {
    const searches = getSearches();
    if (searches.length === 0) {
      el.searchHistory.innerHTML = '';
      el.searchHistory.classList.remove('visible');
      return;
    }

    // Filter by text if provided
    const filtered = filterText
      ? searches.filter((s) => s.url.toLowerCase().includes(filterText.toLowerCase()))
      : searches;

    if (filtered.length === 0) {
      el.searchHistory.innerHTML = '<div class="search-history-empty">No matching URLs</div>';
      el.searchHistory.classList.add('visible');
      return;
    }

    let html = '<div class="search-history-header"><span>Recent URLs</span><button class="search-history-clear" id="searchHistoryClearBtn">Clear</button></div>';

    filtered.forEach((s) => {
      // Extract a short display from the URL
      const displayUrl = s.url.length > 60 ? s.url.slice(0, 57) + '...' : s.url;
      html += `
        <div class="search-history-item" data-url="${escapeHtml(s.url)}">
          <span class="material-symbols-outlined">history</span>
          <span class="history-title">${escapeHtml(displayUrl)}</span>          <span class="history-ext">${escapeHtml(formatTimeAgo(s.date))}</span>
        </div>`;
    });

    el.searchHistory.innerHTML = html;
    el.searchHistory.classList.add('visible');

    // Bind clear button
    const clearBtn = el.searchHistory.querySelector('#searchHistoryClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearSearchHistory();
      });
    }

    // Bind click on items
    el.searchHistory.querySelectorAll('.search-history-item').forEach((item) => {
      item.addEventListener('click', () => {
        const url = item.dataset.url;
        el.urlInput.value = url;
        state.url = url;
        el.fetchBtn.disabled = false;
        el.searchHistory.classList.remove('visible');
        el.urlInput.focus();
      });
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── URL Input with Search History ───────────────────
  el.urlInput.addEventListener('input', () => {
    state.url = el.urlInput.value.trim();
    el.fetchBtn.disabled = !state.url;
    // Show filtered search history
    if (state.url) {
      renderSearchHistory(state.url);
    }
  });

  el.urlInput.addEventListener('focus', () => {
    // Only show search history if input is empty
    if (!el.urlInput.value.trim()) {
      renderSearchHistory('');
    }
  });

  el.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      el.searchHistory.classList.remove('visible');
    } else if (e.key === 'Enter' && !el.fetchBtn.disabled) {
      el.searchHistory.classList.remove('visible');
      fetchVideoInfo();
    }
  });

  // Hide search history when clicking outside
  document.addEventListener('click', (e) => {
    const wrapper = el.urlInput.closest('.input-wrapper-with-dropdown');
    if (wrapper && !wrapper.contains(e.target)) {
      el.searchHistory.classList.remove('visible');
    }
  });

  el.fetchBtn.addEventListener('click', () => {
    if (!state.isFetching) fetchVideoInfo();
  });
  el.retryBtn.addEventListener('click', fetchVideoInfo);
  el.newDownloadBtn.addEventListener('click', () => {
    resetUI();
    show(el.urlCard);
    el.urlInput.focus();
    state.url = '';
    el.fetchBtn.disabled = true;
  });

  // ── Format Tabs ─────────────────────────────────────
  el.formatTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.format-tab');
    if (!tab) return;
    const tabName = tab.dataset.tab;
    if (!tabName || tabName === state.activeTab) return;

    el.formatTabs.querySelectorAll('.format-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeTab = tabName;
    state.activeCodecFilter = 'all';
    renderCurrentTab();
  });

  // ── Codec Sub-Tabs ──────────────────────────────────
  el.codecSubTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.codec-sub-tab');
    if (!btn) return;
    const filter = btn.dataset.codec;
    if (!filter || filter === state.activeCodecFilter) return;

    el.codecSubTabs.querySelectorAll('.codec-sub-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeCodecFilter = filter;
    renderCurrentTab();
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

      // Track this URL in search history
      trackSearch(state.url);

      // Categorize formats
      const formats = info.formats || [];
      state.allFormats = {
        recommended: info.bestOptions || [],
        video: formats.filter((f) => f.hasVideo && !f.hasAudio),
        audio: formats.filter((f) => f.hasAudio && !f.hasVideo),
      };

      state.videoId = info.id;

      renderVideoInfo(info);
      // Reset to recommended tab
      state.activeTab = 'recommended';
      state.activeCodecFilter = 'all';
      el.formatTabs.querySelectorAll('.format-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === 'recommended');
      });
      renderCurrentTab();

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

  // ── Render Current Tab ──────────────────────────────
  function renderCurrentTab() {
    el.formatOptions.innerHTML = '';
    el.codecSubTabs.style.display = 'none';
    el.codecSubTabs.innerHTML = '';

    // Thumbnail tab renders differently
    if (state.activeTab === 'thumbnail') {
      renderThumbnailTab();
      return;
    }

    // Get formats for the current tab
    let formats = state.allFormats[state.activeTab] || [];

    // Show codec sub-tabs for video and audio tabs
    if (state.activeTab === 'video' || state.activeTab === 'audio') {
      renderCodecSubTabs(state.activeTab);

      // Apply codec filter
      if (state.activeCodecFilter !== 'all') {
        if (state.activeTab === 'video') {
          formats = formats.filter((f) => {
            const cat = f.codecCategory || '';
            return filterByCodec(cat, state.activeCodecFilter);
          });
        } else if (state.activeTab === 'audio') {
          formats = formats.filter((f) => {
            const ac = (f.acodec || '').toLowerCase();
            return filterByAudioCodec(ac, state.activeCodecFilter);
          });
        }
      }
    }

    if (formats.length === 0) {
      el.formatOptions.innerHTML =
        '<p style="color:var(--color-on-surface-variant);font-size:13px;padding:8px 0;text-align:center">No formats available in this category.</p>';
      return;
    }

    formats.forEach((fmt) => {
      const option = createFormatOption(fmt);
      el.formatOptions.appendChild(option);
    });

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

  function filterByCodec(category, filter) {
    if (filter === 'all') return true;
    const cat = category.toLowerCase();
    if (filter === 'h264') return ['h.264', 'avc', 'x264'].some((c) => cat.includes(c));
    if (filter === 'vp9') return cat.includes('vp9');
    if (filter === 'av1') return cat.includes('av1');
    if (filter === 'h265') return ['h.265', 'hevc', 'x265'].some((c) => cat.includes(c));
    if (filter === 'other') {
      return !['h.264', 'avc', 'x264', 'vp9', 'av1', 'h.265', 'hevc', 'x265'].some((c) => cat.includes(c));
    }
    return true;
  }

  function filterByAudioCodec(codec, filter) {
    if (filter === 'all') return true;
    if (filter === 'aac') return codec.includes('aac');
    if (filter === 'opus') return codec.includes('opus');
    if (filter === 'mp3') return codec.includes('mp3');
    if (filter === 'vorbis') return codec.includes('vorbis');
    if (filter === 'other') {
      return !['aac', 'opus', 'mp3', 'vorbis'].some((c) => codec.includes(c));
    }
    return true;
  }

  function renderCodecSubTabs(tab) {
    const isVideo = tab === 'video';
    const filters = isVideo
      ? [
          { id: 'all', label: 'All' },
          { id: 'h264', label: 'H.264' },
          { id: 'vp9', label: 'VP9' },
          { id: 'av1', label: 'AV1' },
          { id: 'h265', label: 'H.265' },
          { id: 'other', label: 'Other' },
        ]
      : [
          { id: 'all', label: 'All' },
          { id: 'aac', label: 'AAC' },
          { id: 'opus', label: 'Opus' },
          { id: 'mp3', label: 'MP3' },
          { id: 'vorbis', label: 'Vorbis' },
          { id: 'other', label: 'Other' },
        ];

    el.codecSubTabs.style.display = 'flex';
    filters.forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'codec-sub-tab';
      btn.dataset.codec = f.id;
      btn.textContent = f.label;
      if (f.id === state.activeCodecFilter) {
        btn.classList.add('active');
      }
      el.codecSubTabs.appendChild(btn);
    });
  }

  // ── Thumbnail Tab ────────────────────────────────────
  function renderThumbnailTab() {
    if (!state.videoInfo || !state.videoId) {
      el.formatOptions.innerHTML =
        '<p style="color:var(--color-on-surface-variant);font-size:13px;padding:8px 0;text-align:center">No video loaded.</p>';
      return;
    }

    const qualities = [
      { id: 'maxres', label: 'Max Resolution', res: '1920×1080', url: `https://i.ytimg.com/vi/${state.videoId}/maxresdefault.jpg` },
      { id: 'hqdefault', label: 'High Quality', res: '480×360', url: `https://i.ytimg.com/vi/${state.videoId}/hqdefault.jpg` },
      { id: 'mqdefault', label: 'Medium Quality', res: '320×180', url: `https://i.ytimg.com/vi/${state.videoId}/mqdefault.jpg` },
      { id: 'default', label: 'Standard', res: '120×90', url: `https://i.ytimg.com/vi/${state.videoId}/default.jpg` },
    ];

    // Try the highest quality first, fallback to what we have
    const previewUrl = state.videoInfo.thumbnail || qualities[0].url;

    el.formatOptions.innerHTML = `
      <div class="thumbnail-tab">
        <div class="thumbnail-preview">
          <img src="${escapeHtml(previewUrl)}" alt="Thumbnail preview" id="thumbnailPreviewImg" />
        </div>
        <div class="thumbnail-options" id="thumbnailOptions">
          ${qualities.map((q) => `
            <div class="thumbnail-option ${q.id === state.selectedThumbnailQuality ? 'selected' : ''}" data-quality="${q.id}" data-url="${escapeHtml(q.url)}">
              <span>${escapeHtml(q.label)}</span>
              <span class="thumbnail-resolution">${escapeHtml(q.res)}</span>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-primary thumbnail-download-btn" id="thumbnailDownloadBtn">
          <span class="material-symbols-outlined">image</span>
          <span class="btn-label">Download Thumbnail</span>
        </button>
      </div>
    `;

    // Handle quality selection
    el.formatOptions.querySelectorAll('.thumbnail-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        el.formatOptions.querySelectorAll('.thumbnail-option').forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');
        state.selectedThumbnailQuality = opt.dataset.quality;
        // Update preview
        const previewImg = document.getElementById('thumbnailPreviewImg');
        if (previewImg) {
          previewImg.src = opt.dataset.url;
        }
      });
    });

    // Handle download
    const downloadThumbBtn = document.getElementById('thumbnailDownloadBtn');
    if (downloadThumbBtn) {
      downloadThumbBtn.addEventListener('click', downloadThumbnail);
    }
  }

  async function downloadThumbnail() {
    const selectedOpt = el.formatOptions.querySelector('.thumbnail-option.selected');
    if (!selectedOpt) return;

    const url = selectedOpt.dataset.url;
    const title = state.videoInfo?.title || 'thumbnail';
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);

    // Direct browser download — no progress bar, no server roundtrip
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${safeTitle}_thumbnail.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
      console.error('Thumbnail download error:', err);
      showError('Failed to download thumbnail: ' + (err.message || 'Unknown error'));
    }
  }

  function createFormatOption(fmt) {
    const div = document.createElement('div');
    div.className = 'format-option';
    div.dataset.formatId = fmt.formatId;
    div.dataset.ext = fmt.ext || 'mp4';
    div.dataset.title = fmt.title || state.videoInfo?.title || 'video';
    div.dataset.isBest = fmt.isBest ? 'true' : 'false';

    let name = fmt.label || '';
    let desc = '';

    if (fmt.isBest) {
      name = fmt.label || (fmt.hasVideo ? 'Best Video + Audio' : 'Best Audio Only');
      desc = fmt.hasVideo
        ? 'Highest quality video with audio'
        : 'Best quality audio as MP3';
    } else if (fmt.hasVideo && fmt.hasAudio) {
      name = `${fmt.quality} ${fmt.vcodec !== 'none' ? fmt.vcodec.split('.')[0].toUpperCase() : 'Video'}`;
      desc = `${fmt.ext.toUpperCase()} · ${fmt.fps > 0 ? `${fmt.fps}fps · ` : ''}${fmt.acodec !== 'none' ? 'With audio' : 'No audio'}`;
      if (fmt.filesize) {
        const sizeMB = (fmt.filesize / 1024 / 1024).toFixed(1);
        desc += ` · ~${sizeMB}MB`;
      }
    } else if (fmt.hasVideo) {
      const codecName = fmt.codecCategory || (fmt.vcodec !== 'none' ? fmt.vcodec.split('.')[0].toUpperCase() : 'Video');
      name = `${fmt.quality} ${codecName}`;
      desc = `${fmt.ext.toUpperCase()} · ${fmt.fps > 0 ? `${fmt.fps}fps · ` : ''}No audio`;
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
    hide(el.errorCard);
    show(el.progressCard);
    el.downloadBtn.style.display = 'none';
    el.newDownloadBtn.style.display = 'none';
    el.progressTitle.textContent = 'Downloading';
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
        el.newDownloadBtn.querySelector('.btn-label').textContent = 'New Download';
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
        el.progressTitle.textContent = 'Download complete';
        el.downloadBtn.style.display = '';
        el.newDownloadBtn.style.display = '';
        el.newDownloadBtn.querySelector('.btn-label').textContent = 'New Download';

        // Save to history
        if (state.videoInfo) {
          addToHistory({
            url: state.url,
            title: state.videoInfo.title || 'Unknown',
            thumbnail: state.videoInfo.thumbnail || '',
            uploader: state.videoInfo.uploader || '',
            duration: state.videoInfo.duration || 0,
            ext: state.selectedFormatId?.includes('audio') ? 'mp3' : 'mp4',
            date: new Date().toISOString(),
          });
        }
      } else if (status === 'failed' || status === 'expired') {
        showError(status === 'failed' ? (state.lastError || 'Download failed.') : 'Download session expired. Please try again.');
      }
      state.isDownloading = false;
    }

    evtSource.onmessage = (e) => {
      clearTimeout(sseTimeout);
      sseTimeout = setTimeout(handleTimeout, 30000);

      try {
        const data = JSON.parse(e.data);
        state.lastError = data.error;

        if (data.status === 'downloading' || data.status === 'processing') {
          const pct = Math.round(data.progress || 0);
          el.progressBar.style.width = `${pct}%`;
          el.progressStatus.textContent = `${pct}%`;
          el.progressSpeed.textContent = data.speed ? data.speed : '—';
          el.progressEta.textContent = data.eta ? data.eta : '—';
          el.progressSize.textContent = data.totalSize ? data.totalSize : '—';
          if (data.status === 'processing') {
            el.progressTitle.textContent = 'Processing';
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
