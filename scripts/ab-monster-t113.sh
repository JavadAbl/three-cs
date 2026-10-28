#!/bin/bash
# Task 113 — prove the CT "big monster" is gone, in-game, through the exact
# pipeline the user hits: :81 gateway → lobby → AIM DEPOT as COUNTER-TERRORIST
# → the /api/assets/human route (now serving the on-disk v2 bake) → auto-rig.
# Shots: warm-up standing CT teammates close-up + live-phase action shots
# (bots aim/walk = arm/leg bones exercised = the spiky-deformation check).
# Usage: ab-monster-t113.sh <out-prefix>
set -u
PREFIX="$1"
P="/home/z/my-project/scripts"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "AIM DEPOT" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim depot"
CTBTN=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER-T" | rg -o "e[0-]+" | head -1 || true)
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1 && echo "team: counter-terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu appeared"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "WARN: RESUME click failed"
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

# the model must come through the real route and auto-rig cleanly
agent-browser wait --fn "window.__eng && window.__eng.glb() === 'ready'" --timeout 90000 >/dev/null 2>&1 \
  && echo "user model: ready (auto-rig ok)" || echo "WARN: user model not ready"
sleep 3   # let teammate instances build + tint

# proof the model bytes came fresh from the fixed route (cold v6 store)
agent-browser eval "JSON.stringify({glb: window.__eng.glb(), cache: window.__assetCache ? window.__assetCache.stats : null})" 2>/dev/null | tail -1

PLAYERS=$(agent-browser eval "JSON.stringify(window.__eng.players().map(function(p){return {id:p.id, team:p.team, alive:p.alive, glb:p.glb, pos:p.pos}}))" 2>/dev/null | tail -1)
echo "players: $PLAYERS" | head -c 600; echo

# standing shot: CT teammates stand around the spawn during warm-up
agent-browser screenshot "$P/$PREFIX-stand.png" >/dev/null 2>&1
echo "shot: $PREFIX-stand.png"

# live phase: bots engage (aim = raised arms, walks = leg swings)
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 120000 >/dev/null 2>&1 || echo "WARN: never live"
sleep 2
agent-browser screenshot "$P/$PREFIX-live1.png" >/dev/null 2>&1
echo "shot: $PREFIX-live1.png"
sleep 4
agent-browser screenshot "$P/$PREFIX-live2.png" >/dev/null 2>&1
echo "shot: $PREFIX-live2.png"

# motion delta: did anyone actually move between the two live shots?
agent-browser eval "JSON.stringify(window.__eng.players().map(function(p){return {id:p.id, team:p.team, alive:p.alive, pos:p.pos}}))" 2>/dev/null | tail -1
echo "done: $PREFIX-{stand,live1,live2}.png"
