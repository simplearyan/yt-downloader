/* ============================================================
   YouTube Downloader — download site
   Phase B: live releases from the GitHub API, with a 15-min
   localStorage cache and a committed releases.json snapshot
   as the offline/rate-limit fallback (docs/DOWNLOAD-SITE-PLAN.md §5).
   ============================================================ */
'use strict';

/* ---------- Theme toggle ---------- */
function initTheme() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
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

/* Point the hero + header download buttons at the latest .exe, so clicking
   them actually downloads the app. Falls back to scrolling to #downloads. */
function wireDownloadButtons(releases) {
  const latest = (releases || []).find((r) => (r.assets || []).some((a) => /\.exe$/i.test(a.name || '')));
  if (!latest) return;
  const exe = latest.assets.find((a) => /\.exe$/i.test(a.name || ''));
  const btns = [document.getElementById('heroDownload'), document.getElementById('headerDownload')];
  btns.forEach((b) => {
    if (b) b.setAttribute('href', exe.browser_download_url);
  });
}

/* ---------- Releases: data pipeline ----------

Data source: the same-origin `releases.json` snapshot. It is refreshed by CI
on every deploy and after every release (pages.yml + the build workflow), so
no runtime GitHub API call is needed — no rate limits, no cross-origin
requests, instant first paint. If the snapshot is unreachable, show the error
card with a direct link to GitHub Releases.
*/

async function fetchSnapshot() {
  const res = await fetch('./releases.json');
  if (!res.ok) throw new Error('snapshot ' + res.status);
  return res.json();
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


function renderRelease(r, isLatest) {
  const exe = (r.assets || []).find((a) => /\.exe$/i.test(a.name));
  const msi = (r.assets || []).find((a) => /\.msi$/i.test(a.name));
  const ver = escapeHtml(r.tag_name || r.name || '');
  const pill = isLatest
    ? '<span class="badge badge-success">Latest</span>'
    : r.prerelease
      ? '<span class="badge badge-accent">Beta</span>'
      : '';
  const ICON = (name) => `<svg class="lucide" aria-hidden="true"><use href="#lucide-${name}"></use></svg>`;
  const btns = [];
  if (exe) {
    btns.push(
      `<a class="btn btn-primary btn-download" href="${escapeHtml(exe.browser_download_url)}">
        ${ICON('download')}
        .exe installer
      </a>`
    );
  }
  if (msi) {
    btns.push(`<a class="btn btn-ghost btn-download" href="${escapeHtml(msi.browser_download_url)}">${ICON('package')}.msi package</a>`);
  }
  const noAssets = btns.length === 0
    ? '<p class="release-empty">No Windows installer attached to this release.</p>'
    : '';

  return `
    <article class="card release-card${isLatest ? ' latest' : ''}">
      <div class="release-head">
        <span class="release-version">${ver}</span>
        ${pill}
        <span class="release-date">${formatDate(r.published_at)}</span>
      </div>
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

  wireDownloadButtons(list); // hero + header CTAs download the latest .exe
}

function renderError() {
  const el = document.getElementById('releases');
  if (!el) return;
  el.innerHTML =
    '<div class="card release-card"><div class="release-head"><span class="release-version">Releases unavailable</span></div>' +
    '<p class="release-empty">Could not load the latest releases right now. Check <a href="https://github.com/simplearyan/yt-downloader/releases" target="_blank" rel="noopener">GitHub Releases</a> directly.</p></div>';
}

async function initReleases() {
  const el = document.getElementById('releases');
  if (!el) return;
  // Render instantly from the snapshot inlined in the page (no flicker),
  // then quietly re-fetch in the background in case it went stale.
  try {
    const inline = document.getElementById('releases-data');
    if (inline && inline.textContent.trim()) {
      renderReleases(JSON.parse(inline.textContent));
    }
    const snap = await fetchSnapshot();
    renderReleases(snap);
  } catch (e) {
    renderError();
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
