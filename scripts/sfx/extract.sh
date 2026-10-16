#!/bin/bash
# Extract CS:GO weapon/player sounds from the sourcesounds/csgo partial clone
# and convert them to OGG Vorbis for the web game sound pack.
set -e
REPO=/home/z/my-project/scripts/csgo-snd
OUT=/home/z/my-project/public/assets/sounds
WORK=/home/z/my-project/scripts/sfx/wav
mkdir -p "$OUT" "$WORK"

# manifest: <repo path> <output name>
MANIFEST='
sound/weapons/ak47/ak47-1.wav ak47_fire
sound/weapons/ak47/ak47-1-distant.wav ak47_distant
sound/weapons/ak47/ak47_clipout.wav ak47_clipout
sound/weapons/ak47/ak47_clipin.wav ak47_clipin
sound/weapons/ak47/ak47_boltpull.wav ak47_bolt
sound/weapons/ak47/ak47_draw.wav ak47_draw
sound/weapons/m4a1/m4a1-1.wav m4_fire
sound/weapons/m4a1/m4a1-1-distant.wav m4_distant
sound/weapons/m4a1/m4a1_clipout.wav m4_clipout
sound/weapons/m4a1/m4a1_clipin.wav m4_clipin
sound/weapons/m4a1/m4a1_boltback.wav m4_bolt
sound/weapons/m4a1/m4a1_draw.wav m4_draw
sound/weapons/awp/awp1.wav awp_fire
sound/weapons/awp/awp1-distant.wav awp_distant
sound/weapons/awp/awp_clipout.wav awp_clipout
sound/weapons/awp/awp_clipin.wav awp_clipin
sound/weapons/awp/awp_boltback.wav awp_bolt
sound/weapons/awp/awp_boltforward.wav awp_boltforward
sound/weapons/awp/awp_draw.wav awp_draw
sound/weapons/awp/zoom.wav zoom
sound/weapons/deagle/deagle-1.wav deagle_fire
sound/weapons/deagle/deagle-1-distant.wav deagle_distant
sound/weapons/deagle/de_clipout.wav deagle_clipout
sound/weapons/deagle/de_clipin.wav deagle_clipin
sound/weapons/deagle/de_slideback.wav deagle_slide
sound/weapons/deagle/de_draw.wav deagle_draw
sound/weapons/mp5/mp5_01.wav mp5_fire
sound/weapons/mp5/mp5_clipout.wav mp5_clipout
sound/weapons/mp5/mp5_clipin.wav mp5_clipin
sound/weapons/mp5/mp5_slideback.wav mp5_slide
sound/weapons/mp5/mp5_draw.wav mp5_draw
sound/weapons/glock18/glock18-1.wav glock_fire
sound/weapons/glock18/glock18-1-distant.wav glock_distant
sound/weapons/glock18/glock_clipout.wav glock_clipout
sound/weapons/glock18/glock_clipin.wav glock_clipin
sound/weapons/glock18/glock_sliderelease.wav glock_slide
sound/weapons/glock18/glock_draw.wav glock_draw
sound/weapons/usp/usp1.wav usp_fire
sound/weapons/usp/usp1-distant.wav usp_distant
sound/weapons/usp/usp_clipout.wav usp_clipout
sound/weapons/usp/usp_clipin.wav usp_clipin
sound/weapons/usp/usp_sliderelease.wav usp_slide
sound/weapons/usp/usp_draw.wav usp_draw
sound/weapons/knife/knife_deploy1.wav knife_draw
sound/weapons/knife/knife_slash1.wav knife_slash1
sound/weapons/knife/knife_slash2.wav knife_slash2
sound/weapons/knife/knife_hit1.wav knife_hit1
sound/weapons/knife/knife_hit3.wav knife_hit2
sound/weapons/knife/knife_hitwall1.wav knife_wall
sound/weapons/knife/knife_stab.wav knife_stab
sound/weapons/c4/c4_beep1.wav c4_beep1
sound/weapons/c4/c4_beep2.wav c4_beep2
sound/weapons/c4/c4_click.wav c4_click
sound/weapons/c4/c4_initiate.wav c4_initiate
sound/weapons/c4/c4_plant.wav c4_plant
sound/weapons/c4/c4_explode1.wav c4_explode
sound/weapons/c4/c4_disarmstart.wav c4_disarmstart
sound/weapons/c4/c4_disarmfinish.wav c4_disarmfinish
sound/weapons/c4/c4_draw.wav c4_draw
sound/weapons/c4/key_press1.wav c4_key1
sound/weapons/c4/key_press3.wav c4_key2
sound/weapons/clipempty_pistol.wav empty_pistol
sound/weapons/clipempty_rifle.wav empty_rifle
sound/player/bhit_helmet-1.wav dink
sound/player/headshot1.wav headshot
sound/player/damage1.wav hurt1
sound/player/damage2.wav hurt2
sound/player/footsteps/dirt1.wav foot_dirt1
sound/player/footsteps/dirt3.wav foot_dirt2
sound/player/footsteps/dirt4.wav foot_dirt3
sound/player/footsteps/dirt6.wav foot_dirt4
sound/player/footsteps/concrete1.wav foot_conc1
sound/player/footsteps/concrete3.wav foot_conc2
sound/player/footsteps/concrete5.wav foot_conc3
sound/player/footsteps/concrete6.wav foot_conc4
sound/physics/concrete/concrete_impact_bullet1.wav impact1
sound/physics/concrete/concrete_impact_bullet2.wav impact2
sound/physics/concrete/concrete_impact_bullet3.wav impact3
sound/physics/concrete/concrete_impact_bullet4.wav impact4
sound/survival/money_collect_01.wav buy
sound/ui/weapon_cant_buy.wav cant_buy
sound/ui/buttonclick.wav uiclick
sound/music/valve_csgo_01/startround_01.mp3 round_start
sound/music/valve_csgo_01/wonround.mp3 round_win
sound/music/valve_csgo_01/lostround.mp3 round_lose
'

# 1. materialize just these blobs from the partial clone
cd "$REPO"
git sparse-checkout init --no-cone >/dev/null 2>&1 || true
PATHS=()
while read -r p _; do [ -n "$p" ] && PATHS+=("$p"); done <<<"$MANIFEST"
printf '%s\n' "${PATHS[@]}" > .git/info/sparse-checkout
git read-tree -mu HEAD 2>/dev/null || git checkout HEAD -- "${PATHS[@]}"

# 2. convert to ogg
#   - sfx: strip leading silence (CS:GO wavs have ~10-80ms of it -> shot latency), keep reverb tails
#   - music stingers: strip silence, cap at 3.5s, fade out
TRIM="silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.002"
STING="silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05,atrim=0:3.5,afade=t=out:st=2.8:d=0.7"
cd /home/z/my-project
FAIL=0
while read -r p name; do
  [ -z "$p" ] && continue
  src="$REPO/$p"
  if [ ! -f "$src" ]; then echo "MISSING SRC: $p"; FAIL=1; continue; fi
  case "$name" in
    round_start|round_win|round_lose) AF="$STING" ;;
    *) AF="$TRIM" ;;
  esac
  ffmpeg -y -hide_banner -loglevel error -i "$src" \
    -af "$AF" -c:a libvorbis -q:a 3 -ar 44100 "$OUT/$name.ogg" </dev/null || { echo "FFMPEG FAIL: $p"; FAIL=1; }
done <<<"$MANIFEST"

echo "---- RESULT ----"
ls "$OUT" | wc -l
du -sh "$OUT"
exit $FAIL
