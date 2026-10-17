#!/bin/bash
# Convert selected CS:GO weapon sounds (from user-provided pack) to web-friendly OGG
# mono+q4 = positional sounds (panned in 3D), stereo+q5 = self/2D sounds
SRC="/home/z/my-project/assets/packs/csgo/weapons"
OUT="/home/z/my-project/public/assets/sounds"
mkdir -p "$OUT"

# format: source | output | m(s)/st(ereo) | quality
TABLE="
ak47_01|ak47_fire|m|4
m4a1_01|m4_fire|m|4
awp_01|awp_fire|m|4
deagle_01|deagle_fire|m|4
glock_01|glock_fire|m|4
usp_01|usp_fire|m|4
mp5_01|mp5_fire|m|4
ak47_distant|ak47_distant|m|4
m4a1_distant_01|m4_distant|m|4
awp_distant|awp_distant|m|4
deagle-1-distant|deagle_distant|m|4
glock18-1-distant|glock_distant|m|4
usp1-distant|usp_distant|m|4
ak47_clipout|ak47_magout|st|5
m4a1_clipout|m4_magout|st|5
awp_clipout|awp_magout|st|5
de_clipout|deagle_magout|st|5
glock_clipout|glock_magout|st|5
usp_clipout|usp_magout|st|5
mp5_clipout|mp5_magout|st|5
ak47_clipin|ak47_magin|st|5
m4a1_clipin|m4_magin|st|5
awp_clipin|awp_magin|st|5
de_clipin|deagle_magin|st|5
glock_clipin|glock_magin|st|5
usp_clipin|usp_magin|st|5
mp5_clipin|mp5_magin|st|5
ak47_boltpull|ak47_rack|st|5
m4a1_boltback|m4_rack|st|5
awp_boltback|awp_rack|st|5
de_slideback|deagle_rack|st|5
glock_slideback|glock_rack|st|5
usp_slideback|usp_rack|st|5
mp5_slideback|mp5_rack|st|5
ak47_draw|ak47_draw|st|5
m4a1_draw|m4_draw|st|5
glock_draw|glock_draw|st|5
mp5_draw|mp5_draw|st|5
deploy1|draw_generic|st|5
slash1|knife_swing1|st|5
slash2|knife_swing2|st|5
stab|knife_stab|st|5
bknife_draw01|knife_draw|st|5
c4_beep1|bomb_beep1|m|4
c4_beep2|bomb_beep2|m|4
c4_beep3|bomb_beep3|m|4
c4_click|bomb_click|m|4
c4_plant|bomb_plant|st|5
c4_initiate|bomb_armed|st|5
c4_disarmstart|bomb_defstart|st|5
c4_disarmfinish|bomb_defdone|st|5
c4_explode1|bomb_explode|m|5
hitwall1|wall1|m|3
hitwall2|wall2|m|3
hitwall3|wall3|m|3
hitwall4|wall4|m|3
ric3|ric1|m|3
ric4|ric2|m|3
ric5|ric3|m|3
hit_01|hit1|m|4
hit_02|hit2|m|4
hit_03|hit3|m|4
hit_04|hit4|m|4
hit_05|hit5|m|4
clipempty_pistol|dry_pistol|st|4
clipempty_rifle|dry_rifle|st|4
zoom|zoom|st|5
key_press1|ui_click|st|4
"

FAIL=0
while IFS='|' read -r src out ch q; do
  [ -z "$src" ] && continue
  if [ ! -f "$SRC/$src.wav" ]; then echo "MISSING: $src.wav"; FAIL=1; continue; fi
  AC=$([ "$ch" = "m" ] && echo 1 || echo 2)
  ffmpeg -y -v error -i "$SRC/$src.wav" -vn -c:a libvorbis -q:a "$q" -ac "$AC" -ar 44100 "$OUT/$out.ogg" || { echo "CONVERT FAIL: $src"; FAIL=1; }
done <<< "$TABLE"

N=$(ls "$OUT"/*.ogg 2>/dev/null | wc -l)
SZ=$(du -sh "$OUT" | cut -f1)
echo "-----"
echo "produced $N ogg files, total $SZ"
[ "$N" -lt 70 ] && echo "WARNING: expected ~71 files" && FAIL=1
exit $FAIL
