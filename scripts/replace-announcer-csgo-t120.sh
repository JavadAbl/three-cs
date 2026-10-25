#!/bin/bash
# Task 120 — replace the 4 Task-98 TTS announcer lines with the REAL CS radio
# announcer samples from github.com/sourcesounds/csgo (user request: "grab your
# missing or generated sound from this rep — win notify, bomb defuse and
# others"). Same filenames, zero gameplay-code changes.
#
# Sources (sound/radio/, the legacy CS announcer CS:GO itself ships):
#   ctwin.wav  -> announce_ct_win    "Counter-Terrorists Win"
#   terwin.wav -> announce_t_win     "Terrorists Win"
#   bombpl.wav -> announce_planted   "The bomb has been planted"
#   bombdef.wav-> announce_defused   "The bomb has been defused"
#
# Sources are 22.05 kHz mono u8 PCM (1.5-1.9 s). Pipeline: highpass 50 Hz
# (kills the u8 files' -1.7% DC offset; voice fundamentals sit 85 Hz+ so
# untouched) -> resample 44.1 kHz -> Vorbis q3 (pack convention). NO
# silence-strip: the legacy files have a hot 8-bit noise floor (RMS ~-17 dB)
# and no leading silence, so the pack's -45 dB strip would be a no-op or
# worse. Levels kept authentic (peak ~-4 dB vs the TTS set's -3 dB — the
# in-mix announce gain 0.55 needs no retune).
#
# Old TTS lines recoverable from the Task-98 commit 7ef919b:
#   git checkout 7ef919b -- public/assets/sounds/announce_*.ogg
set -e
SRC=/home/z/my-project/assets/packs/sourcesounds-csgo/sound/radio
OUT=/home/z/my-project/public/assets/sounds

declare -A MAP=(
  [announce_ct_win]=ctwin.wav
  [announce_t_win]=terwin.wav
  [announce_planted]=bombpl.wav
  [announce_defused]=bombdef.wav
)

for name in announce_ct_win announce_t_win announce_planted announce_defused; do
  src="${MAP[$name]}"
  ffmpeg -y -loglevel error -i "$SRC/$src" \
    -af "highpass=f=50" -ar 44100 -c:a libvorbis -q:a 3 "$OUT/$name.ogg"
  d=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT/$name.ogg")
  echo "$name.ogg <- sound/radio/$src : $(stat -c%s "$OUT/$name.ogg") bytes, ${d}s"
done
