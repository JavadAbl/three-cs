#!/bin/bash
# Task 141: verify the office CT-entrance railings no longer look like
# construction scaffolding (fenceTexture truss-X -> proper railing).
# Vantages: CT spawn centroid (-27.7, eye 6.05, 44.2) looking +Z at the
# north fence wall (z~50.6), then near the map-center entrance (0.5, 47)
# looking +X at the big entrance fences (x 1..4, z 43..51).
# Yaw convention (Task 138, empirical): 0=-X, PI/2=-Z, PI=+X, 3PI/2=+Z.
set -u
ROOT=/home/z/my-project
cd "$ROOT"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser reload >/dev/null 2>&1 || agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 8

SNAP=$(agent-browser snapshot -i 2>/dev/null || true)
echo "$SNAP" | head -30 > scripts/.t141-menu.txt
MAPBTN=$(echo "$SNAP" | rg -i "office" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: office"
CTBTN=$(agent-browser snapshot -i 2>/dev/null | rg -i "counter" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1 && echo "team: counter-terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 60000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "WARN: RESUME click failed"
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 10000 >/dev/null 2>&1 || echo "WARN: pointer not locked"
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 90000 >/dev/null 2>&1 || echo "WARN: not live"
sleep 1

# hop-train: <=9 m hops every 150 ms (server anti-teleport budget), then pin
hop_to() { # x z yaw
  agent-browser eval "(function(){ if (window.__hop) clearInterval(window.__hop); var tx=$1, tz=$2, tyaw=$3; window.__hop = setInterval(function(){ var s = window.__eng.state(); var dx = tx - s.pos[0], dz = tz - s.pos[2]; var d = Math.hypot(dx, dz); if (d < 0.4) { clearInterval(window.__hop); window.__hop = null; return } var k = Math.min(d, 8) / d; window.__eng.teleport(s.pos[0] + dx * k, 6.05, s.pos[2] + dz * k, tyaw) }, 150); return 'armed' })()" 2>&1 | tail -1
  agent-browser wait --fn "window.__hop === null || window.__hop === undefined" --timeout 30000 >/dev/null 2>&1 || echo "WARN: hop unfinished"
  agent-browser eval "window.__eng.teleport($1, 6.05, $2, $3)" >/dev/null 2>&1
  sleep 0.8
}

hop_to -27.7 44.2 4.7124
POS=$(agent-browser eval "JSON.stringify(window.__eng.state().pos)" 2>/dev/null | tr -d '"' || echo "?")
echo "north vantage pos: $POS"
sleep 1
agent-browser screenshot scripts/t141-ct-fence-north.png >/dev/null 2>&1 && echo "shot: t141-ct-fence-north.png"

hop_to 0.5 47 3.1416
POS2=$(agent-browser eval "JSON.stringify(window.__eng.state().pos)" 2>/dev/null | tr -d '"' || echo "?")
echo "east vantage pos: $POS2"
sleep 1
agent-browser screenshot scripts/t141-ct-fence-east.png >/dev/null 2>&1 && echo "shot: t141-ct-fence-east.png"
echo "DONE"
