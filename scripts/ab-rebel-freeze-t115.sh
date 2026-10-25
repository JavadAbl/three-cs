#!/bin/bash
# Task 115 — clean close-ups during FREEZE TIME (bots stand still): wait for
# phase==='freeze', walk up to a T rebel teammate, frame + shoot 3 angles.
# Usage: ab-rebel-freeze-t115.sh <out-prefix>
set -u
PREFIX="$1"
P="/home/z/my-project/scripts"

# wait for a freeze phase (round restart) — up to ~3 min
echo "waiting for freeze phase…"
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'freeze'" --timeout 200000 >/dev/null 2>&1 \
  && echo "freeze!" || { echo "WARN: no freeze window"; }

for I in 1 2 3; do
R=$(agent-browser eval "(function(){
  var ps = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb});
  if (!ps.length) return 'NO T TEAMMATE';
  var me = window.__eng.state();
  var best = null, bd = 1e9;
  for (var i = 0; i < ps.length; i++) {
    var d = Math.hypot(ps[i].pos[0]-me.pos[0], ps[i].pos[2]-me.pos[2]);
    if (d < bd) { bd = d; best = ps[i]; }
  }
  var mx = best.pos[0] + 0.4, mz = best.pos[2] + 1.9;
  var yaw = Math.atan2(-(best.pos[0]-mx), -(best.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return JSON.stringify({id:best.id, w:best.w, d:Math.round(bd*10)/10, ph:window.__eng.state().phase});
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g')
echo "frame (pass $I): $R"
sleep 0.4
agent-browser screenshot "$P/$PREFIX-f$I.png" >/dev/null 2>&1
# slight orbit: side angle on the same bot
agent-browser eval "(function(){
  var t = window.__eng.players().filter(function(p){return p.id==='$(echo "$R" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')'})[0];
  if (!t) return 'gone';
  var mx = t.pos[0] + 2.2, mz = t.pos[2] + 0.4;
  var yaw = Math.atan2(-(t.pos[0]-mx), -(t.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return 'side';
})()" 2>/dev/null | tail -1
sleep 0.4
agent-browser screenshot "$P/$PREFIX-f$I-side.png" >/dev/null 2>&1
sleep 0.3
done
echo "shots: $PREFIX-f1..f3 + sides"
agent-browser eval "JSON.stringify({phase: window.__eng.state().phase, teams: window.__eng.glbTeams()})" 2>/dev/null | tail -1
