# Search Card — Responsive Redesign Plan

The "Get Info" search card got a CapCut-style pill redesign on desktop. This plan
makes it hold together on small screens — phones, narrow Tauri windows, and
split-screen desktop.

## Current state

**Desktop (≥641px):** the URL row is a single pill — link icon + input + violet
"Get Info" button — 54px tall, full pill radius, layered surface.

**Mobile (≤640px):** the pill collapses to a vertical stack:

```
┌──────────────────────────┐
│  Paste a YouTube URL      │  ← input, 16px (anti-zoom)
│  [🔍  Get Info        ]   │  ← full-width button, 44px
└──────────────────────────┘
  Supports youtube.com · youtu.be · shorts · playlists
```

Measured at real widths (via headless Chrome):
- At 500px viewport the card is **286px wide**, 158px tall, zero horizontal overflow.
- The link icon is hidden on mobile (`display: none`) — the row reads as bare input.
- The hint line is centered at 11px and can wrap to 2 lines on very narrow screens.
- The search-history dropdown keeps `left:0; right:0` on the wrapper, so it
  spans the card width even in the stacked layout — good, but it drops below the
  button, not the input.

## Goals

1. **Zero horizontal overflow** at every width from 320px up (desktop Tauri windows
   are resizable, so narrow is a real case, not just phones).
2. **Thumb-friendly targets** — 44px+ tap targets, comfortable card padding.
3. **CapCut-like simplicity** — one obvious action, nothing cramped or clipped.
4. **Usable search history** — dropdown stays in-viewport and readable when open.
5. Keep the desktop pill design unchanged.

## Plan

### 1. Add a very-narrow breakpoint (≤380px)
The single 640px block is too coarse. Add `@media (max-width: 380px)` that only
touches the search card:

- `.url-card .card-content` padding → `10px 10px` (from `12px 16px`).
- `.input-wrapper` gap → `4px`, padding → `4px`.
- `.input` padding → `9px 8px`.
- `.input-hint` → 10px, tighter `line-height: 1.35` so the hint stays one or two
  tidy lines; optionally shorten the copy on mobile (see step 5).

### 2. Reintroduce the icon inside the input (not hidden)
Currently the link icon is hidden on mobile, which makes the stacked row feel bare.

- Keep the icon **visible on the input row** at `14px`, tinted violet (same as
  desktop), vertically centered.
- Because the wrapper is column-direction on mobile, wrap the icon + input in a
  small inner flex row so the icon sits at the left of the text, not above it:
  ```
  .input-row { display:flex; align-items:center; gap:6px; padding:2px 6px; }
  ```
  (Markup change: `<div class="input-row">icon + input</div>` inside the wrapper.
  The button stays a direct child below it.)

### 3. Tighten the stacked button
- `.input-wrapper .btn` on mobile: keep `height: 44px` (touch target), reduce the
  horizontal padding so it never clips: `padding: 0 16px`.
- Keep `justify-content: center` and the full-width behavior.

### 4. Harden the search-history dropdown on mobile
- Give the dropdown a **max-width of 92vw** and `left: 8px; right: 8px` (inset from
  the wrapper edges) so it never paints outside the card on 320px screens.
- Keep `max-height: 200px` and `overflow-y: auto` (already present).
- Add `overscroll-behavior: contain` so scrolling the list doesn't scroll the page.
- Bump item padding to `12px` (from `10px`) for thumb-friendly rows; keep the
  thumbnail at 36×27.

### 5. Copy pass on the hint
- Short version for ≤380px: **"youtube.com · youtu.be · shorts · playlists"**
  (drop the leading "Supports"). Implement with a second `<span class="hint-short">`
  toggled via CSS (`display:none` → `inline` at ≤380px), so the HTML text stays
  accessible in full on larger screens.

### 6. Verify no regressions in the rest of the mobile layout
The search card shares the 640px block with everything else (app bar, format tabs,
progress, history). The changes above are scoped to `.url-card`, `.input-wrapper`,
`.search-history`, and `.input-hint` so the other cards are untouched.

## Verification checklist

Run a same-origin harness (like the site's `site/.check*.html` pattern) at:

| Width | Check |
|-------|-------|
| 320px | no horizontal overflow; hint one/two lines; button not clipped; icon visible |
| 360px | same |
| 375px | same |
| 420px | same |
| 500px | same |
| 640px | stacked layout still correct at the boundary |
| 641px | desktop pill restored (radius 9999px, 54px row, icon + input + button inline) |

Also verify with `document.documentElement.scrollWidth <= clientWidth` at each
width, and open the search-history dropdown (type a partial URL) to confirm it
stays inside the viewport and scrolls independently.

In the Tauri app: resize the window to ~360×500 and confirm the card, history
dropdown, and footer all behave; confirm the window's `minWidth` is sane
(currently unset — consider adding `minWidth: 360` in `tauri.conf.json` so the
webview can't be shrunk below the tested range).

## Out of scope

- New icons or illustrations (sprite-only, existing Lucide set).
- Reworking the other cards (format/progress/history) — those already stack fine.
- Changing the desktop pill design.
