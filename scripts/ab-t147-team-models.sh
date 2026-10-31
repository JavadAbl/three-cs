#!/bin/bash
# t147 — why do TERROR characters render same as CT?
# Join ISLAND, read __eng.glbTeams(), dump console [usermodel] warnings,
# then teleport in front of the nearest living T bot and screenshot it.
set -u
P="/home/z/my-project/scripts"
OUT="$P/t147"
mkdir -p "$OUT"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "ISLAND" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: island"
# join as CT so the T bots are ENEMIES = the rebel models under test
CTBTN=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1 && echo "team: CT (T enemies visible)"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 180000 >/dev/null 2>&1 \
  && echo "live" || echo "WARN: never live"
sleep 3

echo "--- glbTeams ---"
agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1
echo "--- console [usermodel] warnings ---"
agent-browser console 2>/dev/null | rg -i "usermodel|rebel|failed" | head -10 || echo "(none)"

echo "--- team census ---"
agent-browser eval "(function(){
  var ps = window.__eng.players();
  var c = {};
  ps.forEach(function(p){ var k = p.team + (p.bot?'-bot':'-human'); c[k]=(c[k]||0)+1; });
  return JSON.stringify(c);
})()" 2>/dev/null | tail -1

# teleport 2.5m in front of the nearest living T ENEMY and screenshot
for ATTEMPT in 1 2 3; do
ME=$(agent-browser eval "(window.__eng.state().alive ? 'alive' : 'dead')" 2>/dev/null | tail -1 | tr -d '"')
[ "$ME" = "alive" ] || { echo "me dead (attempt $ATTEMPT), waiting…"; sleep 4; continue; }
R=$(agent-browser eval "(function(){
  var ts = window.__eng.players().filter(function(p){return p.team==='T' && p.alive});
  if (!ts.length) return 'NO LIVING T';
  var me = window.__eng.state().pos;
  var best = null, bd = 1e9;
  for (var i=0;i<ts.length;i++){
    var d = Math.hypot(ts[i].pos[0]-me[0], ts[i].pos[2]-me[2]);
    if (d<bd){bd=d;best=ts[i];}
  }
  var dx = best.pos[0]-me[0], dz = best.pos[2]-me[2], L = Math.hypot(dx,dz)||1;
  var mx = best.pos[0] - dx/L*1.2, mz = best.pos[2] - dz/L*1.2;
  var yaw = Math.atan2(-(best.pos[0]-mx), -(best.pos[2]-mz))*180/Math.PI;
  window.__eng.teleport(mx, best.pos[1]+1.7, mz, yaw);
  return JSON.stringify({id:best.id, dist:Math.round(bd*10)/10, w:best.w, pos:best.pos});
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g')
echo "aim T enemy (attempt $ATTEMPT): $R"
sleep 0.4
agent-browser screenshot "$OUT/t147-t-enemy-$ATTEMPT.png" >/dev/null 2>&1
break
done
echo "shot: $OUT/t147-t-enemy-1.png"
