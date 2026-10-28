#!/bin/bash
# Task 116 ACCEPTANCE live check — after mv staging→assets for human.glb +
# ASSET_CACHE_VERSION v8. Join as CT so the soldier bots are TEAMMATES, then:
# glbTeams, cache store version, handContact on an alive CT bot (weapon in
# hands for the accepted soldier), screenshot.
# Usage: ab-accept-t116.sh <out-prefix>
set -u
PREFIX="$1"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "AIM DEPOT" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim depot"
CTBTN=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER-TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1 && echo "team: COUNTER-TERRORIST (soldier teammates)"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

agent-browser wait --fn "window.__eng && window.__eng.glb() === 'ready'" --timeout 180000 >/dev/null 2>&1 \
  && echo "user models: ready" || echo "FAIL: models not ready"
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 120000 >/dev/null 2>&1 \
  || echo "WARN: never live"
sleep 2

echo "--- glbTeams ---"
agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1

echo "--- cache store version ---"
agent-browser eval "caches.keys().then(function(k){return JSON.stringify(k)})" 2>/dev/null | tail -1

echo "--- handContact on nearest alive CT bot (weapon in hands) ---"
for ATTEMPT in 1 2 3 4 5 6; do
R=$(agent-browser eval "(function(){
  var ps = window.__eng.players().filter(function(p){return p.team==='CT' && p.alive && p.glb});
  if (!ps.length) return 'NO CT PLAYER';
  var me = window.__eng.state().pos;
  var best = null, bd = 1e9;
  for (var i = 0; i < ps.length; i++) {
    var d = Math.hypot(ps[i].pos[0]-me[0], ps[i].pos[2]-me[2]);
    if (d < bd) { bd = d; best = ps[i]; }
  }
  var c = window.__eng.handContact(best.id);
  return JSON.stringify({id: best.id, dist: Math.round(bd*10)/10, gripGap: Math.round(c.gripGap*1000)/1000, supportGap: Math.round(c.supportGap*1000)/1000, weapon: best.weapon});
})()" 2>/dev/null | tail -1)
echo "attempt $ATTEMPT: $R"
case "$R" in *gripGap*) break;; esac
sleep 3
done

echo "--- screenshot ---"
agent-browser screenshot "${PREFIX}-live.png" >/dev/null 2>&1 && echo "saved ${PREFIX}-live.png"
