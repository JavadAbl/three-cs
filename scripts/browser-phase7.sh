#!/bin/bash
# Phase 7 browser E2E — MACHINE GUNS menu (B→5) + negev keyboard buy + live
# sustained spray with the ACCURACY RAMP read straight off __eng.state()
# (sustained counter + spread: wild cone settles to laser while holding).
set -u
SHOTS=/tmp/p7-shots
mkdir -p "$SHOTS"
cd /home/z/my-project
pkill -f "bun index\.ts" 2>/dev/null
sleep 0.5
cd mini-services/game-server
bun index.ts > /tmp/gs-p7b.log 2>&1 &
GS=$!
cd /home/z/my-project
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3003/socket.io/?EIO=4&transport=polling" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 0.5
done
echo "game-server up ($code)"

agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 6
CTBTN=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER" | rg -o "e[0-9]+" | head -1)
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1)
agent-browser click @$PLAY >/dev/null 2>&1 && echo "joined CT"
for i in $(seq 1 25); do
  PH=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'noeng'" 2>/dev/null | tr -d '"')
  [ "$PH" = "freeze" ] && break
  sleep 1
done
echo "phase=$PH"

# buy menu level 1 → MACHINE GUNS (key 5), screenshot the new category
agent-browser press b && sleep 0.7
agent-browser press 5 && sleep 0.9
agent-browser screenshot "$SHOTS/01-mg-menu.png" >/dev/null 2>&1
echo "menu rows: $(agent-browser eval "document.querySelectorAll('[data-testid=buyrow], .flex.flex-col button').length" 2>/dev/null | head -1)"

# buy Negev with keys (row 1)
agent-browser press 1 && sleep 1.0
echo "negev: $(agent-browser eval "JSON.stringify(window.__eng.ammo())" 2>/dev/null | head -c 120)"
agent-browser press b && sleep 1.0
agent-browser screenshot "$SHOTS/02-negev-vm.png" >/dev/null 2>&1

# wait for live, then HOLD the trigger — the spool: read spread mid-spray
for i in $(seq 1 30); do
  PH=$(agent-browser eval "window.__eng.state().phase" 2>/dev/null | tr -d '"')
  [ "$PH" = "live" ] && break
  sleep 1
done
agent-browser mouse move 640 360 >/dev/null 2>&1
agent-browser mouse down left >/dev/null 2>&1
sleep 0.35
echo "COLD  (shot ~4):  $(agent-browser eval "JSON.stringify(window.__eng.state())" 2>/dev/null | rg -o '\"sustained\":[0-9]+|\"spread\":[0-9.]+' | tr '\n' ' ')"
sleep 1.3
echo "SPOOL (shot ~20): $(agent-browser eval "JSON.stringify(window.__eng.state())" 2>/dev/null | rg -o '\"sustained\":[0-9]+|\"spread\":[0-9.]+' | tr '\n' ' ')"
agent-browser mouse up left >/dev/null 2>&1
sleep 0.6
echo "after spray: $(agent-browser eval "JSON.stringify(window.__eng.ammo())" 2>/dev/null | head -c 120)"
agent-browser screenshot "$SHOTS/03-negev-spoiled.png" >/dev/null 2>&1

# pause > 400ms → the spool drops back to cold (read the reset)
sleep 1.0
echo "RESET (idle):     $(agent-browser eval "JSON.stringify(window.__eng.state())" 2>/dev/null | rg -o '\"sustained\":[0-9]+|\"spread\":[0-9.]+' | tr '\n' ' ')"

# switch to M249 (buy via console-free path: B→5→2 needs money; instead
# verify the m249 row exists in the menu screenshot + viewmodel via unit tests)
agent-browser press b && sleep 0.7
agent-browser press 5 && sleep 0.9
agent-browser screenshot "$SHOTS/04-mg-menu-again.png" >/dev/null 2>&1

kill $GS 2>/dev/null
echo "done — shots in $SHOTS"
