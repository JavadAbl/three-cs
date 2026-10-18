# Weapon sound assets

## Committed (accepted) — this directory

**251 `.ogg` files** — the complete weapon-roster sound set (policy v3
batch acceptance, 2026-10): the original 85 CS:GO samples covering the
launch-era roster (ak47/m4/awp/deagle/mp5/usp … knife, C4, footsteps, UI)
plus the 166 Phase 3–8 weapons batch (pistols, SMGs, rifles, shotguns,
machine guns, all six grenades + generic pinpull/throw/bounce). Same
pipeline throughout: leading-silence strip (shot latency), Vorbis q3,
44.1 kHz.

## Staging (for future batches) — `public/staging/sounds/`

Currently empty. New/regenerated samples land here via
`scripts/stage-weapon-sounds.sh` from the raw pack
(`assets/packs/csgo/weapons`, gitignored). Staged files are **gitignored
but web-served**; the audio loader tries `/assets/sounds/<name>.ogg`
first and falls back to `/staging/sounds/<name>.ogg`.

## Accepting (explicit user approval only)

```bash
mv public/staging/sounds/* public/assets/sounds/ && git add public/assets/sounds/
git commit -m "assets: accept staged weapon sound batch (166 oggs)"
```

Revocation: `git rm --cached public/assets/sounds/<file>` (move it back to
staging to keep it live). See `AGENTS.md` — asset acceptance policy v3.

## Regression guard

`bun scripts/test-audio-map.ts` (329 checks) verifies every mapped name
resolves to an accepted or staged file and that every one of them serves
HTTP 200 through the dev server.
