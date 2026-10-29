#!/bin/bash
# Phase 9 browser E2E — buy menu with the 1.6-style silhouette icons:
# keyboard deagle buy FIRST (still freeze), then icon screenshots per
# category, then the network check (icons fetched via /staging fallback).
set -u
SHOTS=/tmp/p9-shots
mkdir -p "$SHOTS"
cd /home/z/my-project
pkill -f "bun index\.ts" 2>/dev/null
sleep 0.5
cd mini-services/game-server
bun index.ts > /tmp/gs-p9b.log 2>&1 &
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

# keyboard buy FIRST (freeze, window wide open): B -> 1 (PISTOLS) -> 1 (deagle)
agent-browser press b && sleep 0.8
agent-browser press 1 && sleep 1.2
agent-browser screenshot "$SHOTS/01-pistols-icons.png" >/dev/null 2>&1
agent-browser press 1 && sleep 0.8
echo "after deagle buy: $(agent-browser eval "const s = window.__cs2hud; JSON.stringify({money: s.money, inv: s.inventory})" 2>/dev/null | head -c 220)"

# network: icon resources (accepted 404 -> staging 200)
agent-browser eval "performance.getEntriesByType('resource').filter(r => r.name.includes('/icons/')).map(r => r.name.split('/').pop() + ':' + r.responseStatus).join(' ')" 2>/dev/null | head -c 400
echo ""

# RIFLES page 1 + 2 (11 entries paged)
agent-browser press b && sleep 0.6     # close
agent-browser press b && sleep 0.6     # reopen at root
agent-browser press 4 && sleep 1.2
agent-browser screenshot "$SHOTS/02-rifles-page1.png" >/dev/null 2>&1
agent-browser press 0 && sleep 0.8
agent-browser screenshot "$SHOTS/03-rifles-page2.png" >/dev/null 2>&1

# EQUIPMENT (gear + grenades icons)
agent-browser press b && sleep 0.6
agent-browser press b && sleep 0.6
agent-browser press 6 && sleep 1.2
agent-browser screenshot "$SHOTS/04-equipment-icons.png" >/dev/null 2>&1
agent-browser press b && sleep 0.5

# page errors (ignore the pre-existing human.glb 404 fallback)
agent-browser console 2>/dev/null | rg -i "error" | rg -v "human.glb" | head -5
echo "DONE"

kill $GS 2>/dev/null
