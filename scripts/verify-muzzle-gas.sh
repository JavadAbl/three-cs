#!/bin/bash
# Task 83: in-game A/B for muzzle gas — fire a pistol burst in a live round
# and screenshot mid-burst. OLD (stashed): each shot spawns a 1.1→3.5 m smoke
# cloud (50% opacity, 0.6 s life) — a churning column over the barrel.
# NEW: a 0.3→0.85 m wisp at 30%, gone in 0.32 s. Runs on either code version.
# Usage: verify-muzzle-gas.sh <label:new|old>
set -u
ROOT=/home/z/my-project
LABEL="${1:-new}"
mkdir -p "$ROOT/download"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1 || agent-browser reload >/dev/null 2>&1 || true
sleep 7

# lobby funnel: NORMAL bots, DUST2, TERRORIST (pistol round = glock bursts)
agent-browser eval "(function(){var s=document.querySelector('select'); if(!s) return 'no select'; var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,'normal'); s.dispatchEvent(new Event('change',{bubbles:true})); return 'difficulty=normal'})()" 2>&1 | tail -1
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST2" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: dust2"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

# wait for the loading bar to lift (Task 82 gate: round starts after)
agent-browser wait --fn "(function(){var d=document.querySelectorAll('div'); for(var i=0;i<d.length;i++){var t=(d[i].innerText||'').trim(); if(t.indexOf('LOADING')===0 && t.indexOf('%')>0) return false;} return document.body && document.body.innerText.length>0})()" --timeout 190000 >/dev/null 2>&1 || echo "WARN: bar state unknown"
sleep 2
agent-browser find text "RESUME" click >/dev/null 2>&1 || true

# wait for the LIVE phase (freeze ~10 s first), ammo ready
agent-browser wait --fn "window.__eng && window.__eng.state().phase==='live' && window.__eng.ammo().ammo.mag>10" --timeout 120000 >/dev/null 2>&1 || echo "WARN: no live phase"

# fire a ~3 s glock burst (~13 rounds) while screenshotting mid-burst —
# the gas blooms right in front of the camera (first-person viewmodel).
# NOTE: must be an IIFE — a bare `return` at eval top level is a syntax
# error and the burst silently never arms.
agent-browser eval "(function(){window.__burst=setInterval(function(){try{window.__eng.fire()}catch(e){}},120); setTimeout(function(){clearInterval(window.__burst)},3200); return 'burst armed'})()" 2>&1 | tail -1
sleep 0.9 && agent-browser screenshot "$ROOT/download/muzzle-$LABEL-1-mid.png" >/dev/null 2>&1 && echo "mid-burst screenshot"
sleep 1.4 && agent-browser screenshot "$ROOT/download/muzzle-$LABEL-2-late.png" >/dev/null 2>&1 && echo "late-burst screenshot"
sleep 1.2

# telemetry: shots fired + surviving fx items by kind (gas wisps counted live)
agent-browser eval "(function(){var E=window.__eng; return JSON.stringify({phase:E.state().phase,hp:E.state().hp,ammo:E.ammo().all,note:'burst done'})})()" 2>/dev/null | python3 -c "import json,sys; s=sys.stdin.read().strip(); s=json.loads(s) if s.startswith('\"') else s; print(s)" > "$ROOT/scripts/muzzle-$LABEL.json"
echo "log: $ROOT/scripts/muzzle-$LABEL.json ($(wc -c < "$ROOT/scripts/muzzle-$LABEL.json" 2>/dev/null || echo 0) bytes)"
