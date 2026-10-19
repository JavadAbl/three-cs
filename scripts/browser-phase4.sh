#!/bin/bash
# Phase 4 browser E2E (re-runnable) — buys an SMG via the real keyboard flow
# through the :81 gateway and screenshots both menu levels + the viewmodel.
# Usage: bash scripts/browser-phase4.sh [smgRowDigit]   (default 6 = P90)
#
# Sandbox note: background processes are reaped when a tool call ends, so the
# game-server must live AND the whole browser flow must run within THIS one
# script invocation. Key lessons baked in (task-33/36):
#  - poll window.__eng.state().phase until 'freeze' before issuing keys
#  - trusted `press b` toggles the buy menu; digits reach BuyMenu directly
#  - close the menu with B (Escape opens the pause menu instead)
#  - buys must land within one freeze window (8s) — keep the flow tight
set -u
ROW="${1:-6}"
SHOTS=/tmp/p4-shots
mkdir -p "$SHOTS"
cd /home/z/my-project
pkill -f "bun index\.ts" 2>/dev/null   # stale server would serve old weapon tables
sleep 0.5
cd mini-services/game-server
bun index.ts > /tmp/gs-browser.log 2>&1 &
GS=$!
cd /home/z/my-project
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3003/socket.io/?EIO=4&transport=polling" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 0.5
done
echo "game-server up (handshake $code)"

agent-browser reload >/dev/null 2>&1
sleep 4
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1)
[ -z "$PLAY" ] && { echo "PLAY button not found"; kill $GS; exit 1; }
agent-browser click @$PLAY >/dev/null 2>&1
echo "joined"

# wait for the freeze window (max 25s)
for i in $(seq 1 25); do
  PH=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'noeng'" 2>/dev/null | tr -d '"')
  [ "$PH" = "freeze" ] && break
  sleep 1
done
echo "phase=$PH (row digit $ROW)"

agent-browser press b && sleep 0.8
agent-browser screenshot "$SHOTS/01-root-menu.png" >/dev/null 2>&1
agent-browser press 3 && sleep 0.8
agent-browser screenshot "$SHOTS/02-smg-category.png" >/dev/null 2>&1
agent-browser press "$ROW" && sleep 0.8
agent-browser screenshot "$SHOTS/03-after-buy.png" >/dev/null 2>&1
agent-browser press b && sleep 1.2
agent-browser screenshot "$SHOTS/04-viewmodel.png" >/dev/null 2>&1
agent-browser eval "JSON.stringify(window.__eng.ammo())" 2>/dev/null | head -1
echo "--- page errors:"
agent-browser errors 2>/dev/null | head -3

kill $GS 2>/dev/null
wait $GS 2>/dev/null
echo "shots in $SHOTS"
