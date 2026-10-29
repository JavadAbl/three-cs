#!/bin/bash
# Task 115 — join as TERRORIST so the rebel bots are TEAMMATES (they won't
# shoot me), then frame a close-up properly + probe.
# Usage: ab-rebel-team-t115.sh <out-prefix>
set -u
PREFIX="$1"
P="/home/z/my-project/scripts"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "AIM DEPOT" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim depot"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: TERRORIST (rebel teammates)"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

agent-browser wait --fn "window.__eng && window.__eng.glb() === 'ready'" --timeout 180000 >/dev/null 2>&1 \
  && echo "user models: ready" || echo "WARN: models not ready"
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 120000 >/dev/null 2>&1 \
  || echo "WARN: never live"
sleep 2

echo "--- glbTeams ---"
agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1

for ATTEMPT in 1 2 3 4 5 6; do
ME=$(agent-browser eval "(window.__eng.state().alive ? 'alive' : 'dead')" 2>/dev/null | tail -1 | tr -d '"')
[ "$ME" = "alive" ] || { echo "me dead, waiting…"; sleep 3; continue; }

R=$(agent-browser eval "(function(){
  var ps = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb && !p.bot_off});
  if (!ps.length) return 'NO T TEAMMATE';
  var me = window.__eng.state().pos;
  var best = null, bd = 1e9;
  for (var i = 0; i < ps.length; i++) {
    var d = Math.hypot(ps[i].pos[0]-me[0], ps[i].pos[2]-me[2]);
    if (d < bd) { bd = d; best = ps[i]; }
  }
  var mx = best.pos[0] + 0.5, mz = best.pos[2] + 2.0;
  var yaw = Math.atan2(-(best.pos[0]-mx), -(best.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return JSON.stringify({id:best.id, w:best.w, at:best.pos});
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g')
echo "aim (attempt $ATTEMPT): $R"
sleep 0.3
# re-aim at its live position (it walked)
agent-browser eval "(function(){
  var t = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb});
  if (!t.length) return 'no';
  var me = window.__eng.state().pos;
  var best = null, bd = 1e9;
  for (var i = 0; i < t.length; i++) {
    var d = Math.hypot(t[i].pos[0]-me[0], t[i].pos[2]-me[2]);
    if (d < bd) { bd = d; best = t[i]; }
  }
  var yaw = Math.atan2(-(best.pos[0]-me[0]), -(best.pos[2]-me[2])) * 180 / Math.PI;
  window.__eng.teleport(me[0], 1.7, me[2], yaw);
  return 're-aimed ' + best.id + ' (' + best.w + ')';
})()" 2>/dev/null | tail -1
sleep 0.15
agent-browser screenshot "$P/$PREFIX-team-z1.png" >/dev/null 2>&1
sleep 0.4
agent-browser screenshot "$P/$PREFIX-team-z2.png" >/dev/null 2>&1
sleep 0.8
agent-browser screenshot "$P/$PREFIX-team-z3.png" >/dev/null 2>&1
echo "burst: $PREFIX-team-z1/z2/z3.png"

# who is closest to the camera center right now? (decisive for the VLM read)
agent-browser eval "(function(){
  var me = window.__eng.state().pos;
  var rows = window.__eng.players().map(function(p){
    var d = Math.hypot(p.pos[0]-me[0], p.pos[2]-me[2]);
    return {id:p.id, team:p.team, alive:p.alive, w:p.w, dist:Math.round(d*10)/10};
  }).sort(function(a,b){return a.dist-b.dist}).slice(0,4);
  return JSON.stringify(rows);
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g'
ME2=$(agent-browser eval "(window.__eng.state().alive ? 'alive' : 'dead')" 2>/dev/null | tail -1 | tr -d '"')
[ "$ME2" = "alive" ] && break
sleep 2
done
