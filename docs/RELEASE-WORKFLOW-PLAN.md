# Windows Release Workflow Plan — GitHub Actions

> **Goal:** build the Tauri app into a Windows installer (NSIS `.exe` + MSI)
> on GitHub Actions, attach it to a **GitHub Release** so anyone can download
> and install — with **two ways to trigger** it:
>
> 1. **Auto** — pushing a version tag (`v1.0.0`) builds and releases.
> 2. **Manual** — from the Actions tab, pick *latest commit* (default branch)
>    or any git tag / branch / SHA and build on demand.
>
> Implemented in `.github/workflows/build-tauri.yml`.

---

## 1. Triggers

### Auto: on tag push
```yaml
on:
  push:
    tags: ["v*"]
```
Pushing `v0.9.0-alpha`, `v1.0.0`, `v1.1.0-beta` … triggers a build and
attaches the installer to a release named after that tag.

### Manual: `workflow_dispatch`
From **Actions → Build Windows Installer → Run workflow**:

| Input | Meaning | Default |
|---|---|---|
| `ref` | Git ref to build — a **tag** (`v1.0.0`), **branch** (`main`), or commit **SHA**. Leave empty for the **latest commit** on `main`. | *(empty = latest main)* |
| `create_release` | Also create/attach a GitHub Release for this build | `true` |

So "build latest commit" = run the workflow with `ref` empty, and
"build a tag" = run it with `ref: v1.0.0` (works even before the tag is
pushed, or to re-release an older tag).

---

## 2. What the workflow does

```
workflow starts (tag push OR manual dispatch)
  │
  ├─ 1. checkout the resolved ref (empty → default branch = latest commit)
  │
  ├─ 2. Sync version from the tag, if any
  │        v0.9.0-alpha  →  version "0.9.0" in tauri.conf.json + Cargo.toml
  │        v1.0.0        →  version "1.0.0"
  │        latest commit →  keep existing version (0.9.0-alpha)
  │
  ├─ 3. Install Rust (dtolnay/rust-toolchain) + cargo cache
  │
  ├─ 4. Setup Node 20, `npm install` (CLI from devDependencies)
  │
  ├─ 5. `npm run tauri:build`
  │        → NSIS installer + MSI in src-tauri/target/release/bundle/
  │
  ├─ 6. Upload both as a workflow Artifact (always)
  │
  └─ 7. Attach to a GitHub Release (tag push, or manual + create_release)
          → Release page shows the installer for one-click download
```

**Release naming rules**

| Trigger | Ref | Release tag | Pre-release? |
|---|---|---|---|
| Tag push | `v1.0.0` | `v1.0.0` | no (yes if `-alpha/-beta`) |
| Manual | `v0.9.0-alpha` | `v0.9.0-alpha` | yes |
| Manual | *(empty / branch / SHA)* | `build-<short-sha>` | yes |

Re-running a build for the same tag **updates** the existing release
(`update_release_body`) instead of failing — the installer gets replaced.

---

## 3. Version sync (why)

`tauri.conf.json` currently hardcodes `0.9.0-alpha`. The Windows installer
and MSI read that version, so a `v1.0.0` tag must produce a `1.0.0`
installer, not an `0.9.0-alpha` one. A small Python step rewrites
`version` in `src-tauri/tauri.conf.json` **and** `src-tauri/Cargo.toml`
from the tag name (stripping the leading `v` and any `-suffix` so MSI
gets a clean numeric `X.Y.Z`).

> Note: `package-lock.json` is gitignored in this repo, so CI uses
> `npm install` (resolves from `package.json` at build time). If you want
> fully reproducible installs, start tracking the lockfile later.

---

## 4. Permissions & security

- The workflow requests **`contents: write`** — the minimum needed to
  create releases and attach files.
- The **release token** (`GITHUB_TOKEN`) is scoped to this repo only and
  auto-expires; it cannot touch other repos.
- Downloads are served by GitHub Releases (HTTPS). No secrets required for
  an unsigned build.

---

## 5. End-user install experience

1. Open the repo's **Releases** page (or the badge in the README).
2. Click the `.exe` under the latest release → downloads the NSIS installer.
3. Run it → installs "YouTube Downloader" to the Start Menu / desktop.
4. First launch: SmartScreen may warn "Windows protected your PC" because
   the build is **unsigned** — click **More info → Run anyway** (standard
   for personal projects; a code-signing cert removes this later).
5. The app checks for `yt-dlp` / `ffmpeg` (Phase 1) and downloads videos
   without Node or a dev server.

MSI is also attached for users who prefer it (or need silent installs:
`msiexec /i YouTube-Downloader_1.0.0_x64.msi`).

---

## 6. How the maintainer ships a new version

```bash
# 1. bump the version tag (auto-builds + releases)
git tag v1.0.0
git push origin v1.0.0

# 2. (optional) build the latest commit right now without a tag:
#    Actions → Build Windows Installer → Run workflow (ref empty)
```

The whole flow takes ~4–6 min (Rust release build from cache).

---

## 7. Roadmap (after this works)

- [ ] **Code signing** — add a certificate secret (`CERT_PFX` + password)
      and sign the NSIS installer so SmartScreen stops warning.
- [ ] **Auto-updater** — `tauri-plugin-updater` + a static JSON on GitHub
      Pages so installed users get new versions in-app.
- [ ] **Build badge** in the README (`badge.fury.io`-style status shield).
- [ ] **macOS / Linux builds** — add `macos-latest` / `ubuntu-latest` to a
      build matrix (same workflow, extra bundles).
- [ ] **Pin the lockfile** (stop gitignoring `package-lock.json`) for
      reproducible `npm install` in CI.
