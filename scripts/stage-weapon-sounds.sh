#!/bin/bash
# Phase 2 (WEAPONS_PLAN 2.2): stage ALL new-weapon sound samples.
# Raw: assets/packs/csgo/weapons/*.wav (gitignored pack)
# Out: public/staging/sounds/<name>.ogg — STAGED ONLY (policy v3): gitignored,
# web-served, loader falls back /assets -> /staging. NOTHING COMMITS here;
# acceptance later = plain `mv public/staging/<x> public/assets/<x> && git add`.
# Same ffmpeg settings as the accepted set (scripts/sfx/extract.sh):
# leading-silence strip (shot latency), Vorbis q3, 44.1kHz.
set -e
SRC=/home/z/my-project/assets/packs/csgo/weapons
OUT=/home/z/my-project/public/staging/sounds
mkdir -p "$OUT"

# manifest: <raw file> <staged name>
MANIFEST='
p250-1.wav p250_fire
p250-1-distant.wav p250_distant
p250_clipout.wav p250_clipout
p250_clipin.wav p250_clipin
p250_sliderelease.wav p250_slide
fiveseven-1.wav fiveseven_fire
fiveseven-1-distant.wav fiveseven_distant
fiveseven_clipout.wav fiveseven_clipout
fiveseven_clipin.wav fiveseven_clipin
fiveseven_sliderelease.wav fiveseven_slide
tec9-1.wav tec9_fire
tec9-1-distant.wav tec9_distant
tec9_clipout.wav tec9_clipout
tec9_clipin.wav tec9_clipin
tec9_boltpull.wav tec9_bolt
cz75a-1.wav cz75_fire
cz75a-1-distant.wav cz75_distant
elite-1.wav elites_fire
elite-1-distant.wav elites_distant
elite_clipout.wav elites_clipout
elite_leftclipin.wav elites_clipin
elite_sliderelease.wav elites_slide
hkp2000-1.wav hkp2000_fire
hkp2000-1-distant.wav hkp2000_distant
hkp2000_clipout.wav hkp2000_clipout
hkp2000_clipin.wav hkp2000_clipin
hkp2000_sliderelease.wav hkp2000_slide
revolver-1_01.wav revolver_fire
revolver-1_distant.wav revolver_distant
revolver_clipout.wav revolver_clipout
revolver_clipin.wav revolver_clipin
revolver_siderelease.wav revolver_slide
taser_shoot.wav taser_fire
taser_hit.wav taser_hit
taser_draw.wav taser_draw
mp9-1.wav mp9_fire
mp9-1-distant.wav mp9_distant
mp9_clipout.wav mp9_clipout
mp9_clipin.wav mp9_clipin
mp9_boltback.wav mp9_bolt
mp9_draw.wav mp9_draw
mac10-1.wav mac10_fire
mac10-1-distant.wav mac10_distant
mac10_clipout.wav mac10_clipout
mac10_clipin.wav mac10_clipin
mac10_boltback.wav mac10_bolt
mac10_draw.wav mac10_draw
mp7-1.wav mp7_fire
mp7-1-distant.wav mp7_distant
mp7_clipout.wav mp7_clipout
mp7_clipin.wav mp7_clipin
mp7_slideback.wav mp7_slide
mp7_draw.wav mp7_draw
ump45-1.wav ump45_fire
ump45-1-distant.wav ump45_distant
ump45_clipout.wav ump45_clipout
ump45_clipin.wav ump45_clipin
ump45_boltback.wav ump45_bolt
ump45_draw.wav ump45_draw
p90-1.wav p90_fire
p90-1-distant.wav p90_distant
p90_clipout.wav p90_clipout
p90_clipin.wav p90_clipin
p90_boltback.wav p90_bolt
p90_draw.wav p90_draw
bizon-1.wav bizon_fire
bizon-1-distant.wav bizon_distant
bizon_clipout.wav bizon_clipout
bizon_clipin.wav bizon_clipin
bizon_boltback.wav bizon_bolt
bizon_draw.wav bizon_draw
galil-1.wav galil_fire
galil-1-distant.wav galil_distant
galil_clipout.wav galil_clipout
galil_clipin.wav galil_clipin
galil_boltback.wav galil_bolt
galil_draw.wav galil_draw
famas-1.wav famas_fire
famas-1-distant.wav famas_distant
famas_clipout.wav famas_clipout
famas_clipin.wav famas_clipin
famas_boltback.wav famas_bolt
famas_draw.wav famas_draw
sg556-1.wav sg553_fire
sg556-1-distant.wav sg553_distant
sg556_clipout.wav sg553_clipout
sg556_clipin.wav sg553_clipin
sg556_boltback.wav sg553_bolt
sg556_draw.wav sg553_draw
sg556_zoom_in.wav sg553_zoom_in
sg556_zoom_out.wav sg553_zoom_out
aug-1.wav aug_fire
aug_distant.wav aug_distant
aug_clipout.wav aug_clipout
aug_clipin.wav aug_clipin
aug_boltpull.wav aug_bolt
ssg08-1.wav ssg08_fire
ssg08-1-distant.wav ssg08_distant
ssg08_clipout.wav ssg08_clipout
ssg08_clipin.wav ssg08_clipin
ssg08_boltback.wav ssg08_bolt
ssg08_draw.wav ssg08_draw
scar20_unsil-1.wav scar20_fire
scar20_unsil-1-distant.wav scar20_distant
scar20_clipout.wav scar20_clipout
scar20_clipin.wav scar20_clipin
scar20_boltback.wav scar20_bolt
scar20_draw.wav scar20_draw
g3sg1-1.wav g3sg1_fire
g3sg1-1-distant.wav g3sg1_distant
g3sg1_clipout.wav g3sg1_clipout
g3sg1_clipin.wav g3sg1_clipin
g3sg1_slideback.wav g3sg1_slide
g3sg1_draw.wav g3sg1_draw
m4a1_silencer_01.wav m4a1s_fire
m4a1_silencer_distant.wav m4a1s_distant
m4a1_clipout.wav m4a1s_clipout
m4a1_clipin.wav m4a1s_clipin
m4a1_silencer_boltback.wav m4a1s_bolt
m4a1_draw.wav m4a1s_draw
nova-1.wav nova_fire
nova-1-distant.wav nova_distant
nova_insertshell.wav nova_shell
nova_pump.wav nova_pump
nova_draw.wav nova_draw
xm1014-1.wav xm1014_fire
xm1014-1-distant.wav xm1014_distant
xm1014_insertshell.wav xm1014_shell
xm1014_pump.wav xm1014_pump
mag7-1.wav mag7_fire
mag7-1-distant.wav mag7_distant
mag7_insertshell.wav mag7_shell
mag7_pump_back.wav mag7_pump
mag7_draw.wav mag7_draw
sawedoff-1.wav sawedoff_fire
sawedoff-1-distant.wav sawedoff_distant
sawedoff_insertshell_01.wav sawedoff_shell
sawedoff_pump.wav sawedoff_pump
sawedoff_draw.wav sawedoff_draw
m249-1.wav m249_fire
m249-1-distant.wav m249_distant
m249_boxout.wav m249_boxout
m249_boxin.wav m249_boxin
m249_coverup.wav m249_coverup
m249_draw.wav m249_draw
negev-1.wav negev_fire
negev-1-distant.wav negev_distant
negev_boxout.wav negev_boxout
negev_boxin.wav negev_boxin
negev_coverup.wav negev_coverup
flashbang_draw.wav flash_draw
flashbang_explode1.wav flash_explode
flashbang_explode1_distant.wav flash_explode_distant
hegrenade_detonate_01.wav he_explode
hegrenade_distant_detonate_01.wav he_explode_distant
smokegrenade_draw.wav smoke_draw
smoke_emit.wav smoke_emit
molotov_detonate_1.wav molotov_explode
molotov_detonate_1_distant.wav molotov_explode_distant
inc_grenade_detonate_1.wav inc_explode
inc_grenade_detonate_1_distant.wav inc_explode_distant
decoy2.wav decoy_loop
pinpull.wav grenade_pinpull
grenade_throw.wav grenade_throw
grenade_hit1.wav grenade_bounce
deploy1.wav grenade_deploy
'

TRIM="silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.002"
cd /home/z/my-project
FAIL=0
N=0
while read -r raw name; do
  [ -z "$raw" ] && continue
  src="$SRC/$raw"
  if [ ! -f "$src" ]; then echo "MISSING SRC: $raw"; FAIL=1; continue; fi
  ffmpeg -y -hide_banner -loglevel error -i "$src" \
    -af "$TRIM" -c:a libvorbis -q:a 3 -ar 44100 "$OUT/$name.ogg" </dev/null || { echo "FFMPEG FAIL: $raw"; FAIL=1; continue; }
  N=$((N+1))
done <<<"$MANIFEST"

echo "---- RESULT ----"
echo "staged: $N files"
ls "$OUT" | wc -l
du -sh "$OUT"
exit $FAIL
