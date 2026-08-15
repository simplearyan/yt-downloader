# Download Site Plan — `yt-downloader` marketing + release hub

A clean, responsive marketing site for the YouTube Downloader project, deployed to
**https://simplearyan.github.io/yt-downloader/** via GitHub Actions, with a
CapCut-inspired design (light/dark), direct downloads of every released version,
and auto-updating release lists pulled from the GitHub API.

---

## 1. Goal & scope

Turn the project into something shareable: a visitor lands on the site, reads a
short pitch, and downloads the Windows installer for the latest — or any — version.
No repo code changes beyond adding a new `site/` folder and one workflow.

**In scope:** static marketing site (pure HTML/CSS/JS, zero build step), light/dark
mode, responsive layout, version browser with direct `.exe`/`.msi` links, live
release data from the GitHub API, auto-deploy on push.

**Out of scope (for now):** in-browser downloader, analytics, i18n, code signing
(it's documented separately in [AZURE-CODE-SIGNING.md](./AZURE-CODE-SIGNING.md)).

---

## 2. Hosting & URL

- **URL:** `https://simplearyan.github.io/yt-downloader/` — a GitHub **project page**
  served from this same repo (`simplearyan/yt-downloader`), so no new repo needed.
- **Folder:** new top-level **`site/`** — deliberately separate from `public/`
  (the app UI) and `docs/` (the plans), so the marketing site never mixes with app code.
- **Pages source:** *Settings → Pages → Source: GitHub Actions* (not a branch) —
  the deploy workflow owns publishing.
- **Base path caveat:** project pages live under `/yt-downloader/`. Use **relative
  paths only** (`./style.css`, `./assets/...`) — no absolute `/style.css` — or every
  asset 404s. Pure static = no build config needed.

---

## 3. Design — CapCut-inspired

| Token | Light | Dark |
|---|---|---|
| Background | `#F7F7F9` | `#0E0E10` |
| Card | `#FFFFFF`, 1px `#E9E9EE` border | `#17171A`, 1px `#26262B` border |
| Text | `#1A1A1E` | `#F2F2F4` |
| Muted text | `#6B6B74` | `#9B9BA4` |
| Accent (CapCut violet) | `#6C4DF6` | `#8B6FFB` |
| Accent gradient | `#6C4DF6 → #9B6CFF` | same |
| Radius / shadow | 14–16px cards, soft `0 8px 24px rgba(0,0,0,.06)` | softer, lower alpha |
| Font | **Inter** (system fallback stack) | same |

**Light/dark mode:** CSS custom properties + `prefers-color-scheme` as the default,
plus a header **🌙/☀️ toggle** that overrides and persists in `localStorage`
(`data-theme` attribute on `<html>`). No flash on load — set the attribute from
storage in a tiny inline `<script>` in `<head>`.

**Layout personality:** bold display headline with tight tracking, pill buttons,
gradient primary CTA, rounded cards with subtle borders, small motion (fade-up on
scroll, hover lift), generous whitespace — the CapCut "clean studio" feel.

---

## 4. Site structure

Single-page site, scroll sections (no router needed):

1. **Header** — logo mark + name, theme toggle, "Download" CTA button. Sticky,
   blur backdrop.
2. **Hero** — headline ("Download YouTube videos the reliable way"), one-liner
   (original streams, perfect seeking), **Download for Windows** gradient button,
   live version badge (`Latest · v0.1.1-beta`), small OS/prereq line.
3. **Features** — 3–4 icon cards: *Original quality* (no re-encode), *Editor-friendly*
   (perfect seek tables), *Free & open source*, *Playlists & formats*.
4. **Downloads** — the core section (see §5).
5. **How it works** — 3 steps: install, paste link, download (with SmartScreen note).
6. **FAQ** — accordion: SmartScreen warning, requirements, is it free, why not web
   downloaders.
7. **Footer** — repo link, license, "built with yt-dlp".

**Responsive:** mobile-first — hero stacks, feature grid 1→2→4 cols, downloads cards
1 col → 2 cols, nav collapses to a simple stacked header (no hamburger needed at
this size, but keep the design ready for one).

---

## 5. Downloads section (the core)

**Data source — GitHub Releases API (public, CORS-enabled):**

```
GET https://api.github.com/repos/simplearyan/yt-downloader/releases?per_page=20
```

Each release → a **version card**:

| Release field | Rendered as |
|---|---|
| `tag_name` | Version chip (`v0.1.1-beta`) |
| `published_at` | Date (localized) |
| `prerelease` | **Beta** pill (violet) vs **Latest** pill (green) |
| `assets[].browser_download_url` | **.exe** button (primary, "Recommended") + **.msi** button (secondary) |
| `body` | Release notes (lightweight markdown renderer: headings, bullets, links, code — sanitized) |

**Direct download links:** asset URLs are permanent GitHub URLs
(`github.com/.../releases/download/<tag>/<file>`), so buttons link straight to the
file — no redirects, no token.

**Sorting:** newest first. The **"Latest release" card** sits on top (big layout);
the rest collapse into an **"All versions"** accordion (each row: version, date,
beta pill, exe/msi icon buttons).

**Auto-update:** on page load, fetch the API. New tags show up automatically on the
next visit. Cache the response in `localStorage` with a **15-min TTL** so repeat
visits don't re-hit the API.

**Rate limit / fallback (important):** unauthenticated API = **60 req/hr per IP**.
With caching that's fine for a marketing site, but plan a graceful degraded state:
an **`site/releases.json` snapshot** committed by the deploy workflow (see §7) that
the page uses first, then silently refreshes from the API when reachable. Empty/error
state shows a friendly "releases unavailable" card instead of a broken section.

---

## 6. Files (all new, under `site/`)

```
site/
├── index.html          # single page, all sections, inline theme script in <head>
├── style.css           # tokens, light/dark, responsive, components
├── app.js              # theme toggle, release fetch + render, FAQ accordion
├── releases.json       # committed snapshot (regenerated by workflow, §7)
└── assets/
    ├── logo.svg        # app icon reused (src-tauri/icons has sources)
    ├── og-image.png    # 1200×630 social card (nice fonts, brand color)
    └── favicon.svg
```

No framework, no bundler, no npm — plain static files keep the Pages deploy trivial
and the site fast (the whole thing should be < 100 KB).

---

## 7. Deploy workflow — `.github/workflows/pages.yml`

Triggers on pushes to `main` touching `site/**` (or the workflow file), plus manual
dispatch. Reuses the **official Pages actions** (node24-era, matches the action
bumps already applied to the build workflow):

```yaml
name: Deploy site to GitHub Pages

on:
  push:
    branches: [main]
    paths: ["site/**", ".github/workflows/pages.yml"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # Refresh the committed release snapshot from the API
      - name: Fetch latest releases snapshot
        env:
          GH_TOKEN: ${{ github.token }}   # repo-scoped token, no rate limit
        run: |
          curl -s -H "Authorization: Bearer $GH_TOKEN" \
            "https://api.github.com/repos/simplearyan/yt-downloader/releases?per_page=20" \
            -o site/releases.json

      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

Notes:
- `github.token` is repo-scoped → **no API rate limit** on the snapshot, and it's
  refreshed on every deploy.
- Pages source must be set once in repo settings to **"GitHub Actions"**.
- The snapshot step runs even when only `site/**` changed; on a pure `v*`-tag push
  nothing redeploys — but the next `main` push picks up the new release. (Optional
  upgrade: also trigger the site deploy on `v*` tags for instant updates.)
- Coexists cleanly with `build-tauri.yml` (that one only fires on tags).

---

## 8. Phases

| Phase | What | Est. |
|---|---|---|
| **A — Scaffold** | `site/` skeleton: index.html + style.css tokens + theme toggle + responsive layout, all sections with static placeholder download cards | ~1 session |
| **B — Live data** | `app.js` release fetch, cache + TTL, version cards, exe/msi buttons, release-notes renderer, empty/error states | ~1 session |
| **C — Deploy** | `pages.yml` + snapshot refresh, set Pages source, first deploy, verify URL + both themes + mobile | ~30 min |
| **D — Polish** | og-image + meta (link-preview card, the WhatsApp 1200×630 spec from earlier), favicon, FAQ copy, final Lighthouse check | ~1 session |

---

## 9. Verification

- Serve `site/` locally (`npx serve site` or any static server) → check layout,
  both themes, accordion, downloads render with live API data.
- DevTools responsive mode: 360px / 768px / 1280px.
- Deploy → confirm `https://simplearyan.github.io/yt-downloader/` loads, theme
  toggle persists across reloads, download buttons hit the real release assets.
- Confirm no mixed content (all https) and run Lighthouse (target 95+ perf/accessibility).

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| GitHub API rate limit (60/hr/IP) | `releases.json` snapshot via `github.token` + 15-min localStorage cache + degraded UI |
| Project-page base path (`/yt-downloader/`) breaks assets | Relative paths only; verify on first deploy |
| Old releases lose assets | Filter to releases that actually have `.exe`/`.msi`; skip empty ones |
| SmartScreen confusion | Prominent FAQ entry + code-signing doc link |
| Brand/name clarity | Keep site name "YouTube Downloader", not StudioPro — separate projects |
| Unsigned installer complaints | "Beta" pill on pre-release versions; note that signing is planned |

---

### Related docs

- [RELEASE-WORKFLOW-PLAN.md](./RELEASE-WORKFLOW-PLAN.md) — how installers get built (feeds this site's releases)
- [AZURE-CODE-SIGNING.md](./AZURE-CODE-SIGNING.md) — SmartScreen fix (the site's #1 FAQ)
- [TAURI-APP-PLAN.md](./TAURI-APP-PLAN.md) — desktop app roadmap
