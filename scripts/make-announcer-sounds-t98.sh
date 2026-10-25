#!/bin/bash
# Task 98 — generate the 4 round/bomb announcer lines via z-ai TTS,
# then convert to the repo's Vorbis convention (44.1 kHz, q3).
# Announcer voice: kazi (clear standard). Speed 0.95 for a little gravitas.
# ⚠ Task 120 SUPERSEDED these: the live announce_*.ogg files are now the REAL
# CS radio announcer (sourcesounds/csgo, see replace-announcer-csgo-t120.sh).
# Running THIS script would overwrite them with TTS — only use it to
# deliberately roll back to the Task-98 voice.
set -e
TMP=/home/z/my-project/scripts/.tmp/tts-t98
OUT=/home/z/my-project/public/assets/sounds
mkdir -p "$TMP"

declare -A LINES=(
  [announce_t_win]="Terrorists win."
  [announce_ct_win]="Counter-Terrorists win."
  [announce_planted]="The bomb has been planted."
  [announce_defused]="The bomb has been defused."
)

for name in announce_t_win announce_ct_win announce_planted announce_defused; do
  text="${LINES[$name]}"
  z-ai tts -i "$text" -o "$TMP/$name.wav" --voice kazi --speed 0.95 --format wav
  # strip leading silence (same pipeline as the weapon pack), 44.1 kHz Vorbis q3
  ffmpeg -y -loglevel error -i "$TMP/$name.wav" -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse" -ar 44100 -c:a libvorbis -q:a 3 "$OUT/$name.ogg"
  echo "$name.ogg: $(stat -c%s "$OUT/$name.ogg") bytes"
done
