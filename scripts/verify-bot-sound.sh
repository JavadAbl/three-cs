#!/bin/bash
# Task 80: in-game verification — bot gunfire must BROADCAST. Join DUST2 as
# TERRORIST vs NORMAL bots, hook the client socket's 'shot'/'reloadFx' events
# (the exact events audio.gunshot()/reload sfx ride), and count what arrives
# over ~55 s of freeze+live play. Old code: ZERO bot shots ever broadcast —
# counters stay at 0 while bots visibly fight. New code: every bot round lands
# here. Usage: verify-bot-sound.sh <shot-prefix>
set -u
PRE="${1:-botsnd}"
ROOT=/home/z/my-project

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser reload >/dev/null 2>&1 || true
sleep 7

# difficulty: NORMAL (faster bot reactions -> quicker engagements to witness)
agent-browser eval "(function(){var s=document.querySelector('select'); if(!s) return 'no select'; var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,'normal'); s.dispatchEvent(new Event('change',{bubbles:true})); return 'difficulty='+s.value})()" 2>&1 | tail -1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST2" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: dust2"

TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"

PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 40000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 || echo "WARN: pointer not locked — hiding overlay via DOM"
agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

# arm event counters on the LIVE socket — the same pipeline the audio layer
# plays from. Every received 'shot' is a REMOTE player (the server never
# echoes your own fire back), and with only bots in the room, remote == bots.
agent-browser eval "(function(){var s=window.__eng.sock(); if(!s) return 'NO SOCKET'; window.__sndLog={me:s.id,shots:0,reloads:0,byWeapon:{},byShooter:{},firstOrigins:[],reloadIds:[]}; s.on('shot',function(d){var L=window.__sndLog; L.shots++; L.byWeapon[d.weapon]=(L.byWeapon[d.weapon]||0)+1; L.byShooter[d.id]=(L.byShooter[d.id]||0)+1; if(L.firstOrigins.length<6) L.firstOrigins.push({id:d.id,w:d.weapon,o:[d.origin[0].toFixed(1),d.origin[1].toFixed(1),d.origin[2].toFixed(1)]})}); s.on('reloadFx',function(d){var L=window.__sndLog; L.reloads++; L.reloadIds.push(d.id)}); return 'armed, me='+s.id})()" 2>&1 | tail -1

# 3 screenshots across the observation window (live-round bot firefights)
sleep 12 && agent-browser screenshot "$ROOT/download/${PRE}-1-freeze.png" >/dev/null 2>&1 && echo "shot 1"
sleep 14 && agent-browser screenshot "$ROOT/download/${PRE}-2-mid.png" >/dev/null 2>&1 && echo "shot 2"
sleep 14 && agent-browser screenshot "$ROOT/download/${PRE}-3-late.png" >/dev/null 2>&1 && echo "shot 3"
sleep 10

agent-browser eval "JSON.stringify(window.__sndLog||{})" -o "$ROOT/scripts/botsnd-log.json" >/dev/null 2>&1 || \
  agent-browser eval "JSON.stringify(window.__sndLog||{})" 2>/dev/null > "$ROOT/scripts/botsnd-log.json"
echo "log saved: $(wc -c < "$ROOT/scripts/botsnd-log.json") bytes"
