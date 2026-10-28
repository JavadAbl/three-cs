#!/bin/bash
# Task 115 — deterministic close-up of an alive T (rebel) bot:
# re-aim at the bot's LIVE position twice (bots walk), verify I'm alive,
# then burst-capture. Also verify the target is a rebel (glbTeams).
# Usage: ab-rebel-zoom-t115.sh <out-prefix>
set -u
PREFIX="$1"
P="/home/z/my-project/scripts"

# (assumes a match is already running from ab-rebel-t115.sh)

ME=$(agent-browser eval "(window.__eng.state().alive ? 'alive' : 'dead')" 2>/dev/null | tail -1 | tr -d '"')
echo "me: $ME"
if [ "$ME" != "alive" ]; then
  echo "waiting for respawn / next round…"
  for _ in $(seq 1 40); do
    A=$(agent-browser eval "(window.__eng.state().alive ? 'alive' : 'dead')" 2>/dev/null | tail -1 | tr -d '"')
    [ "$A" = "alive" ] && break
    sleep 2
  done
fi

for ATTEMPT in 1 2 3 4 5; do
R=$(agent-browser eval "(function(){
  var ps = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb});
  if (!ps.length) return 'NO T BOT';
  // nearest to me
  var me = window.__eng.state().pos;
  var best = null, bd = 1e9;
  for (var i = 0; i < ps.length; i++) {
    var d = Math.hypot(ps[i].pos[0]-me[0], ps[i].pos[2]-me[2]);
    if (d < bd) { bd = d; best = ps[i]; }
  }
  // stand 2.0 m in front of its CURRENT position, facing it
  var mx = best.pos[0] + 0.5, mz = best.pos[2] + 2.0;
  var yaw = Math.atan2(-(best.pos[0]-mx), -(best.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return JSON.stringify({id:best.id, w:best.w, at:best.pos});
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g')
echo "aim1 (attempt $ATTEMPT): $R"
sleep 0.25
# re-aim at its live position (it walked during the 0.25 s)
agent-browser eval "(function(){
  var t = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb})[0];
  if (!t) return 'no';
  var me = window.__eng.state().pos;
  var yaw = Math.atan2(-(t.pos[0]-me[0]), -(t.pos[2]-me[2])) * 180 / Math.PI;
  window.__eng.teleport(me[0], 1.7, me[2], yaw);
  return 're-aimed ' + t.id;
})()" 2>/dev/null | tail -1
sleep 0.15
agent-browser screenshot "$P/$PREFIX-z1.png" >/dev/null 2>&1
sleep 0.2
agent-browser screenshot "$P/$PREFIX-z2.png" >/dev/null 2>&1
sleep 0.5
agent-browser screenshot "$P/$PREFIX-z3.png" >/dev/null 2>&1
echo "burst: $PREFIX-z1/z2/z3.png"
# still alive + target still alive?
S=$(agent-browser eval "(function(){
  var me = window.__eng.state().alive ? 'me-ok' : 'me-dead';
  var ts = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb});
  return me + ' T-alive:' + ts.length;
})()" 2>/dev/null | tail -1 | tr -d '"')
echo "state: $S"
echo "$S" | rg -q "me-ok T-alive:[1-9]" && break
sleep 2
done
