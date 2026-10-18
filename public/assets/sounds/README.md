# Weapon sound assets — staging & acceptance workflow

## Committed (accepted) — this directory

85 original CS:GO sample `.ogg` files covering the launch-era roster
(ak47/m4/awp/deagle/mp5/usp … knife, C4, footsteps, UI). Same pipeline as
everything else: leading-silence strip (shot latency), Vorbis q3, 44.1 kHz.

## Pending — `public/staging/sounds/`

166 additional samples for the Phase 3–8 weapons (pistols, SMGs, rifles,
shotguns, machine guns, all six grenades + generic pinpull/throw/bounce),
staged by `scripts/stage-weapon-sounds.sh` from the raw pack
(`assets/packs/csgo/weapons`, gitignored). They are **gitignored but
web-served**; the audio loader tries `/assets/sounds/<name>.ogg` first and
falls back to `/staging/sounds/<name>.ogg`, so the game plays the full
roster's authentic set before acceptance.

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
