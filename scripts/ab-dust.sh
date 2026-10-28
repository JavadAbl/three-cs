#!/bin/bash
# Task 90: BEFORE/AFTER dust normal-map A/B shots (the scoped PBR identity
# adds ONLY relief — albedo/bump stay shared). Vantages:
#   1. T-spawn panorama (no teleport)
#   2. the Task-74 wall-strip vantage (0,1.7,38) yaw 180 — big flat plaster
#      wall at z 44..48 dead ahead, the relief close-up
#   3. same spot yaw 0 — spawn-area panorama sweep
# Robust to both the BEFORE (bare 'wall' pbrState key) and AFTER
# ('dust:wall' scoped key) states.
# Usage: ab-dust.sh <out-prefix>   (writes <prefix>-{spawn,wall180,pano0}.png)
set -u
PREFIX="$1"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
# menu wait: a cold Next compile (fresh session or a src swap) delays first paint
# past any fixed sleep — poll until the menu's map cards render, then click
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "classic layout" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: dust"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu appeared"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "WARN: RESUME click failed"
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

agent-browser wait --fn "window.__pbrState && ((window.__pbrState['dust:wall'] && window.__pbrState['dust:wall'] === 'ready') || window.__pbrState.wall === 'ready')" --timeout 30000 >/dev/null 2>&1 || echo "WARN: wall pbr not ready (either key)"
sleep 5   # normal-map hot-swaps land shortly AFTER the ready state (2s proved marginal on dust — first-pass spawn shot pre-swap)

agent-browser screenshot "$PREFIX-spawn.png" >/dev/null 2>&1
echo "shot: $PREFIX-spawn.png"

agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 90000 >/dev/null 2>&1 || echo "WARN: never live"
sleep 0.5

agent-browser eval "(function(){ if (window.__hop) clearInterval(window.__hop); window.__hop = setInterval(function(){ var s = window.__eng.state(); var dx = 0 - s.pos[0], dz = 38 - s.pos[2]; var d = Math.hypot(dx, dz); if (d < 0.4) { clearInterval(window.__hop); window.__hop = null; return } var k = Math.min(d, 9) / d; window.__eng.teleport(s.pos[0] + dx * k, 1.7, s.pos[2] + dz * k, 180) }, 150); return 'hop armed' })()" >/dev/null 2>&1
agent-browser wait --fn "window.__hop === null || window.__hop === undefined" --timeout 30000 >/dev/null 2>&1 || echo "WARN: hop train unfinished"
agent-browser eval "window.__eng.teleport(0, 1.7, 38, 180)" >/dev/null 2>&1
sleep 0.8
agent-browser screenshot "$PREFIX-wall180.png" >/dev/null 2>&1
POS=$(agent-browser eval "JSON.stringify(window.__eng.state().pos)" 2>/dev/null | tr -d '"' || echo "?")
echo "shot: $PREFIX-wall180.png (pos $POS)"

agent-browser eval "window.__eng.teleport(0, 1.7, 38, 0)" >/dev/null 2>&1
sleep 0.8
agent-browser screenshot "$PREFIX-pano0.png" >/dev/null 2>&1
POS2=$(agent-browser eval "JSON.stringify(window.__eng.state().pos)" 2>/dev/null | tr -d '"' || echo "?")
echo "shot: $PREFIX-pano0.png (pos $POS2)"

NORMLOADED=$(agent-browser eval "(function(){ var r = performance.getEntriesByType('resource').filter(function(e){return e.name.indexOf('_normal.jpg') >= 0}).map(function(e){return e.name.split('/').pop()}); return JSON.stringify(r) })()" 2>/dev/null | tail -1)
echo "normal-jpg resources fetched: $NORMLOADED"
echo "done: $PREFIX-{spawn,wall180,pano0}.png"
