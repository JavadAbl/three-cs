#!/bin/bash
# Task 74: in-game A/B test of wall texture variants (dust2 map).
# Usage: ab-wall.sh <variant> <yawDeg> <out.png>
#   variant = damaged_plaster | wall_bricks_plaster | rough_plaster_brick |
#             worn_cracked_plaster | current   (current = no swap)
# Vantage: dust2 (0, 1.7, 38) — big flat 'wall' surfaces dead ahead.
# Join truth: the pause overlay only renders once the HUD says joined, so we
# wait for RESUME text -> click it (pointer lock hides the overlay) -> then
# teleport. Round-start spawn syncs can move us: pos is verified and the shot
# retaken after a reteleport if it drifted.
set -u
VARIANT="$1"; YAW="$2"; OUT="$3"
ROOT=/home/z/my-project
STAGE="$ROOT/public/staging/textures/maps"
VAR="$ROOT/scripts/.tmp/wall_variants"

if [ "$VARIANT" != "current" ]; then
  cp "$VAR/$VARIANT/wall.jpg"      "$STAGE/wall.jpg"
  cp "$VAR/$VARIANT/wall_bump.jpg" "$STAGE/wall_bump.jpg"
  echo "staged variant: $VARIANT"
else
  echo "keeping current staged wall (beige_wall_001)"
fi

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser reload >/dev/null 2>&1 || agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 7

# join: select dust2 map + TERRORIST team (T spawn z~36-40 is right at the
# vantage; CT spawn is 78 m away and the server rejects >12 m/tick jumps),
# then the orange PLAY button ("QUICK PLAY" is a tab)
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST II" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

# wait until truly joined: pause overlay (RESUME text) is rendered
agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 40000 >/dev/null 2>&1 || echo "WARN: no pause menu appeared"
sleep 1

# pointer lock via RESUME — hides the pause overlay
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "WARN: RESUME click failed"
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 10000 >/dev/null 2>&1 || echo "WARN: pointer not locked"

# wait for the PBR hot-swap; teleports only stick during live (warmup/freeze
# enforce a 1.5 m server leash — see engine.ts spawn-sync), so wait for live
agent-browser wait --fn "window.__pbrState && window.__pbrState.wall === 'ready'" --timeout 20000 >/dev/null 2>&1 || echo "WARN: pbr wall not ready"
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 90000 >/dev/null 2>&1 || echo "WARN: never reached live phase"
sleep 0.5

# hop-train to the vantage: chained <=9 m teleports every 150 ms (fire-and-
# forget interval, no pending promise), each inside the server's 12 m/tick
# anti-teleport budget, so the server pos converges and no snapshot snap
# (live leash 20 m) ever triggers
agent-browser eval "(function(){ if (window.__hop) clearInterval(window.__hop); window.__hop = setInterval(function(){ var s = window.__eng.state(); var dx = 0 - s.pos[0], dz = 38 - s.pos[2]; var d = Math.hypot(dx, dz); if (d < 0.4) { clearInterval(window.__hop); window.__hop = null; return } var k = Math.min(d, 9) / d; window.__eng.teleport(s.pos[0] + dx * k, 1.7, s.pos[2] + dz * k, $YAW) }, 150); return 'hop armed' })()" 2>&1 | tail -1
agent-browser wait --fn "window.__hop === null || window.__hop === undefined" --timeout 30000 >/dev/null 2>&1 || echo "WARN: hop train did not finish"
agent-browser eval "window.__eng.teleport(0, 1.7, 38, $YAW)" >/dev/null 2>&1
sleep 0.6
POS=$(agent-browser eval "JSON.stringify(window.__eng.state().pos)" 2>/dev/null | tr -d '"' || echo "?")
echo "pos after hop-train: $POS"
sleep 1
agent-browser screenshot "$OUT" >/dev/null 2>&1
POS2=$(agent-browser eval "JSON.stringify(window.__eng.state().pos)" 2>/dev/null | tr -d '"' || echo "?")
if echo "$POS2" | rg -q '^\[0,[0-9.]+,38\]$'; then
  echo "shot OK: $OUT (yaw $YAW, final pos $POS2)"
else
  echo "STILL DRIFTED ($POS2) — reteleport + reshoot"
  agent-browser eval "window.__eng.teleport(0, 1.7, 38, $YAW)" >/dev/null 2>&1
  sleep 0.6
  agent-browser screenshot "$OUT" >/dev/null 2>&1
  echo "reshot: $OUT"
fi
