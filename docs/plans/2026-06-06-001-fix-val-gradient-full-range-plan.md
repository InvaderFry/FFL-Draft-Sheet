---
title: "fix: Extend Val gradient to cover full min–max range including negatives"
date: 2026-06-06
status: completed
type: fix
---

# fix: Extend Val gradient to cover full min–max range including negatives

## Summary

The Val cell gradient currently maps `[0, maxVal]` → `[blue, orange]`, which means all negative Val players collapse to the same flat blue as a zero-Val player. The fix threads the actual dataset minimum through the gradient formula so the gradient spans `[minVal, maxVal]`, giving negative Val players progressively deeper blue tones proportional to how negative they are.

---

## Problem Frame

`valBgStyle` in `beersheets-mvp/frontend/src/utils/valGradient.js` accepts a `maxValue` argument and normalizes the input as `t = clamp(value, 0, maxValue) / maxValue`. The clamp to 0 means any negative Val is indistinguishable from a Val of exactly 0 — both render as the full-blue endpoint. Callers in `DraftBoard.jsx` and `PrintView.jsx` also floor their max computation at 0 (`Math.max(0, ...)`), which reinforces this behavior.

**Desired behavior:** the color at any Val value is determined by its position in the full `[minVal, maxVal]` range of the dataset, so the most-negative player is most blue and the most-positive player is most orange.

---

## Requirements

- R1: Most positive Val in the dataset maps to the orange endpoint (t=1).
- R2: Most negative Val in the dataset maps to the blue endpoint (t=0).
- R3: When all Vals are equal, no gradient color is applied (return `{}`).
- R4: `psPctBgStyle` is unaffected — PS% is always 0–100 and keeps its fixed range.
- R5: The `print` theme's conditional-alpha logic in `PrintView.jsx` must use the same updated range.

---

## Key Technical Decisions

**Use actual data min, not a floor at 0.** `minVal` is derived from `Math.min(...allPlayerVals)` with no 0-floor. This lets the gradient scale with actual data — if all players have positive Val, the lowest positive becomes the blue endpoint. This is the most intuitive reading of "range from most positive to most negative."

**Change signature from `(value, maxValue, ...)` to `(value, minValue, maxValue, ...)`** rather than a single `range` object, to stay consistent with the existing flat-arg style and keep the diff minimal. `psPctBgStyle` calls `valBgStyle(psPct, 0, 100, theme, alpha)` to preserve its 0–100 fixed range.

**Guard condition changes from `maxValue <= 0` to `maxValue === minValue` (or equivalently, `range === 0`).** The old guard was wrong for negative-only datasets; the new guard correctly handles the degenerate case where all players have identical Val.

---

## Implementation Units

### U1. Update `valGradient.js` and its test suite

**Goal:** Change `valBgStyle` to accept `minValue` and `maxValue`, normalize over the full range, and update `psPctBgStyle` to pass explicit `minValue=0`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none

**Files:**
- `beersheets-mvp/frontend/src/utils/valGradient.js`
- `beersheets-mvp/frontend/src/utils/valGradient.test.js`

**Approach:**
- New signature: `valBgStyle(value, minValue, maxValue, theme, alpha = 0.30)`
- Guard: if `value == null || isNaN(value) || minValue === maxValue` → return `{}`
- Normalization: `t = clamp((value - minValue) / (maxValue - minValue), 0, 1)`
- `psPctBgStyle(psPct, theme, alpha)` → `valBgStyle(psPct, 0, 100, theme, alpha)` (unchanged behavior)

**Test scenarios:**
- Returns `{}` for null value (unchanged)
- Returns `{}` for NaN value (unchanged)
- Returns `{}` when minValue === maxValue (all-same range replaces old `maxValue <= 0` guard)
- Returns blue endpoint when value equals minValue (was: value=0; now: value=minValue which can be negative)
- Returns orange endpoint when value equals maxValue
- Returns interpolated midpoint when value is halfway between minValue and maxValue
- Negative minValue: `valBgStyle(-20, -20, 40, 'dark')` returns blue endpoint; `valBgStyle(0, -20, 40, 'dark')` returns color at t=1/3 (not blue)
- All existing theme variants (macchiato, latte, print) still return correct endpoints at minValue and maxValue
- Clamps value below minValue to blue endpoint
- Clamps value above maxValue to orange endpoint
- Falls back to dark for unknown theme
- Respects custom alpha
- `psPctBgStyle(0, 'dark')` still returns blue; `psPctBgStyle(100, 'dark')` still returns orange (fixed 0–100 range preserved)

**Verification:** All vitest tests pass. `psPctBgStyle` behavior is bit-for-bit identical to pre-change.

---

### U2. Update callers to compute and thread `minVal`

**Goal:** Compute the actual dataset minimum Val in `DraftBoard.jsx` and `PrintView.jsx`; propagate it through `CombinedView.jsx` and `PlayerTable.jsx` so `valBgStyle` receives the correct range.

**Requirements:** R1, R2, R5

**Dependencies:** U1

**Files:**
- `beersheets-mvp/frontend/src/components/DraftBoard.jsx`
- `beersheets-mvp/frontend/src/components/CombinedView.jsx`
- `beersheets-mvp/frontend/src/components/PlayerTable.jsx`
- `beersheets-mvp/frontend/src/components/PrintView.jsx`
- `beersheets-mvp/frontend/src/components/PlayerTable.test.jsx`
- `beersheets-mvp/frontend/src/components/PrintView.test.jsx`

**Approach:**

*DraftBoard.jsx* — add a `minVal` memo alongside the existing `maxVal` memo. Remove the `Math.max(0, ...)` floor so both reflect actual data. Pass `minVal` to `CombinedView` and `PlayerTable`.

*CombinedView.jsx* — add `minVal = 0` to the destructured props; forward it to each `PlayerTable`.

*PlayerTable.jsx* — add `minVal = 0` to the destructured props; pass `minVal` as the second arg to `valBgStyle(player.val, minVal, maxVal, theme)`.

*PrintView.jsx* — update `maxVal` computation to remove the `Math.max(0, ...)` floor; add a parallel `minVal` derivation. Update `printValStyle(value, minValue, maxValue)` to accept both and compute `t` over the full range. Update `PositionTableBase` props and calls accordingly. The existing conditional-alpha thresholds (`t >= 0.67` / `t <= 0.33`) continue to work correctly once `t` is computed from the full range.

**Test scenarios:**
- `PlayerTable` renders Val cells with correct gradient when a mix of positive and negative `val` players is present and `minVal` is negative
- `PlayerTable` renders Val cells with no gradient style when `minVal === maxVal`
- `PrintView` renders Val cells with orange-tinted style for top-third players and blue-tinted for bottom-third, based on actual data range
- `CombinedView` forwards `minVal` correctly to each nested `PlayerTable` (existing snapshot/render test updated to pass `minVal`)

**Verification:** All vitest tests pass. Running the dev server and visually inspecting the VAL column shows: negative-Val players display blue tones, positive-Val players display orange tones, and the gradient is differentiated across the full range rather than flat at the blue end.

---

## Scope Boundaries

### In scope
- `valBgStyle` signature and formula
- `minVal` derivation and propagation in `DraftBoard.jsx`, `CombinedView.jsx`, `PlayerTable.jsx`, `PrintView.jsx`
- Test updates for the above

### Out of scope
- Changing the gradient color palette (blue/orange endpoints)
- Changing `psPctBgStyle` behavior (PS% stays 0–100 fixed)
- Adding a color legend or UI key for the gradient scale
- Modifying the ECR color utility

---

## Open Questions

None — all decisions resolved above.
