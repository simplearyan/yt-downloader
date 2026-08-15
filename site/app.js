/* ============================================================
   YouTube Downloader — download site
   Phase A: theme toggle + release rendering from placeholder data.
   Phase B: replace getReleases() below with the GitHub API fetch
   (see docs/DOWNLOAD-SITE-PLAN.md §5).
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

/* ---------- Releases ---------- */

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
      `<a class="btn btn-primary btn-download" href="${escapeHtml(exe.browser_download_url)}" download>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
        .exe installer
      </a>`
    );
  }
  if (msi) {
    btns.push(`<a class="btn btn-ghost btn-download" href="${escapeHtml(msi.browser_download_url)}" download>.msi package</a>`);
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

/* Phase B: replace this function with a fetch of
   https://api.github.com/repos/simplearyan/yt-downloader/releases?per_page=20
   plus the localStorage 15-min cache and releases.json fallback. */
async function getReleases() {
  return [
    {
      tag_name: 'v0.1.1-beta',
      published_at: '2026-08-15T02:14:59Z',
      prerelease: true,
      body: '**CI hardening + optional code signing**\n- Actions bumped to node24 majors (checkout/setup-node/upload-artifact v7, action-gh-release v3); build node 20 → 22\n- Conditional Azure Artifact Signing steps added — builds stay unsigned until the `AZURE_*` secrets are configured',
      assets: [
        { name: 'YouTube.Downloader_0.1.1_x64-setup.exe', browser_download_url: 'https://github.com/simplearyan/yt-downloader/releases/download/v0.1.1-beta/YouTube.Downloader_0.1.1_x64-setup.exe' },
        { name: 'YouTube.Downloader_0.1.1_x64_en-US.msi', browser_download_url: 'https://github.com/simplearyan/yt-downloader/releases/download/v0.1.1-beta/YouTube.Downloader_0.1.1_x64_en-US.msi' }
      ]
    },
    {
      tag_name: 'v0.1.0-beta',
      published_at: '2026-08-15T01:52:22Z',
      prerelease: true,
      body: '**First Tauri desktop beta**\n- Tauri v2 shell reusing the site UI\n- NSIS + MSI installers built by CI',
      assets: [
        { name: 'YouTube.Downloader_0.1.0_x64-setup.exe', browser_download_url: 'https://github.com/simplearyan/yt-downloader/releases/download/v0.1.0-beta/YouTube.Downloader_0.1.0_x64-setup.exe' },
        { name: 'YouTube.Downloader_0.1.0_x64_en-US.msi', browser_download_url: 'https://github.com/simplearyan/yt-downloader/releases/download/v0.1.0-beta/YouTube.Downloader_0.1.0_x64_en-US.msi' }
      ]
    }
  ];
}

async function initReleases() {
  const el = document.getElementById('releases');
  if (!el) return;
  try {
    const releases = await getReleases();
    const withAssets = releases.filter((r) => (r.assets || []).some((a) => /\.(exe|msi)$/i.test(a.name)));
    if (withAssets.length === 0) throw new Error('empty');
    const html = withAssets
      .map((r, i) => renderRelease(r, i === 0))
      .join('');
    el.innerHTML = html;

    const badge = document.getElementById('latestBadge');
    if (badge && withAssets[0]) badge.textContent = 'Latest · ' + withAssets[0].tag_name;
  } catch (e) {
    el.innerHTML =
      '<div class="card release-card"><div class="release-head"><span class="release-version">Releases unavailable</span></div>' +
      '<p class="release-notes">Could not load the latest releases right now. Check <a href="https://github.com/simplearyan/yt-downloader/releases" target="_blank" rel="noopener">GitHub Releases</a> directly.</p></div>';
  }
}

/* ---------- FAQ (native <details> needs no JS; just focus polish) ---------- */
function initFaq() {
  document.querySelectorAll('.faq-item').forEach((d) => {
    d.querySelector('summary').addEventListener('click', () => {
      // Close others for a clean accordion feel
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
