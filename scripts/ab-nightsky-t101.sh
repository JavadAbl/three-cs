#!/bin/bash
# Task 101: live shots of the AIM DEPOT night sky with REAL 3D models —
# the user-supplied moon (moon.bin + lunar albedo) and 22.5k-star field
# (stars-night.bin). Vantages: T-spawn panorama (no teleport — spawn faces
# the yard and the moon sits at -Z, in-frame at pitch 0), mid-yard look back
# toward spawn+sky (teleport 0,1.7,6 yaw 0), and a spawn sky-look (pitch up)
# to judge the star field density/colors.
# Usage: ab-nightsky-t101.sh <out-prefix>   (writes <prefix>-{spawn,mid,sky}.png)
set -u
PREFIX="$1"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "AIM DEPOT" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim depot"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu appeared"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "WARN: RESUME click failed"
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

# night-sky models: wait for the loader's ready flag (assets ~1.1MB on LAN)
agent-browser wait --fn "window.__nightsky && window.__nightsky.ready === true" --timeout 30000 >/dev/null 2>&1 \
  && echo "nightsky: ready" || echo "WARN: __nightsky never ready"
agent-browser wait --fn "window.__pbrState && window.__pbrState['aimdepot:sand'] === 'ready'" --timeout 30000 >/dev/null 2>&1 || echo "WARN: aimdepot:sand not ready"
sleep 2   # normal-map hot-swaps land shortly AFTER the 'ready' state

# shot 1: spawn panorama (T spawn faces the yard; moon at -Z in-frame)
agent-browser screenshot "$PREFIX-spawn.png" >/dev/null 2>&1
echo "shot: $PREFIX-spawn.png"

# teleports only stick during live (freeze enforces a 1.5 m server leash)
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 90000 >/dev/null 2>&1 || echo "WARN: never live"

# shot 2: mid-yard (0,1.7,6) yaw 0 — the vantage that saw the painted moon
agent-browser eval "window.__eng.teleport(0,1.7,6,0)" >/dev/null 2>&1
sleep 2
agent-browser screenshot "$PREFIX-mid.png" >/dev/null 2>&1
echo "shot: $PREFIX-mid.png"

# shot 3: star field — from mid, pitch up ~40deg (yaw keeps -Z so the moon
# and the dense field are both in frame)
agent-browser eval "window.__eng.teleport(0,1.7,6,0,-0.75)" >/dev/null 2>&1
sleep 2
agent-browser screenshot "$PREFIX-sky.png" >/dev/null 2>&1
echo "shot: $PREFIX-sky.png"

# debug: what did the loader report?
agent-browser eval "JSON.stringify(window.__nightsky || {ready:false})" 2>&1 | tail -1
