#!/bin/bash
# Task 115 — chase-loop framing of a rebel teammate: 8 fast iterations of
# (read bot pos → aim/teleport → instant screenshot). Teammates don't shoot,
# so point-blank is safe. Then crop-zoom the best frames for VLM.
# Usage: ab-rebel-chase-t115.sh <out-prefix>
set -u
PREFIX="$1"
P="/home/z/my-project/scripts"

for I in 1 2 3 4 5 6 7 8; do
agent-browser eval "(function(){
  var t = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb});
  if (!t.length) return 'no';
  var me = window.__eng.state();
  var best = null, bd = 1e9;
  for (var i = 0; i < t.length; i++) {
    var d = Math.hypot(t[i].pos[0]-me.pos[0], t[i].pos[2]-me.pos[2]);
    if (d < bd) { bd = d; best = t[i]; }
  }
  if (bd > 6) {
    // close the distance: stand 2.6 m in front of it
    var mx = best.pos[0] + 0.5, mz = best.pos[2] + 2.6;
    var yaw = Math.atan2(-(best.pos[0]-mx), -(best.pos[2]-mz)) * 180 / Math.PI;
    window.__eng.teleport(mx, 1.7, mz, yaw);
    return 'approach ' + best.id + ' d=' + Math.round(bd);
  }
  // close enough: rotate to face it, stay put
  var yaw = Math.atan2(-(best.pos[0]-me.pos[0]), -(best.pos[2]-me.pos[2])) * 180 / Math.PI;
  window.__eng.teleport(me.pos[0], 1.7, me.pos[2], yaw);
  return 'track ' + best.id + ' d=' + Math.round(bd);
})()" 2>/dev/null | tail -1
agent-browser screenshot "$P/$PREFIX-c$I.png" >/dev/null 2>&1
done
echo "captured $PREFIX-c1..c8.png"
agent-browser eval "(function(){
  var me = window.__eng.state().pos;
  return JSON.stringify(window.__eng.players().filter(function(p){return p.team==='T' && p.alive}).map(function(p){
    return {id:p.id, w:p.w, dist:Math.round(Math.hypot(p.pos[0]-me[0], p.pos[2]-me[2])*10)/10};
  }).sort(function(a,b){return a.dist-b.dist}));
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g'
