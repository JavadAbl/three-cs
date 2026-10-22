#!/bin/bash
# Task 87 live proof: the AIM DEPOT crate-yard arena renders + plays as a
# proper aim map. Joins as T (spawn 0,18 faces north over the arena):
# - asserts map=aimdepot, inventory glock+knife (no c4), hasBomb/canPlant false
# - 45s bot-fight census: shots/kills stream on the new waypoint graph,
#   ZERO bomb/plantProgress events (Task 85 regression class)
# - teleport-hop tour (<=13m hops @ >=500ms — Task-85 snap-back lesson):
#   spawn view (covers the site-B decal zone) -> mid monolith view ->
#   site A floor (red-pixel scan; decal must be absent)
# Usage: ab-aimdepot.sh <out-prefix>
set -u
ROOT=/home/z/my-project
PRE="${1:-aimdepot-live}"
mkdir -p "$ROOT/download" "$ROOT/scripts"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 6

# difficulty -> normal
agent-browser eval "(function(){var s=document.querySelector('select'); if(!s) return 'no select'; var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,'normal'); s.dispatchEvent(new Event('change',{bubbles:true})); return 'difficulty='+s.value})()" 2>&1 | tail -1

# map -> AIM DEPOT (4th map card)
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg -i "aim depot" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim depot"

# team -> TERRORIST
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"

PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

# loading bar (cold context: up to ~125s) -> pause menu RESUME
agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 150000 >/dev/null 2>&1 || echo "WARN: no pause menu"
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

sleep 4
# assert joined map + aim-map inventory state at spawn
agent-browser eval "(function(){var e=window.__eng.state(); var h=window.__cs2hud; return JSON.stringify({map:e.map, phase:h.phase, inv:h.inventory, hasBomb:h.hasBomb, canPlant:h.canPlant, planted:h.bombPlanted})})()" 2>/dev/null | tee "$ROOT/scripts/${PRE}-spawn.json" | tail -1

# arm the ONE-TIME census (rolling-buffer discipline + single onAny arm — Task-84/85 ops notes)
agent-browser eval "(function(){var s=window.__eng.sock(); window.__ev={shots:0,kills:0,plantEv:0,rounds:0,other:{}}; s.onAny(function(t){ if(t==='shot')window.__ev.shots++; else if(t==='kill')window.__ev.kills++; else if(t==='bomb'||t==='plantProgress')window.__ev.plantEv++; else if(t==='round')window.__ev.rounds++; else if(t!=='snapshot'&&t!=='plantProgress')window.__ev.other[t]=(window.__ev.other[t]||0)+1 }); return 'census armed'})()" 2>&1 | tail -1

# shot 1: spawn view — T at (0,18) facing north: full arena + the site-B decal
# zone (0,14) sits 4m ahead — a decal would be unmissable if the gate failed
agent-browser screenshot "$ROOT/download/${PRE}-1-spawn.png" >/dev/null 2>&1 && echo "shot 1: spawn view"

# 45s bot-fight window (normal difficulty: rifle buys, mid + lane pushes)
sleep 45
agent-browser eval "JSON.stringify(window.__ev)" 2>/dev/null | tee "$ROOT/scripts/${PRE}-census.json" | tail -1

# hop-train to mid monolith view: (0,18) -> (0,8) -> (-4,4); yaw 0 = face north
agent-browser eval "(function(){window.__eng.teleport(0,0.05,8,0); return 'hop1 midS (0,8)'})()" 2>&1 | tail -1
sleep 0.7
agent-browser eval "(function(){window.__eng.teleport(-4,0.05,4,0); return 'hop2 hSW (-4,4)'})()" 2>&1 | tail -1
sleep 1
agent-browser screenshot "$ROOT/download/${PRE}-2-mid.png" >/dev/null 2>&1 && echo "shot 2: mid monolith view"

# hop-train on to site A floor: (-4,4) -> (0,-3) -> (0,-12)
agent-browser eval "(function(){window.__eng.teleport(0,0.05,-3,0); return 'hop3 (0,-3)'})()" 2>&1 | tail -1
sleep 0.7
agent-browser eval "(function(){window.__eng.teleport(0,0.05,-12,0); return 'hop4 site A (0,-12)'})()" 2>&1 | tail -1
sleep 1
agent-browser screenshot "$ROOT/download/${PRE}-3-siteA.png" >/dev/null 2>&1 && echo "shot 3: site A floor view"

echo "=== final state ==="
agent-browser eval "(function(){var h=window.__cs2hud; return JSON.stringify({phase:h.phase, planted:h.bombPlanted, canPlant:h.canPlant, ev:window.__ev})})()" 2>/dev/null | tee "$ROOT/scripts/${PRE}-final.json" | tail -1

echo "=== red-pixel scans (decal detector; HUD-cluster-only == decal-free, Task-85 baseline ~40-50) ==="
python3 "$ROOT/scripts/red-pixel-scan.py" "$ROOT/download/${PRE}-1-spawn.png" 2>&1 | tail -2
python3 "$ROOT/scripts/red-pixel-scan.py" "$ROOT/download/${PRE}-3-siteA.png" 2>&1 | tail -2
