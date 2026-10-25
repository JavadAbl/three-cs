#!/bin/bash
# Task 115 — freeze-framed close-ups, in-page wait (no agent-browser latency):
# an in-page poller grabs the freeze phase the moment it starts and positions
# the camera in front of a frozen T teammate; bash just polls the flag and
# shoots. Bots don't move during freeze, so framing holds.
# Usage: ab-rebel-freeze2-t115.sh <out-prefix>
set -u
PREFIX="$1"
P="/home/z/my-project/scripts"

# arm the in-page freeze watcher
agent-browser eval "(function(){
  window.__framed = null;
  (function poll(){
    try {
      var ph = window.__eng.state().phase;
      var all = window.__eng.players();
      var tAlive = all.filter(function(p){return p.team==='T' && p.alive}).length;
      // round-START freeze only: the whole T team is alive (match-end post
      // clears players / leaves most dead)
      if ((ph === 'freeze' || ph === 'post' || ph === 'warmup') && tAlive >= 4) {
        var ps = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb});
        if (ps.length) {
          var me = window.__eng.state();
          var best = null, bd = 1e9;
          for (var i = 0; i < ps.length; i++) {
            var d = Math.hypot(ps[i].pos[0]-me.pos[0], ps[i].pos[2]-me.pos[2]);
            if (d < bd) { bd = d; best = ps[i]; }
          }
          var mx = best.pos[0] + 0.4, mz = best.pos[2] + 1.9;
          var yaw = Math.atan2(-(best.pos[0]-mx), -(best.pos[2]-mz)) * 180 / Math.PI;
          window.__eng.teleport(mx, 1.7, mz, yaw);
          window.__framed = {id: best.id, w: best.w, d: Math.round(bd*10)/10, ph: ph};
          return; // stop polling
        }
      }
    } catch (e) { /* keep polling */ }
    setTimeout(poll, 50);
  })();
  return 'armed';
})()" 2>/dev/null | tail -1

echo "waiting for the in-page watcher to grab a frozen phase…"
for _ in $(seq 1 300); do
  F=$(agent-browser eval "JSON.stringify(window.__framed)" 2>/dev/null | tail -1 | tr -d '"' | sed 's/\\"/"/g')
  echo "$F" | rg -q 'bot-T-' && break
  sleep 0.4
done
echo "framed: $F"

# bots are FROZEN — take our time: front + slight side orbit
agent-browser screenshot "$P/$PREFIX-front.png" >/dev/null 2>&1
TID=$(echo "$F" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
agent-browser eval "(function(){
  var t = window.__eng.players().filter(function(p){return p.id==='$TID'})[0];
  if (!t) return 'gone';
  var mx = t.pos[0] + 2.1, mz = t.pos[2] + 0.5;
  var yaw = Math.atan2(-(t.pos[0]-mx), -(t.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return 'side';
})()" 2>/dev/null | tail -1
sleep 0.3
agent-browser screenshot "$P/$PREFIX-side.png" >/dev/null 2>&1
sleep 0.3
agent-browser screenshot "$P/$PREFIX-side2.png" >/dev/null 2>&1
echo "shots: $PREFIX-front/side/side2.png"
agent-browser eval "JSON.stringify({phase: window.__eng.state().phase, teams: window.__eng.glbTeams()})" 2>/dev/null | tail -1
