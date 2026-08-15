/* ============================================================
   YouTube Downloader — download site
   Phase B: live releases from the GitHub API, with a 15-min
   localStorage cache and a committed releases.json snapshot
   as the offline/rate-limit fallback (docs/DOWNLOAD-SITE-PLAN.md §5).
   ============================================================ */
'use strict';

/* ---------- Theme toggle ---------- */

const SUN_ICON =
  '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON_ICON =
  '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function initTheme() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.innerHTML = SUN_ICON + MOON_ICON;
  const apply = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ytdl-theme', theme); } catch (e) {}
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  };
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
  });
}

/* ---------- Releases: data pipeline ---------- */

const API_URL = 'https://api.github.com/repos/simplearyan/yt-downloader/releases?per_page=20';
const CACHE_KEY = 'ytdl-releases';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.releases) || Date.now() - data.fetchedAt > CACHE_TTL_MS) return null;
    return data.releases;
  } catch (e) {
    return null;
  }
}

function writeCache(releases) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), releases }));
  } catch (e) { /* storage full / unavailable — ignore */ }
}

async function fetchFromApi() {
  const res = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error('api ' + res.status);
  return res.json();
}

async function fetchSnapshot() {
  const res = await fetch('./releases.json');
  if (!res.ok) throw new Error('snapshot ' + res.status);
  return res.json();
}

/* Refresh in the background when we already have data to show.
   Failures are silent — the visible data stays. */
async function refreshQuietly() {
  try {
    const live = await fetchFromApi();
    writeCache(live);
    renderReleases(live);
  } catch (e) { /* keep what we have */ }
}

/* ---------- Releases: rendering ---------- */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) {
    return iso || '';
  }
}

/* Tiny markdown-lite for release notes: bullets, bold, inline code. Safe (escaped first). */
function renderNotes(body) {
  if (!body) return '';
  const lines = escapeHtml(body)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const items = lines.map((l) => {
    if (/^[-*•]\s+/.test(l)) return '<li>' + l.replace(/^[-*•]\s+/, '') + '</li>';
    if (/^#+\s+/.test(l)) return '<li><strong>' + l.replace(/^#+\s+/, '') + '</strong></li>';
    return '<li>' + l + '</li>';
  });
  return '<ul>' + items.join('') + '</ul>';
}

function renderRelease(r, isLatest) {
  const exe = (r.assets || []).find((a) => /\.exe$/i.test(a.name));
  const msi = (r.assets || []).find((a) => /\.msi$/i.test(a.name));
  const ver = escapeHtml(r.tag_name || r.name || '');
  const pill = isLatest
    ? '<span class="badge badge-success">Latest</span>'
    : r.prerelease
      ? '<span class="badge badge-accent">Beta</span>'
      : '';
  const btns = [];
  if (exe) {
    btns.push(
      `<a class="btn btn-primary btn-download" href="${escapeHtml(exe.browser_download_url)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
        .exe installer
      </a>`
    );
  }
  if (msi) {
    btns.push(`<a class="btn btn-ghost btn-download" href="${escapeHtml(msi.browser_download_url)}">.msi package</a>`);
  }
  const noAssets = btns.length === 0
    ? '<p class="release-notes">No Windows installer attached to this release.</p>'
    : '';

  return `
    <article class="card release-card${isLatest ? ' latest' : ''}">
      <div class="release-head">
        <span class="release-version">${ver}</span>
        ${pill}
        <span class="release-date">${formatDate(r.published_at)}</span>
      </div>
      <div class="release-notes">${renderNotes(r.body)}</div>
      ${noAssets}
      <div class="release-actions">${btns.join('')}</div>
    </article>`;
}

function withWindowsAssets(releases) {
  return (releases || []).filter((r) =>
    (r.assets || []).some((a) => /\.(exe|msi)$/i.test(a.name || ''))
  );
}

function renderReleases(releases) {
  const el = document.getElementById('releases');
  if (!el) return;
  const list = withWindowsAssets(releases);
  if (list.length === 0) return;
  el.innerHTML = list.map((r, i) => renderRelease(r, i === 0)).join('');

  const badge = document.getElementById('latestBadge');
  if (badge) badge.textContent = 'Latest · ' + list[0].tag_name;
}

function renderError() {
  const el = document.getElementById('releases');
  if (!el) return;
  el.innerHTML =
    '<div class="card release-card"><div class="release-head"><span class="release-version">Releases unavailable</span></div>' +
    '<p class="release-notes">Could not load the latest releases right now. Check <a href="https://github.com/simplearyan/yt-downloader/releases" target="_blank" rel="noopener">GitHub Releases</a> directly.</p></div>';
}

async function initReleases() {
  const el = document.getElementById('releases');
  if (!el) return;

  // 1) Fresh cache → paint instantly, then refresh quietly in the background
  const cached = readCache();
  if (cached && cached.length) {
    renderReleases(cached);
    refreshQuietly();
    return;
  }

  // 2) No cache → live API (then cache it)
  try {
    const live = await fetchFromApi();
    writeCache(live);
    renderReleases(live);
    return;
  } catch (apiErr) {
    // 3) API unreachable (offline / rate-limited) → committed snapshot
    try {
      const snap = await fetchSnapshot();
      renderReleases(snap);
    } catch (snapErr) {
      renderError();
    }
  }
}

/* ---------- FAQ (native <details>; close others for accordion feel) ---------- */
function initFaq() {
  document.querySelectorAll('.faq-item').forEach((d) => {
    d.querySelector('summary').addEventListener('click', () => {
      document.querySelectorAll('.faq-item[open]').forEach((other) => {
        if (other !== d) other.removeAttribute('open');
      });
    });
  });
}

/* ---------- Footer year ---------- */
function initYear() {
  const y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
}

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initReleases();
  initFaq();
  initYear();
});
