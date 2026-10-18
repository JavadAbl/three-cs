#!/bin/bash
# Phase 6 browser E2E — shotgun buy menu + nova keyboard buy + one shell
# fired (pellet fan, ammo decrement, pump viewmodel) through the :81 gateway.
set -u
SHOTS=/tmp/p6-shots
mkdir -p "$SHOTS"
cd /home/z/my-project
pkill -f "bun index\.ts" 2>/dev/null
sleep 0.5
cd mini-services/game-server
bun index.ts > /tmp/gs-p6b.log 2>&1 &
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
# join T — proves team flavor both ways (Sawed-Off buyable, MAG-7 greyed)
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1)
agent-browser click @$PLAY >/dev/null 2>&1 && echo "joined T"
for i in $(seq 1 25); do
  PH=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'noeng'" 2>/dev/null | tr -d '"')
  [ "$PH" = "freeze" ] && break
  sleep 1
done
echo "phase=$PH"

# buy menu level 1 → SHOTGUNS (key 2), screenshot the 4-row category
agent-browser press b && sleep 0.7
agent-browser press 2 && sleep 0.9
agent-browser screenshot "$SHOTS/01-shotgun-menu.png" >/dev/null 2>&1
echo "menu rows: $(agent-browser eval "document.querySelectorAll('[data-testid=buyrow], .flex.flex-col button').length" 2>/dev/null | head -1)"

# buy Nova with keys (row 1)
agent-browser press 1 && sleep 1.0
echo "nova: $(agent-browser eval "JSON.stringify(window.__eng.ammo())" 2>/dev/null | head -c 120)"
agent-browser press b && sleep 1.0
agent-browser screenshot "$SHOTS/02-nova-vm.png" >/dev/null 2>&1

# wait for live, then fire ONE shell at the wall (trusted left click)
for i in $(seq 1 30); do
  PH=$(agent-browser eval "window.__eng.state().phase" 2>/dev/null | tr -d '"')
  [ "$PH" = "live" ] && break
  sleep 1
done
agent-browser mouse move 640 360 >/dev/null 2>&1
agent-browser mouse down left >/dev/null 2>&1
agent-browser mouse up left >/dev/null 2>&1
sleep 1.2
echo "after 1 shell: $(agent-browser eval "JSON.stringify(window.__eng.ammo())" 2>/dev/null | head -c 120)"
agent-browser screenshot "$SHOTS/03-nova-fired.png" >/dev/null 2>&1
# mid-pump anim shot (~250ms after the shot would be ideal; late shot still shows the model)
sleep 0.2

# money + inventory state
echo "state: $(agent-browser eval "JSON.stringify({hp: window.__eng.state().hp, w: window.__eng.state().weapon})" 2>/dev/null | head -c 120)"

echo "--- page errors:"
agent-browser errors 2>/dev/null | head -5
kill $GS 2>/dev/null
echo done
