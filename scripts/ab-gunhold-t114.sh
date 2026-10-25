#!/bin/bash
# Task 114 — "characters are not holding the weapon in hands" diagnosis.
# Join AIM DEPOT as CT, find an alive CT bot holding a GLB rifle, teleport
# 2.4 m in front of it facing it, screenshot, and dump the quantitative rig
# probe: where the GunRig (gun grip anchor) and HandR sit vs the body bbox.
# Usage: ab-gunhold-t114.sh <out-prefix>
set -u
PREFIX="$1"
P="/home/z/my-project/scripts"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "AIM DEPOT" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim depot"
CTBTN=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER-T" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1 && echo "team: counter-terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

agent-browser wait --fn "window.__eng && window.__eng.glb() === 'ready'" --timeout 90000 >/dev/null 2>&1 \
  && echo "user model: ready" || echo "WARN: user model not ready"
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 120000 >/dev/null 2>&1 \
  || echo "WARN: never live"
sleep 2

# find an alive CT bot with a rifle + teleport in front of it
PLAN=$(agent-browser eval "(function(){
  var RIFLES = ['ak47','ak74','m4','m4a1s','famas','aug','galil','awp','ssg08','sg553','scar20','g3sg1'];
  var ps = window.__eng.players().filter(function(p){return p.alive && p.glb && RIFLES.indexOf(p.w) >= 0});
  if (!ps.length) return 'NO RIFLE BOT';
  var t = ps[0];
  var mx = t.pos[0] + 1.0, mz = t.pos[2] + 2.4;
  var yaw = Math.atan2(-(t.pos[0]-mx), -(t.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return JSON.stringify({target:t.id, w:t.w, botPos:t.pos});
})()" 2>/dev/null | tail -1)
echo "plan: $PLAN"
sleep 1.5

TARGET=$(echo "$PLAN" | sed -n 's/.*"target":"\([^"]*\)".*/\1/p')
agent-browser screenshot "$P/$PREFIX-closeup.png" >/dev/null 2>&1
echo "shot: $PREFIX-closeup.png"

# quantitative probe: gun anchor vs body
agent-browser eval "(function(){
  var id = '$TARGET';
  var rig = window.__eng.boneWorld(id, 'GunRig');
  var hand = window.__eng.boneWorld(id, 'HandR');
  var fore = window.__eng.bonePose(id, 'foreR');
  var info = window.__eng.rigInfo(id);
  var bb = window.__eng.skinBBox(id);
  var ps = window.__eng.players().filter(function(p){return p.id === id})[0];
  return JSON.stringify({id:id, weapon: ps && ps.w, gunParts: ps && ps.gunParts, gunRig:rig, handR:hand, foreR:fore, rig:info, bbox:{min:bb && bb.min, max:bb && bb.max, size:bb && bb.size}}, null, 1);
})()" 2>/dev/null | tail -60

# second angle: profile (side) view of the same bot to see hand/gun contact
agent-browser eval "(function(){
  var ps = window.__eng.players().filter(function(p){return p.id === '$TARGET' && p.alive});
  if (!ps.length) return 'target gone';
  var t = ps[0];
  var mx = t.pos[0] + 2.6, mz = t.pos[2] + 0.4;
  var yaw = Math.atan2(-(t.pos[0]-mx), -(t.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return 'side view set';
})()" 2>/dev/null | tail -1
sleep 1.2
agent-browser screenshot "$P/$PREFIX-side.png" >/dev/null 2>&1
echo "shot: $PREFIX-side.png"
echo "done"
