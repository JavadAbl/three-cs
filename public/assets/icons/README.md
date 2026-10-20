# Buy-menu silhouette icons

## What these are

One 240×96 transparent PNG per buy-menu row (43 entries: 34 guns, 6
grenades, kevlar / kevlar+helmet / defuse kit) — light-neutral weapon
silhouettes in the CS 1.6 buy-menu spirit. **Accepted (policy v3 batch
acceptance, 2026-10), including the user-feedback fix that rolled the gun
class 180° so magazines hang down** (the first render pass projected them
upside-down).

They are **procedural, not hand-drawn**: `scripts/gen-buy-icons.ts` builds
each entry's real viewmodel (the exact same `src/game/weaponmodels.ts`
geometry the player holds), projects it through a fixed 3/4 side view
(guns) / pin-visible angle (grenades) / flat front view (gear), rasterizes
a supersampled coverage mask, bridges part seams with a morphological
close, and encodes the PNG with an in-script encoder. Hands are excluded
(glove-material colors). Regenerate any time:

```bash
bun scripts/gen-buy-icons.ts   # -> public/staging/icons/<id>.png
```

## Staging (for regenerations) — `public/staging/icons/`

Currently empty — the accepted set lives in this directory. The one
non-generated file is `ak74.png` (Task 66/67): a byte-copy of `ak47.png`
staged as a stand-in and accepted with the weapon — faithful, because the
ak74's procedural fallback reuses the exact buildAK geometry the ak47
icon was rendered from (regenerating it would produce the same silhouette).
The HUD `BuyIcon` component tries `/assets/icons/<id>.png` first and falls
back to `/staging/icons/<id>.png` (asset-acceptance policy v3), hiding
itself only if neither exists — so regenerated icons are live before
acceptance.

## Orientation invariant

`bun scripts/check-icon-orientation.ts` (35 checks) pins the gun view
matrix's 180° acceptance roll at the source level and verifies per weapon
(3D anatomy: magazine vs barrel line, p90's top-mag exempted) that the
roll yields upright icons.

## Regression guard

`bun scripts/test-phase9.ts` verifies every `BUY_ENTRIES` row has a valid
240×96 RGBA PNG (accepted or staged) and that the HUD wiring (icon
element + accepted → staged fallback order) is intact.
