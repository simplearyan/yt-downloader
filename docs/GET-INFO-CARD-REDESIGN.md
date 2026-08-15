# Get Info Card — Clean Redesign Plan

Goal: strip the search card down to a single clean search input — CapCut-style —
removing everything that adds visual noise but no value.

## Current state (what the card contains today)

```
┌────────────────────────────────────────────┐  ← .card.url-card (bordered, shadowed)
│                                            │
│  🔗  Paste a YouTube URL        [🔍 Get Info] │  ← .input-wrapper pill
│                                            │
│  Supports youtube.com · youtu.be · shorts · playlists  ← .input-hint
│                                            │
└────────────────────────────────────────────┘
```

Audit of every piece:

| Piece | Purpose | Verdict |
|---|---|---|
| `.card.url-card` shell | bordered card + elevation | **Remove** — the page background is already a clean surface; the card is redundant framing around a single input |
| `.card-content` padding | spacing inside card | **Remove** with the card |
| `.input-wrapper` pill | the search capsule | **Keep** (this IS the design) |
| link icon (`.input-icon`) | "paste a link" affordance | **Remove** — redundant with the button icon; the placeholder already says "Paste a YouTube URL" |
| `#urlInput` | the input | **Keep** |
| `#fetchBtn` (search icon + "Get Info") | primary action | **Keep**, but simplify label (see below) |
| `.input-hint` ("Supports youtube.com…") | lists supported URL types | **Remove** from the card — the app already handles all of these silently; if kept, it belongs in a subtle tooltip/placeholder, not a permanent line under the input |
| `.search-history` dropdown | recent/filtered URLs | **Keep** (functional, appears on demand) |

## Target design

```
┌──────────────────────────────────────────────────┐
│  🔍  Paste a YouTube URL              [Get Info →] │   ← single pill, directly on page bg
└──────────────────────────────────────────────────┘
```

- No card, no border box — just the pill sitting on the page background
  (which in dark mode is already `#121216`).
- Pill: full-width, 54px, fully rounded, layered surface (one step above the
  background), violet border + soft ring on focus.
- Search icon **on the left** (inside the pill), violet.
- Button **inside the right** of the pill, violet, with a short label.
- Hint line deleted.

## Plan

### 1. Markup (`public/index.html`)
- Delete the `<section class="card url-card">` wrapper; keep the pill directly in
  the `.container` as `<div class="url-card">` (id stays for JS).
- Remove the `.card-content` wrapper (or keep a minimal one for padding).
- Remove the `.input-icon` (link icon) from inside the pill.
- Swap the button's icon from the link/search double-up: keep **one** search icon
  on the left of the input, and make the button **text-only** ("Get Info") or
  keep the icon + drop the label — pick per the visual check (recommended:
  icon-on-left + text-only button).
- Remove the `.input-hint` line entirely.
- Keep `#searchHistory` (positioned under the pill).

### 2. Styles (`public/style.css`)
- `.url-card` — becomes a plain block (`overflow: visible;` retained for the
  dropdown), `margin: 0 auto`, `max-width: 560px` so the pill doesn't stretch
  awkwardly on huge windows.
- `.input-wrapper` — keep the pill look; reduce top/bottom padding slightly
  since the card frame is gone (54px → ~52px is fine).
- Keep `:focus-within` violet ring — that's the primary visual feedback now.
- Delete the now-dead `.url-card .card-content` and `.input-hint` rules
  (and their mobile overrides).
- Mobile (≤640px): keep the existing stacked behavior (input row + full-width
  button), minus the removed hint/icon rules.

### 3. Behavior (`public/app.js`)
- No logic changes required — `id`s (`urlCard`, `urlInput`, `fetchBtn`,
  `searchHistory`) stay the same, so all listeners keep working.
- Remove the button-`disabled` toggling per the companion plan
  (`GET-INFO-BUTTON-ENABLED-PLAN.md`) so the button is always violet.
- The hint line removal means the empty-input nudge from that plan should target
  the pill itself (shake + focus) rather than a text hint.

### 4. Tie-ins with the other pending plans
- This is the *card* redesign; `SEARCH-CARD-RESPONSIVE.md` covers the ≤380px
  layout on top of it (its `.input-hint` step becomes moot — drop that item).
- `GET-INFO-BUTTON-ENABLED-PLAN.md` covers the button state on top of this.
  Implement in order: **card redesign → button-always-enabled → responsive polish.**

## Verification

- Page loads with just the pill on the page background — no card border/shadow.
- Focus → violet ring; typing shows filtered history; Enter/click fetches.
- Both themes look clean (light: pill on `#f7f7fa`, dark: pill on `#121216`).
- No dead CSS left (`grep` for `.url-card .card-content`, `.input-hint`).
- Responsive: no overflow at 320/375/500/641px; stacked button on mobile;
  desktop pill restored ≥641px.
- Tauri resize to ~360px wide still usable.

## Out of scope

- The loading/progress/format cards (unchanged).
- Search-history dropdown internals (kept as-is).
- New icons (sprite-only).
