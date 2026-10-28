#!/bin/bash
# Task 90 Part A: position-verified in-game shots of the AIM DEPOT ambientCG
# identity (the Task-88 set — bright sand yard, sandstone window walls,
# charcoal concrete perimeter, warm wood crates, real normal maps).
# Vantages: T-spawn panorama (spawn faces the yard, no teleport needed),
# window-wall close-up (6,1.7,0) yaw 270 facing the x=+10 wall, and the mid
# monolith from (0,1.7,6) yaw 0.
# Usage: ab-aimdepot.sh <out-prefix>   (writes <prefix>-{spawn,windowwall,mid}.png)
set -u
PREFIX="$1"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
# menu wait: a cold Next compile (fresh session or a src swap) delays first paint
# past any fixed sleep — poll until the menu's map cards render, then click
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

agent-browser wait --fn "window.__pbrState && window.__pbrState['aimdepot:sand'] === 'ready'" --timeout 30000 >/dev/null 2>&1 || echo "WARN: aimdepot:sand not ready"
sleep 2   # normal-map hot-swaps land shortly AFTER the 'ready' state

# shot 1: spawn panorama (T spawn faces the yard — no teleport needed)
agent-browser screenshot "$PREFIX-spawn.png" >/dev/null 2>&1
echo "shot: $PREFIX-spawn.png"

# teleports only stick during live (freeze enforces a 1.5 m server leash)
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 90000 >/dev/null 2>&1 || echo "WARN: never live"
sleep 0.5

hop() {
  agent-browser eval "(function(){ if (window.__hop) clearInterval(window.__hop); window.__hop = setInterval(function(){ var s = window.__eng.state(); var dx = $1 - s.pos[0], dz = $3 - s.pos[2]; var d = Math.hypot(dx, dz); if (d < 0.4) { clearInterval(window.__hop); window.__hop = null; return } var k = Math.min(d, 9) / d; window.__eng.teleport(s.pos[0] + dx * k, $2, s.pos[2] + dz * k, $4) }, 150); return 'hop armed' })()" >/dev/null 2>&1
  agent-browser wait --fn "window.__hop === null || window.__hop === undefined" --timeout 30000 >/dev/null 2>&1 || echo "WARN: hop train to $1,$3 unfinished"
  agent-browser eval "window.__eng.teleport($1, $2, $3, $4)" >/dev/null 2>&1
  sleep 0.8
}

shot() {
  agent-browser screenshot "$1" >/dev/null 2>&1
  POS=$(agent-browser eval "JSON.stringify(window.__eng.state().pos)" 2>/dev/null | tr -d '"' || echo "?")
  echo "shot: $1 (pos $POS)"
}

# shot 2: window-wall close-up — x=+10 wall from 4 m, sandstone brick relief
hop 6 1.7 0 270
shot "$PREFIX-windowwall.png"

# shot 3: mid monolith from the south lane — crates + yard + far window wall
hop 0 1.7 6 0
shot "$PREFIX-mid.png"

NORMLOADED=$(agent-browser eval "(function(){ var r = performance.getEntriesByType('resource').filter(function(e){return e.name.indexOf('_normal.jpg') >= 0}).map(function(e){return e.name.split('/').pop()}); return JSON.stringify(r) })()" 2>/dev/null | tail -1)
echo "normal-jpg resources fetched: $NORMLOADED"
echo "done: $PREFIX-{spawn,windowwall,mid}.png"
