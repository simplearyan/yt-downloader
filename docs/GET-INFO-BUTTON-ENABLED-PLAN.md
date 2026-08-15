# Get Info Button — Remove Disabled State Plan

The "Get Info" button currently starts `disabled`, so on first load it renders as a
washed-out gray pill (`opacity: 0.3`, `cursor: not-allowed`). It only lights up
after the user types something. The goal: the button always looks active and
violet — and on a click with an empty input, give a friendly nudge instead of a
lifeless gray button.

## Current behavior (traced in public/app.js)

| Trigger | What happens now |
|---|---|
| Initial load | `index.html` has `disabled` on `#fetchBtn` → gray at 30% opacity |
| Typing in the input | `el.fetchBtn.disabled = !state.url` (line 344) |
| Enter key | gated by `!el.fetchBtn.disabled` (line 361) |
| During fetch | `el.fetchBtn.disabled = true` (line 439) |
| After fetch / error | `el.fetchBtn.disabled = !el.urlInput.value.trim()` (line 525) |
| Click | `if (!state.isFetching) fetchVideoInfo()` — and `fetchVideoInfo` guards `if (!state.url || state.isFetching) return;` |

CSS: `.btn-primary:disabled { opacity: 0.3; cursor: not-allowed; }` plus
`.input-wrapper .btn-primary:disabled { box-shadow: none; }`.

## Plan

### 1. Remove the empty-input disabled toggling
The button is only ever "useless" when the input is empty — but disabling it
removes the affordance and looks broken. Instead:

- **`index.html`:** remove `disabled` from `#fetchBtn` (it starts enabled).
- **`app.js`:** drop `el.fetchBtn.disabled = !state.url` from the `input` listener
  and `el.fetchBtn.disabled = !el.urlInput.value.trim()` from the `finally` block.
  Keep `state.url` tracking as-is.

### 2. Handle the empty-input click with feedback, not gray
In the click handler (and Enter key), when `!state.url`:

- Focus the input, show the search-history dropdown, and flash a small inline
  hint — e.g., a brief "Paste a YouTube URL first" message under the input
  (reuse `.input-hint` styling with an error-tinted variant), fading out after
  ~2s.
- Optionally a subtle **shake** animation on the wrapper (30px translate, 300ms)
  for a CapCut-style "try again" feel — keep it tiny and non-looping.

### 3. Keep the button usable-looking during fetch
Today the button grays out mid-fetch while the loading card covers the screen —
fine, but the gray still flashes. Two options (pick one):

- **A (recommended):** swap the button label to a **spinner + "Fetching…"** state
  (replace the search icon with a small `.spinner`) and keep it enabled but
  guarded by `state.isFetching`. No gray ever appears.
- **B:** leave the current behavior (disabled during fetch) — simplest, and the
  loading card dominates the view anyway.

### 4. CSS: remove the ugly disabled style
- Delete `.btn-primary:disabled` opacity rule (or scope a *much* lighter version,
  e.g., `opacity: 0.85`, only for a real `disabled` during fetch if option B).
- Delete `.input-wrapper .btn-primary:disabled { box-shadow: none; }` (or keep
  only if option B).
- Add the error-hint + shake styles from step 2.
- Keep the violet pill + shadow — the button always looks pressable.

### 5. Keyboard parity
Enter with empty input should do the same as a click (focus + hint + dropdown),
not silently do nothing. Update the `keydown` handler gate from
`!el.fetchBtn.disabled` to `!state.isFetching`.

## Verification

- Load page → button is full violet with shadow, not gray.
- Click with empty input → input focuses, dropdown opens, inline hint flashes
  (and/or shake), no error thrown.
- Type a URL → button stays violet (no state flicker), click fetches normally.
- During fetch → loading card shows; button either shows "Fetching…" (option A)
  or is disabled (option B) — no 30%-opacity flash at any point.
- Enter key parity: works with URL; with empty input does the nudge.
- Both themes (light/dark) — hint text uses `--color-error`, readable in both.
- Re-run the responsive check at 320/375/500px — the hint must not overflow.

## Out of scope

- Changing the fetch flow / two-phase logic.
- Redesigning the loading card.
- The search-history dropdown redesign (separate plan).
