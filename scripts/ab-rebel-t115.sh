#!/bin/bash
# Task 115 — live verification of the rebel model as the TERRORIST character.
# Join AIM DEPOT as CT (T bots = enemies = rebels), verify:
#   1. glbTeams: CT=soldier, T=rebel
#   2. T bots render glb + weapon-in-hands (handContact gripGap ~ GUN offset)
#   3. T bot scale/grounding (skinBBox ≈ 1.8 tall, min y ≈ 0)
#   4. zoomed close-up screenshots for VLM (rebel look + hands on the gun)
# Usage: ab-rebel-t115.sh <out-prefix>
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
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1 && echo "team: counter-terrorist (T bots = rebels)"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

# BOTH models must settle (rebel is 19.7 MB) — glb() is ready only then
agent-browser wait --fn "window.__eng && window.__eng.glb() === 'ready'" --timeout 180000 >/dev/null 2>&1 \
  && echo "user models: ready (both settled)" || echo "WARN: user models not ready"
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 120000 >/dev/null 2>&1 \
  || echo "WARN: never live"
sleep 2

echo "--- glbTeams + census ---"
agent-browser eval "JSON.stringify({teams: window.__eng.glbTeams(), players: window.__eng.players().map(function(p){return {id:p.id, team:p.team, alive:p.alive, glb:p.glb, w:p.w}})})" 2>/dev/null | tail -1
agent-browser eval "JSON.stringify(window.__assetCache ? window.__assetCache.stats : null)" 2>/dev/null | tail -1

# --- find an alive T bot (prefer rifles), teleport ~2.4 m in front of it.
# Retry: bots die mid-fight — re-check alive right before the screenshot.
TARGET=""
for ATTEMPT in 1 2 3 4 5 6; do
PLAN=$(agent-browser eval "(function(){
  var RIFLES = ['ak47','ak74','m4','m4a1s','famas','aug','galil','awp','ssg08','sg553','scar20','g3sg1'];
  var ps = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb && RIFLES.indexOf(p.w) >= 0});
  if (!ps.length) ps = window.__eng.players().filter(function(p){return p.team==='T' && p.alive && p.glb});
  if (!ps.length) return 'NO T BOT';
  var t = ps[0];
  var mx = t.pos[0] + 0.5, mz = t.pos[2] + 2.1;
  var yaw = Math.atan2(-(t.pos[0]-mx), -(t.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return JSON.stringify({target:t.id, w:t.w, botPos:t.pos});
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g')
echo "plan (attempt $ATTEMPT): $PLAN"
TARGET=$(echo "$PLAN" | sed -n 's/.*"target":"\([^"]*\)".*/\1/p')
[ -n "$TARGET" ] || { sleep 2; continue; }
ALIVE=$(agent-browser eval "(function(){var p=window.__eng.players().filter(function(q){return q.id==='$TARGET'})[0]; return p && p.alive ? 'alive' : 'dead'})()" 2>/dev/null | tail -1 | tr -d '"')
echo "target $TARGET: $ALIVE"
[ "$ALIVE" = "alive" ] && break
sleep 2
done
sleep 1.2
agent-browser screenshot "$P/$PREFIX-t-closeup.png" >/dev/null 2>&1
echo "shot: $PREFIX-t-closeup.png"

# --- quantitative: hand contact + skin bbox on the T bot
if [ -n "$TARGET" ]; then
  echo "--- handContact(T bot) ---"
  agent-browser eval "JSON.stringify(window.__eng.handContact('$TARGET'))" 2>/dev/null | tail -1
  echo "--- skinBBox(T bot) ---"
  agent-browser eval "JSON.stringify(window.__eng.skinBBox('$TARGET'))" 2>/dev/null | tail -1
fi

# --- side angle on the same bot (different yaw for the VLM)
agent-browser eval "(function(){
  var t = window.__eng.players().filter(function(p){return p.id==='$TARGET'})[0];
  if (!t || !t.alive) return 'target gone';
  var mx = t.pos[0] + 2.6, mz = t.pos[2] + 0.6;
  var yaw = Math.atan2(-(t.pos[0]-mx), -(t.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return 'side';
})()" 2>/dev/null | tail -1
sleep 1.0
agent-browser screenshot "$P/$PREFIX-t-side.png" >/dev/null 2>&1
echo "shot: $PREFIX-t-side.png"
sleep 1.0
agent-browser screenshot "$P/$PREFIX-t-side2.png" >/dev/null 2>&1
echo "shot: $PREFIX-t-side2.png"

# --- CT teammate shot too (soldier must be unchanged)
agent-browser eval "(function(){
  var ps = window.__eng.players().filter(function(p){return p.team==='CT' && p.alive && p.glb && p.id !== window.__eng.state().id});
  if (!ps.length) return 'no CT teammate';
  var t = ps[0];
  var mx = t.pos[0] + 0.5, mz = t.pos[2] + 2.1;
  var yaw = Math.atan2(-(t.pos[0]-mx), -(t.pos[2]-mz)) * 180 / Math.PI;
  window.__eng.teleport(mx, 1.7, mz, yaw);
  return JSON.stringify({ct:t.id, w:t.w});
})()" 2>/dev/null | tail -1
sleep 1.2
agent-browser screenshot "$P/$PREFIX-ct-teammate.png" >/dev/null 2>&1
echo "shot: $PREFIX-ct-teammate.png"

echo "--- final glbTeams ---"
agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1
