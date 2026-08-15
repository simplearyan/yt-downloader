# Feature Cards Redesign — "Why use it"

## Goal
Turn the four plain feature cards into a more distinctive, CapCut-style presentation
that matches the clean design language we've applied to the rest of the site
(flat surfaces, no shadows, compact type, violet accents, no decorative animation).

Current state: four identical bordered cards, each with a 46px violet icon chip,
an h3, and a muted paragraph. Works, but reads as generic and is visually the
weakest section next to the new header, timeline, and version cards.

---

## Design directions (pick one per card, or mix deliberately)

### A. Icon tile cards (smallest change)
Keep the card shell but make the icon the hero:
- Icon chip grows to ~56px, stays flat violet (no gradient/shadow)
- Chip sits flush top-left inside the card, aligned with the title — no centering
- Title 16px bold, body 14px muted, tighter 18px radius
- Card padding 24px; min-height so all four cards align

### B. Top-border accent cards (CapCut-like)
- Thin 3px accent bar on the card's top edge instead of the icon chip
- Each card gets its own accent hue via a per-card modifier class
  (`.feature-accent-1/2/3/4`) — violet, teal, amber, rose
- Small icon sits inline next to the title instead of above it
- Feels editorial; colors must pass WCAG contrast on the accent text

### C. Numbered feature cards (matches the timeline)
- Reuse the numbered-badge motif from the Three-steps timeline
- A small circle with 01/02/03/04 in the top-right corner, icon top-left
- Reinforces the "why use it" as a sequence of benefits

### D. Split icon card (bolder)
- Icon chip floats half-outside the card (negative top margin, overlapping
  the section boundary) — common CapCut marketing pattern
- Requires the section to not clip (`overflow: visible`) and extra top padding

Recommended: **A for structure + B's per-card accent as an option**, because
A is low-risk and B adds the "designed" feel without breaking the flat theme.

---

## Layout changes

- **Desktop (≥1024px):** keep 4 columns, gap 20px
- **Tablet (768–1023px):** 2×2 grid (already in place)
- **Mobile (<768px):** 1 column; cards can widen with icon+title on one row
  (horizontal layout) so the section doesn't feel endless
- All cards equal height (`grid-auto-rows: 1fr` or flex) so borders align

## Content / copy pass

- Tighten each paragraph to ~2 lines; current body copy is long enough to wrap
  unevenly across the four cards
- Add a tiny meta/kicker line per card? (e.g., "SOURCE STREAMS", "SEEK TABLES")
  only if it fits the 2-line budget — otherwise skip

## Interaction

- Keep hover as a border-color change only (matches the rest of the site)
- No lift, no shadow, no icon animation — consistent with the flat pass

## Implementation steps

1. Update `site/index.html` — add optional modifier classes + any new copy
2. Update `site/style.css` — `.features-grid`/`.feature`/`.feature-icon` block
3. If Direction B: define 4 accent modifier classes and confirm contrast
4. Verify at 1100 / 768 / 380px with the same same-origin harness used before
   (overflow check, equal heights, no wrap issues)
5. Lighthouse sanity check (expect no score change — pure CSS/markup)
6. Commit, push, verify the Pages deploy

## Out of scope

- New images/illustrations per card (no assets exist; would add weight)
- Icons beyond the current sprite (add new lucide glyphs only if needed)
