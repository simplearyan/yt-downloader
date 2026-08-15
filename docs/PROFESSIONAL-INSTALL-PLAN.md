# Professional Install Plan — killing the SmartScreen warning

**Problem:** every release so far (v0.1.0-beta, v0.1.1-beta) installs with the red
*"Windows protected your PC — Unknown publisher"* dialog. Users have to click
**More info → Run anyway**, which reads as sketchy even though the app is fine.

**Root cause:** the installer has **no code-signing signature**. Windows treats any
unsigned executable from an unknown publisher as unrecognized and blocks it.

**Goal:** users install with zero scary dialogs — the way VS Code, Discord, or any
"real" app installs.

---

## How professional apps actually avoid the warning

There are exactly three levers, in order of leverage:

| Lever | What it does | Cost |
|---|---|---|
| **1. Code-sign the binary** (Authenticode) | Turns *"Unknown publisher"* into *"Publisher: Your Name"*; the full red block shrinks to a small "More info" notice | Free (Azure) – paid (cert) |
| **2. Distribute through a trusted channel** (Microsoft Store / MSIX) | Windows trusts the channel itself → **zero warnings**, plus auto-updates and Settings-uninstall | $19 one-time |
| **3. Reputation** (install volume) | SmartScreen gradually trusts signed apps that get installed — happens passively over time | Free |

No other fix exists for an unsigned app — there is no "disable the warning" switch.

---

## Tier 1 — Azure Artifact Signing (do this first, free, ~1 hour)

Microsoft's cloud code-signing service. The workflow already contains the signing
steps — they only need the six `AZURE_*` secrets to exist. Full walkthrough:
**[AZURE-CODE-SIGNING.md](./AZURE-CODE-SIGNING.md)**.

**What changes for the user after Tier 1:**

| | Before (now) | After Tier 1 |
|---|---|---|
| Dialog | Full red block, *"Unknown publisher"* | Small blue "More info" notice, *"Publisher: Aryan"* |
| Install path | More info → Run anyway | One click (or just *More info* once, then it's remembered for the file) |
| Duration | Forever | Reduced warning only until reputation builds (weeks of downloads) |

**Honest caveat:** a brand-new non-EV certificate still shows a *reduced* warning
until enough people install the app (SmartScreen reputation). It fades with each
install. The scary part — "Unknown publisher" — is gone immediately.

---

## Tier 2 — Microsoft Store (the true "professional" endgame)

Package the app as **MSIX** and publish it to the **Microsoft Store**:

1. **Package**: Tauri v2 can bundle MSIX/AppX on Windows (`tauri build` with the
   `appx` bundle target — needs the Windows App SDK tools on the build machine).
2. **Account**: one-time **$19** individual Microsoft Store developer account.
3. **Submit**: upload the MSIX to Partner Center → passes certification → the app
   appears in the Store with a proper listing page.

**Result — the gold standard:**
- **Zero SmartScreen warnings** — Windows trusts the Store channel outright
- **Auto-updates** — Store updates the app silently
- **Professional credibility** — install/uninstall from *Settings*, a Store listing,
  ratings
- The GitHub Releases installers can remain for power users, but the Store becomes
  the recommended path

**Free alternative to the Store:** publish a manifest to the **winget community
repository** so `winget install youtube-downloader` works. Nice convenience, but it
does *not* remove the SmartScreen warning on its own (the file still needs a
signature) — so do it after Tier 1, as an add-on.

---

## Tier 3 — EV certificate (only when distribution justifies it)

An **EV code-signing cert** (DigiCert/Sectigo, ~$200–500/yr) gets **instant**
SmartScreen trust — no reputation waiting period. Overkill for this project's
current scale; revisit if downloads grow substantially. Azure signing (Tier 1) is
"good enough" and free.

---

## Supporting upgrades that make it feel professional

- **Auto-updater in the app** — `tauri-plugin-updater` pointed at the GitHub
  Releases (the updater signature uses a key you generate; sign the installers with
  the same key/cert once Tier 1 is live). Users get updates in-app instead of
  re-downloading from the site. This is the biggest "feels pro" win after signing.
- **Clear install guidance on the download site** (from
  [DOWNLOAD-SITE-PLAN.md](./DOWNLOAD-SITE-PLAN.md)): the FAQ already covers the
  SmartScreen note; once signing is live the note flips to "Publisher verified".
- **App icon + version metadata** — already in place (`app-icon.svg` → full icon set).
- **Release notes inside the app** — a small changelog screen fed from the release
  body on update.

---

## Recommended roadmap

| Phase | What | Warning after | Cost | Effort |
|---|---|---|---|---|
| **1** | Configure Azure secrets → next tag build is signed | Reduced "More info" (fades with installs) | Free | ~1 hr (once) |
| **2** | `tauri-plugin-updater` auto-update using signed releases | same | Free | ½–1 day |
| **3** | MSIX bundle + Microsoft Store submission | **None** | $19 (once) | 1–2 days |
| **4** | winget community manifest + (optional) EV cert | None (or instant) | $0 / $200–500/yr | hours |

**Immediate relief while unsigned** (no code change needed):
- The release body and the future download site already tell users to click
  *More info → Run anyway* — keep that copy prominent.
- The .exe path in the user's screenshot shows the same dialog; instructions are
  identical.

---

## Acceptance criteria ("installs like a professional app")

- [ ] Fresh Windows 10/11 machine: download → install → app opens, **no red block**
- [ ] Publisher name visible in the file's Properties → Digital Signatures
- [ ] App updates itself without a manual re-download
- [ ] (Store path) Install/uninstall from Windows Settings; Store listing live

---

### Related docs

- [AZURE-CODE-SIGNING.md](./AZURE-CODE-SIGNING.md) — Tier 1 step-by-step (portal + secrets)
- [RELEASE-WORKFLOW-PLAN.md](./RELEASE-WORKFLOW-PLAN.md) — how installers get built
- [DOWNLOAD-SITE-PLAN.md](./DOWNLOAD-SITE-PLAN.md) — the site that explains installs to users
- [TAURI-APP-PLAN.md](./TAURI-APP-PLAN.md) — desktop app roadmap (updater lives here)
