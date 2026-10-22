#!/bin/bash
# Task 85 live proof (phase A): aim_headshot carries NO bomb.
# Joins aim_headshot as T: asserts HUD has no C4 (inventory + slot strip),
# no carrier hint, canPlant false AT the old bombsite A even with useDown held,
# no plant/bomb socket events, and the site decal is GONE (red-pixel scan).
set -u
ROOT=/home/z/my-project
PRE=aimhead-nobomb
mkdir -p "$ROOT/download" "$ROOT/scripts"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 6

# difficulty -> normal
agent-browser eval "(function(){var s=document.querySelector('select'); if(!s) return 'no select'; var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,'normal'); s.dispatchEvent(new Event('change',{bubbles:true})); return 'difficulty='+s.value})()" 2>&1 | tail -1

# map -> AIM HEADSHOT
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg -i "aim head" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim headshot"

# team -> TERRORIST (the bomb side: on old code the human T IS the carrier)
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"

PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

# loading bar (cold context: up to ~125s) -> pause menu RESUME
agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 150000 >/dev/null 2>&1 || echo "WARN: no pause menu"
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

sleep 4
# assert phase + inventory state at spawn
agent-browser eval "(function(){var e=window.__eng.state(); var h=window.__cs2hud; return JSON.stringify({map:e.map, phase:h.phase, inv:h.inventory, hasBomb:h.hasBomb, canPlant:h.canPlant, planted:h.bombPlanted})})()" 2>/dev/null | tee "$ROOT/scripts/${PRE}-spawn.json" | tail -1

agent-browser screenshot "$ROOT/download/${PRE}-1-hud.png" >/dev/null 2>&1 && echo "shot 1: hud"

# arm regression listeners, teleport to OLD bombsite A, hold E (useDown), release
agent-browser eval "(function(){var s=window.__eng.sock(); window.__nbLog={plantProgress:0,bombEvents:0}; s.on('plantProgress',function(){window.__nbLog.plantProgress++}); s.on('bomb',function(d){if(d.planted)window.__nbLog.bombEvents++}); window.__eng.teleport(-25.28,2.45,-10.36,0); return 'teleported to old site A'})()" 2>&1 | tail -1
sleep 2
agent-browser eval "(function(){var s=window.__eng.sock(); s.emit('useDown'); return 'useDown held'})()" 2>&1 | tail -1
sleep 5
agent-browser eval "(function(){var s=window.__eng.sock(); s.emit('useUp'); var h=window.__cs2hud; return JSON.stringify({canPlant:h.canPlant, planted:h.bombPlanted, plantBar:h.plantBar, reg:window.__nbLog})})()" 2>/dev/null | tee "$ROOT/scripts/${PRE}-plant-attempt.json" | tail -1

agent-browser screenshot "$ROOT/download/${PRE}-2-siteA.png" >/dev/null 2>&1 && echo "shot 2: old site A floor"

echo "=== red-pixel scan (site decal detector; Task-84 baseline: ~3399 with decal) ==="
python3 "$ROOT/scripts/red-pixel-scan.py" "$ROOT/download/${PRE}-2-siteA.png" 2>&1 | tail -2
echo "=== spawn HUD slot strip (for the no-C4 visual) ==="
python3 "$ROOT/scripts/red-pixel-scan.py" "$ROOT/download/${PRE}-1-hud.png" 2>&1 | tail -1
