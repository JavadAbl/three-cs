#!/bin/bash
# Task 79: in-game AI verification — join DUST2 as TERRORIST vs EASY bots,
# telemetry-log every remote player position for ~50 s (freeze + live), then
# dump. Proves: (1) bots MOVE (reposition/rotate, not statues), (2) easy mode
# is survivable (my HP timeline), (3) no instant one-shot deaths.
# Usage: verify-ai.sh <shot-prefix>
set -u
PRE="${1:-ai}"
ROOT=/home/z/my-project

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser reload >/dev/null 2>&1 || true
sleep 7

# difficulty: EASY (React-controlled <select> — set value + dispatch change)
agent-browser eval "(function(){var s=document.querySelector('select'); if(!s) return 'no select'; var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,'easy'); s.dispatchEvent(new Event('change',{bubbles:true})); return 'difficulty='+s.value})()" 2>&1 | tail -1

# map: DUST2 (click its tile if present)
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST2" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: dust2"

# team: TERRORIST (we observe the CT side — the reported statues)
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"

PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 40000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 || echo "WARN: pointer not locked — hiding overlay via DOM"
agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

# arm telemetry: 1 Hz samples of every remote player + my own state
agent-browser eval "(function(){window.__aiLog=[]; window.__aiShot=0; setInterval(function(){try{var ps=(window.__eng.players()||[]).map(function(p){return {id:p.id,team:p.team,alive:p.alive,pos:p.pos}}); var s=window.__eng.state(); window.__aiLog.push({t:Date.now(),me:{hp:s.hp,alive:s.alive,pos:s.pos},n:ps.length,ps:ps})}catch(e){window.__aiLog.push({t:Date.now(),err:String(e)})}},1000); return 'telemetry armed'})()" 2>&1 | tail -1

# 3 screenshots across the observation window
sleep 12 && agent-browser screenshot "$ROOT/download/${PRE}-1-freeze.png" >/dev/null 2>&1 && echo "shot 1"
sleep 14 && agent-browser screenshot "$ROOT/download/${PRE}-2-mid.png" >/dev/null 2>&1 && echo "shot 2"
sleep 14 && agent-browser screenshot "$ROOT/download/${PRE}-3-late.png" >/dev/null 2>&1 && echo "shot 3"
sleep 10

# dump the log
agent-browser eval "JSON.stringify(window.__aiLog||[])" -o "$ROOT/scripts/ai-log.json" >/dev/null 2>&1 || \
  agent-browser eval "JSON.stringify(window.__aiLog||[])" 2>/dev/null | tr -d '"' | head -c 200 > "$ROOT/scripts/ai-log.json"
echo "log saved: $(wc -c < "$ROOT/scripts/ai-log.json") bytes"
