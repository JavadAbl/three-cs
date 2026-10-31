#!/bin/bash
# t147 FINAL GATE — the AUTOMATIC production recovery (no debug hooks).
# Block the rebel, clear the cache, join island -> all T bots on the soldier
# fallback (the user's report). Unblock. DO NOTHING ELSE — the slow-link
# backoff (+30s/+120s) must fetch the rebel by itself and upgradeAllGlb must
# re-skin every fallback T player in place.
set -u
OUT="/home/z/my-project/scripts/t147"
mkdir -p "$OUT"

echo "=== setup: block rebel + empty cache + fresh join ==="
timeout 30 agent-browser network route "**/api/assets/rebel*" --abort >/dev/null 2>&1 && echo "route: rebel BLOCKED"
timeout 60 agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do timeout 20 agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
timeout 30 agent-browser eval "(async function(){ var ks = await caches.keys(); await Promise.all(ks.filter(function(k){return k.indexOf('three-cs-assets-')===0}).map(function(k){return caches.delete(k)})); return 'cache cleared' })()" 2>/dev/null | tail -1
timeout 60 agent-browser reload >/dev/null 2>&1
for _ in $(seq 1 45); do timeout 20 agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1
MAPBTN=$(timeout 20 agent-browser snapshot -i 2>/dev/null | rg "ISLAND" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && timeout 30 agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: island"
CTBTN=$(timeout 20 agent-browser snapshot -i 2>/dev/null | rg "COUNTER" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$CTBTN" ] && timeout 30 agent-browser click @$CTBTN >/dev/null 2>&1 && echo "team: CT"
PLAY=$(timeout 20 agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && timeout 30 agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched"
timeout 240 agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 230000 >/dev/null 2>&1 \
  && echo "live" || echo "WARN: never live"
sleep 2

echo "=== assert 1: the bug state (T on soldier fallback) ==="
A1=$(timeout 30 agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1)
A2=$(timeout 30 agent-browser eval "(function(){ var t = window.__eng.players().filter(function(p){return p.team==='T'}); return JSON.stringify({T:t.length, Tglb:t.filter(function(p){return p.glb}).length, Tfb:t.filter(function(p){return p.fb===true}).length}); })()" 2>/dev/null | tail -1)
echo "glbTeams: $A1"
echo "census:   $A2"

echo "=== unblock and WAIT — automatic backoff recovery expected ==="
timeout 30 agent-browser network unroute "**/api/assets/rebel*" >/dev/null 2>&1 && echo "route: rebel UNBLOCKED (no manual kick)"
OK=0
for i in $(seq 1 30); do
  sleep 5
  S=$(timeout 20 agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1)
  if echo "$S" | rg -q 'rebel'; then echo "poll $i (${i}x5s): $S"; OK=1; break; fi
  [ $((i % 4)) -eq 0 ] && echo "poll $i (${i}x5s): $S"
done

echo "=== assert 2: re-skinned in place ==="
B1=$(timeout 30 agent-browser eval "JSON.stringify(window.__eng.glbTeams())" 2>/dev/null | tail -1)
B2=$(timeout 30 agent-browser eval "(function(){ var t = window.__eng.players().filter(function(p){return p.team==='T'}); return JSON.stringify({T:t.length, Tglb:t.filter(function(p){return p.glb}).length, Tfb:t.filter(function(p){return p.fb===true}).length}); })()" 2>/dev/null | tail -1)
echo "glbTeams: $B1"
echo "census:   $B2"

echo "=== assert 3: rebel persisted for next session ==="
C1=$(timeout 60 agent-browser eval "(async function(){ var ks = await caches.keys(); var c = await caches.open(ks[0]); var r = await c.match(new Request('/api/assets/rebel', {method:'GET'})); return 'rebelStored=' + !!r; })()" 2>/dev/null | tail -1)
echo "cache:    $C1"

echo ""
echo "=== VERDICT ==="
PASS=1
# NOTE: the eval outputs are JSON-of-JSON (quotes arrive backslash-escaped),
# so the patterns match the escaped form loosely.
echo "$A1" | rg -q 'soldier-fallback' || { echo "FAIL: phase A did not show soldier-fallback"; PASS=0; }
echo "$A2" | rg -q 'Tfb[^,}]*[1-9]' || { echo "FAIL: phase A census showed no fallback players"; PASS=0; }
[ "$OK" = "1" ] || { echo "FAIL: automatic recovery never flipped T to rebel"; PASS=0; }
echo "$B2" | rg -q 'Tfb[^,}]*:0' || { echo "FAIL: players not re-skinned"; PASS=0; }
echo "$C1" | rg -q 'rebelStored=true' || { echo "FAIL: rebel not persisted"; PASS=0; }
[ "$PASS" = "1" ] && echo "ALL GATES PASS" || echo "GATE FAILURES ABOVE"
