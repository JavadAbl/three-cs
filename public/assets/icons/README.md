# Buy-menu silhouette icons — staging & acceptance workflow

## What these are

One 240×96 transparent PNG per buy-menu row (42 entries: 33 guns, 6
grenades, kevlar / kevlar+helmet / defuse kit) — light-neutral weapon
silhouettes in the CS 1.6 buy-menu spirit.

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

## Pending — `public/staging/icons/`

Gitignored but web-served. The HUD `BuyIcon` component tries
`/assets/icons/<id>.png` first and falls back to `/staging/icons/<id>.png`
(asset-acceptance policy v3), hiding itself only if neither exists — so the
menu renders identically before and after acceptance.

## Accepting (explicit user approval only)

```bash
mv public/staging/icons/* public/assets/icons/ && git add public/assets/icons/
git commit -m "assets: accept buy-menu silhouette icons (42 pngs)"
```

## Regression guard

`bun scripts/test-phase9.ts` verifies every `BUY_ENTRIES` row has a valid
240×96 RGBA PNG in staging and that the HUD wiring (icon element + accepted
→ staged fallback order) is intact.
