#!/bin/bash
# t147 E2E — "terror character becomes same as ct"
# Phase A: block /api/assets/rebel (simulates the 20.6MB rebel losing the
#          race on a real connection) -> join ISLAND -> every T player must
#          be on the soldier fallback (fb:true) = the user's report, snapped.
# Phase B: unblock + __eng.glbKick('T') (the late-arrival path) -> all T
#          players must re-skin to the REAL rebel in place (fb:false/null).
# Phase C: the rebel must now live in the persistent Cache API (ROUTE_RE fix).
set -u
P="/home/z/my-project/scripts"
OUT="$P/t147"
mkdir -p "$OUT"

echo "=== phase A: rebel route BLOCKED (the race), join island ==="
timeout 30 agent-browser network route "**/api/assets/rebel*" --abort >/dev/null 2>&1 && echo "route: rebel BLOCKED"
timeout 60 agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do timeout 20 agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
# the persistent Cache API now serves the character models WITHOUT network
# (Task 147 ROUTE_RE fix — Phase C proved rebelStored:true), so blocking the
# route alone no longer starves the load. Empty the store, then RELOAD so the
# lobby warm-up fires into an empty cache with the route still blocked —
# the faithful simulation of a cold first load on a slow connection.
timeout 30 agent-browser eval "(async function(){ var ks = await caches.keys(); await Promise.all(ks.filter(function(k){return k.indexOf('three-cs-assets-')===0}).map(function(k){return caches.delete(k)})); return 'cleared ' + ks.length })()" 2>/dev/null | tail -1
timeout 60 agent-browser reload >/dev/null 2>&1
for _ in $(seq 1 45); do timeout 20 agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(timeout 20 agent-browser snapshot -i 2>/dev/null | rg "ISLAND" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && timeout 30 agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: island"
CTBTN=$(timeout 20 agent-browser snapshot -i 2>/dev/null | rg "COUNTER" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$CTBTN" ] && timeout 30 agent-browser click @$CTBTN >/dev/null 2>&1 && echo "team: CT (T enemies under test)"
PLAY=$(timeout 20 agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && timeout 30 agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched"

timeout 300 agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 290000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
timeout 30 agent-browser find text "RESUME" click >/dev/null 2>&1 || true
timeout 30 agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 || true
timeout 240 agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 230000 >/dev/null 2>&1 \
  && echo "live" || echo "WARN: never live"
sleep 3

echo "--- A: glbTeams (expect T=soldier-fallback) ---"
timeout 30 agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1
echo "--- A: T-player census (expect fb:true everywhere) ---"
timeout 30 agent-browser eval "(function(){
  var ps = window.__eng.players();
  var t = ps.filter(function(p){return p.team==='T'});
  return JSON.stringify({total:ps.length, T:t.length, Tglb:t.filter(function(p){return p.glb}).length, Tfb:t.filter(function(p){return p.fb===true}).length});
})()" 2>/dev/null | tail -1

# close-up of a living T enemy in the fallback state
for ATTEMPT in 1 2 3; do
ME=$(timeout 30 agent-browser eval "(window.__eng.state().alive ? 'alive' : 'dead')" 2>/dev/null | tail -1 | tr -d '"')
[ "$ME" = "alive" ] || { echo "me dead (attempt $ATTEMPT), waiting…"; sleep 4; continue; }
R=$(timeout 30 agent-browser eval "(function(){
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
  return JSON.stringify({id:best.id, dist:Math.round(bd*10)/10, w:best.w});
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g')
echo "aim T enemy (A, attempt $ATTEMPT): $R"
sleep 0.3
timeout 30 agent-browser screenshot "$OUT/t147-A-fallback.png" >/dev/null 2>&1
sleep 0.4
timeout 30 agent-browser screenshot "$OUT/t147-A-fallback2.png" >/dev/null 2>&1
sleep 0.8
timeout 30 agent-browser screenshot "$OUT/t147-A-fallback3.png" >/dev/null 2>&1
echo "burst A: t147-A-fallback{,2,3}.png"
break
done

echo ""
echo "=== phase B: rebel arrives late (unblock + glbKick) ==="
timeout 30 agent-browser network unroute "**/api/assets/rebel*" >/dev/null 2>&1 && echo "route: rebel UNBLOCKED"
# fire-and-poll: awaiting the 20 MB parse inside one eval wedges the daemon
timeout 30 agent-browser eval "void window.__eng.glbKick('T'); 'fired'" 2>/dev/null | tail -1
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 4; S=$(timeout 20 agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1); echo "kick poll $i: $S"; echo "$S" | rg -q '"T":"rebel"' && break; done
echo "--- B: glbTeams (expect T=rebel) ---"
timeout 30 agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1
echo "--- B: T-player census (expect Tfb:0) ---"
timeout 30 agent-browser eval "(function(){
  var ps = window.__eng.players();
  var t = ps.filter(function(p){return p.team==='T'});
  return JSON.stringify({total:ps.length, T:t.length, Tglb:t.filter(function(p){return p.glb}).length, Tfb:t.filter(function(p){return p.fb===true}).length});
})()" 2>/dev/null | tail -1

for ATTEMPT in 1 2 3; do
ME=$(timeout 30 agent-browser eval "(window.__eng.state().alive ? 'alive' : 'dead')" 2>/dev/null | tail -1 | tr -d '"')
[ "$ME" = "alive" ] || { echo "me dead (attempt $ATTEMPT), waiting…"; sleep 4; continue; }
R=$(timeout 30 agent-browser eval "(function(){
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
  return JSON.stringify({id:best.id, dist:Math.round(bd*10)/10, w:best.w});
})()" 2>/dev/null | tail -1 | sed 's/\\"/"/g')
echo "aim T enemy (B, attempt $ATTEMPT): $R"
sleep 0.5
timeout 30 agent-browser screenshot "$OUT/t147-B-rebel.png" >/dev/null 2>&1
break
done

echo ""
echo "=== phase C: rebel persisted in Cache API (ROUTE_RE fix) ==="
timeout 60 agent-browser eval "(async function(){
  try {
    var keys = await caches.keys();
    var ver = keys.filter(function(k){return k.indexOf('three-cs-assets-')===0});
    var c = await caches.open(ver[0]);
    var r = await c.match(new Request('/api/assets/rebel', {method:'GET'}));
    var h = await c.match(new Request('/api/assets/human', {method:'GET'}));
    return JSON.stringify({caches:ver, rebelStored: !!r, humanStored: !!h});
  } catch(e) { return 'ERR ' + e.message }
})()" 2>/dev/null | tail -1

echo "--- console (usermodel mentions) ---"
timeout 40 agent-browser console 2>/dev/null | rg -i "usermodel|rebel" | head -8 || echo "(none)"
echo "done: $OUT/t147-A-fallback.png / t147-B-rebel.png"
