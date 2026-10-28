#!/bin/bash
# Task 113 part 2 — frame the characters PROPERLY: teleport to stand 2.2 m in
# front of an alive CT teammate (yaw computed in-page to face it), screenshot;
# then face the nearest T bot and let it aim back (arms-raised rig check).
# Usage: ab-monster-closeup-t113.sh <out-prefix>
set -u
PREFIX="$1"
P="/home/z/my-project/scripts"

# hide the headless pointer-lock overlay if it is up
agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'hidden'} return 'none'})()" >/dev/null 2>&1

# shot A: 2.2 m in front of the nearest alive CT teammate, facing it
PLAN=$(agent-browser eval "(function(){
  var ps = window.__eng.players().filter(function(p){return p.team==='CT' && p.alive});
  if (!ps.length) return 'no live CT bot';
  var t = ps[0];
  var dx = 2.2, dz = 1.1, d = Math.hypot(dx, dz);
  var mx = t.pos[0] + dx, mz = t.pos[2] + dz;
  var yaw = Math.atan2(-(t.pos[0]-mx), -(t.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return JSON.stringify({target:t.id, at:t.pos, me:[mx,1.7,mz], yaw:Math.round(yaw)});
})()" 2>/dev/null | tail -1)
echo "plan A: $PLAN"
sleep 1.2
agent-browser screenshot "$P/$PREFIX-ct-close.png" >/dev/null 2>&1
echo "shot: $PREFIX-ct-close.png"

# shot B: face the nearest alive T bot from ~3 m — it will aim/shoot back
PLANB=$(agent-browser eval "(function(){
  var me = window.__eng.state().pos;
  var ps = window.__eng.players().filter(function(p){return p.team==='T' && p.alive});
  if (!ps.length) return 'no live T bot';
  var best = null, bd = 1e9;
  for (var i = 0; i < ps.length; i++) {
    var d = Math.hypot(ps[i].pos[0]-me[0], ps[i].pos[2]-me[2]);
    if (d < bd) { bd = d; best = ps[i]; }
  }
  var dx = best.pos[0]-me[0], dz = best.pos[2]-me[2], d = Math.hypot(dx, dz) || 1;
  var mx = best.pos[0] - dx/d*3.0, mz = best.pos[2] - dz/d*3.0;
  var yaw = Math.atan2(-(best.pos[0]-mx), -(best.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return JSON.stringify({target:best.id, dist:Math.round(bd)});
})()" 2>/dev/null | tail -1)
echo "plan B: $PLANB"
sleep 0.35   # catch it aiming at me (arms raised)
agent-browser screenshot "$P/$PREFIX-t-aim.png" >/dev/null 2>&1
echo "shot: $PREFIX-t-aim.png"
sleep 1.0    # mid-engagement
agent-browser screenshot "$P/$PREFIX-t-aim2.png" >/dev/null 2>&1
echo "shot: $PREFIX-t-aim2.png"
agent-browser eval "JSON.stringify(window.__eng.state().alive ? 'me alive' : 'me dead')" 2>/dev/null | tail -1
