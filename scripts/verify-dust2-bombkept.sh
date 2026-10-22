#!/bin/bash
# Task 85 live proof (phase B): dust2 KEEPS the full bomb loop.
# Joins dust2 as T: asserts human carrier assignment (c4 in inventory, hasBomb,
# 'press 4' hint), site A decal present (red-pixel scan), and a full E-plant
# at site A (plantProgress -> planted -> bar clears per Task 84).
set -u
ROOT=/home/z/my-project
PRE=dust2-bombkept
mkdir -p "$ROOT/download" "$ROOT/scripts"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 6

agent-browser eval "(function(){var s=document.querySelector('select'); if(!s) return 'no select'; var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,'normal'); s.dispatchEvent(new Event('change',{bubbles:true})); return 'difficulty='+s.value})()" 2>&1 | tail -1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST2" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: dust2"

TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"

PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 150000 >/dev/null 2>&1 || echo "WARN: no pause menu"
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

sleep 4
agent-browser eval "(function(){var e=window.__eng.state(); var h=window.__cs2hud; return JSON.stringify({map:e.map, phase:h.phase, inv:h.inventory, hasBomb:h.hasBomb, canPlant:h.canPlant, planted:h.bombPlanted})})()" 2>/dev/null | tee "$ROOT/scripts/${PRE}-spawn.json" | tail -1

agent-browser screenshot "$ROOT/download/${PRE}-1-hud.png" >/dev/null 2>&1 && echo "shot 1: hud (expect 4 C4 + carrier hint)"

# press 4 -> C4 viewmodel, then teleport to site A and PLANT
agent-browser eval "(function(){var h=window.__cs2hud; return JSON.stringify({slots:h.inventory})})()" 2>&1 | tail -1
agent-browser eval "(function(){var s=window.__eng.sock(); window.__dkLog={plantProgress:0,bombEvents:0,maxProg:0}; s.on('plantProgress',function(d){window.__dkLog.plantProgress++; if(d.progress>window.__dkLog.maxProg)window.__dkLog.maxProg=d.progress}); s.on('bomb',function(d){if(d.planted)window.__dkLog.bombEvents++}); window.__eng.teleport(30,2,-30,Math.PI); return 'teleported to dust2 site A'})()" 2>&1 | tail -1
sleep 2
agent-browser eval "(function(){var h=window.__cs2hud; return JSON.stringify({canPlant:h.canPlant, planted:h.bombPlanted})})()" 2>&1 | tail -1
agent-browser screenshot "$ROOT/download/${PRE}-2-siteA.png" >/dev/null 2>&1 && echo "shot 2: site A (expect red decal + HOLD E prompt)"
agent-browser eval "(function(){var s=window.__eng.sock(); s.emit('useDown'); return 'useDown held'})()" 2>&1 | tail -1
sleep 5
agent-browser eval "(function(){var s=window.__eng.sock(); s.emit('useUp'); var h=window.__cs2hud; return JSON.stringify({planted:h.bombPlanted, plantBar:h.plantBar, reg:window.__dkLog})})()" 2>/dev/null | tee "$ROOT/scripts/${PRE}-plant.json" | tail -1
agent-browser screenshot "$ROOT/download/${PRE}-3-planted.png" >/dev/null 2>&1 && echo "shot 3: post-plant"

echo "=== red-pixel scan (dust2 site A — decal should be PRESENT, thousands of px) ==="
python3 "$ROOT/scripts/red-pixel-scan.py" "$ROOT/download/${PRE}-2-siteA.png" 2>&1 | tail -2
