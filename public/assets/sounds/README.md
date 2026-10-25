# Weapon sound assets

## Committed (accepted) — this directory

**252 `.ogg` files** — the complete weapon-roster sound set (policy v3
batch acceptance, 2026-10): the original 85 CS:GO samples covering the
launch-era roster (ak47/m4/awp/deagle/mp5/usp … knife, C4, footsteps, UI)
plus the 166 Phase 3–8 weapons batch (pistols, SMGs, rifles, shotguns,
machine guns, all six grenades + generic pinpull/throw/bounce). Same
pipeline throughout: leading-silence strip (shot latency), Vorbis q3,
44.1 kHz. **Two accepted samples are NOT from the CS:GO pack:**
`ak74_fire.ogg` (Task 66/67) is the user's own AK-74M fire recording
(`upload/ak74.mp3` → mono Vorbis q4, leading silence stripped, 1.46 s);
the AK-74M's distant/reload/draw sounds reuse the AK-47 family samples
(same platform). And `m4_fire.ogg` was REPLACED (Task 104, 2026-10-24)
with the user's own M4 fire recording (`upload/m4.mp3` → mono Vorbis q4,
44.1 kHz, leading silence stripped, 0.996 s — the old 0.24 s CS:GO
sample is recoverable via
`git checkout HEAD~1 -- public/assets/sounds/m4_fire.ogg`); the M4A4's
distant/reload/draw sounds keep the pack's M4 family samples.

**Task 98 — 4 announcer VOICE lines** (256 `.ogg` total):
`announce_t_win`, `announce_ct_win`, `announce_planted`,
`announce_defused` ("Terrorists win." / "Counter-Terrorists win." /
"The bomb has been planted." / "The bomb has been defused.").
Wired in `src/game/engine.ts`: the round-end line is team-neutral
(heard by all players, names the WINNING team); planted/defused lines
layer over the existing `c4_plant`/`c4_disarmfinish` mechanical samples.

**Task 120 — the 4 announcer lines are now the REAL CS radio announcer.**
The Task-98 TTS synthesis was a stopgap; per user request the four
bodies were replaced with the genuine announcer samples from
`github.com/sourcesounds/csgo` (`sound/radio/{terwin,ctwin,bombpl,
bombdef}.wav` — the legacy CS announcer CS:GO itself ships, 22.05 kHz
mono u8 → highpass 50 Hz + 44.1 kHz + Vorbis q3 via
`scripts/replace-announcer-csgo-t120.sh`). Same filenames, zero
gameplay-code changes; `ASSET_CACHE_VERSION` bumped v8→v9 so existing
browsers refetch the re-shipped bodies. The raw sourcesounds/csgo clone
lives gitignored at `assets/packs/sourcesounds-csgo/`. The TTS
originals remain recoverable from the Task-98 commit 7ef919b
(`git checkout 7ef919b -- public/assets/sounds/announce_*.ogg`);
`scripts/make-announcer-sounds-t98.sh` regenerates them on demand.

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
