# Update Modal — Wrong Version Fix Plan

**Date:** 2026-08-15
**Status:** Analysis done — awaiting go-ahead

---

## 1. The bug

In the installed app (e.g. v0.2.0-beta), the Check-for-updates modal showed:

```
Update available
0.9.0-alpha  →  0.2.0-beta
```

Two problems produce this:

1. **`APP_VERSION` is hardcoded in `public/app.js` as `'0.9.0-alpha'`** — the
   internal dev version. It is never synced to the shipped release. The CI
   workflow ("Sync version from tag") updates `tauri.conf.json` and
   `Cargo.toml` from the tag, but **never the frontend** — so the "current
   version" pill always shows the stale dev value no matter what release is
   installed.

2. **The comparison is a string-inequality check**, not a version comparison:

   ```js
   const available = !!(latestV && latestV !== curV);
   ```

   Any difference counts as "update available" — even a **downgrade**
   (0.9.0 > 0.2.0, yet it offered 0.2.0-beta as the "new" version). There is
   no semver ordering, so the modal happily presents an older version as an
   upgrade.

Desired behavior (per user):

- **No update available** → show "No update / You're up to date" **with the
  current version**.
- **Update available** → show the **correct current → new** pair.

---

## 2. Fix plan

### Phase 1 — Real current version at build time
- The frontend reads its version from `window.YTDL_VERSION` (a tiny generated
  `public/version.js`: `window.YTDL_VERSION = '0.2.1-beta'`), falling back to a
  dev constant when the file is absent (local web app / `tauri dev`).
- **CI**: extend the existing "Sync version from tag" step to also write
  `public/version.js` with the full tag name (minus the leading `v`), e.g.
  `v0.2.1-beta` → `0.2.1-beta`. Runs before `tauri build`, so the file is
  bundled into the installer.
- `.gitignore`: `public/version.js` (generated artifact, same as
  `src-tauri/backend/`).

### Phase 2 — Correct semver-ish comparison
- Add `parseVersion` / `compareVersions` helpers: numeric `MAJOR.MINOR.PATCH`
  comparison first; if equal, a release (no prerelease) beats a prerelease, and
  prereleases compare by label (e.g. `beta` > `alpha`).
- `available = compareVersions(latestV, curV) > 0` — **strictly newer only**.
  A downgrade or identical version never shows "Update available".
- The dot indicator reuses the same `available` value, so it inherits the fix.

### Phase 3 — Modal behavior
- **available**: pills `[current] → [new]` with the correct values (both
  already rendered from `APP_VERSION` + `tag_name` — they just become correct).
- **up to date**: "You're up to date" + `v{APP_VERSION} is the latest available
  version.` (already implemented — becomes correct).
- **Dev / source mode** (no `version.js`): skip the silent dot check; the manual
  check shows the up-to-date state labelled as a dev build (no false "update").

---

## 3. Acceptance criteria

- Installed v0.2.1-beta, latest v0.2.1-beta → modal shows "You're up to date",
  `v0.2.1-beta is the latest`.
- Installed v0.2.0-beta, latest v0.2.1-beta → modal shows
  `0.2.0-beta → 0.2.1-beta`, "Update available".
- Installed v0.2.1-beta with NO newer release → no "update" ever (no downgrade
  offers), no dot.
- Local `npm start` / `tauri dev` unchanged (fallback version, no dot).

---

## 4. Files touched

| File | Change |
|---|---|
| `public/app.js` | `window.YTDL_VERSION` read, semver helpers, strict `> 0` check, dev-mode guard |
| `.github/workflows/build-tauri.yml` | write `public/version.js` in "Sync version from tag" |
| `.gitignore` | ignore `public/version.js` |
| `public/version.js` | generated in CI (not committed) |
