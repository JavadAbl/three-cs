#!/bin/bash
# Phase 5 browser E2E — focused pass: M4A1-S suppressor viewmodel + SSG 08
# 2-level scope with fov assertions (trusted right-mouse via agent-browser).
set -u
SHOTS=/tmp/p5-shots2
mkdir -p "$SHOTS"
cd /home/z/my-project
pkill -f "bun index\.ts" 2>/dev/null
sleep 0.5
cd mini-services/game-server
bun index.ts > /tmp/gs-p5b.log 2>&1 &
GS=$!
cd /home/z/my-project
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3003/socket.io/?EIO=4&transport=polling" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 0.5
done
echo "game-server up ($code)"

agent-browser reload >/dev/null 2>&1
sleep 4
CT=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER-T" | rg -o "e[0-9]+" | head -1)
[ -n "$CT" ] && agent-browser click @$CT >/dev/null 2>&1
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1)
agent-browser click @$PLAY >/dev/null 2>&1 && echo "joined CT"
for i in $(seq 1 25); do
  PH=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'noeng'" 2>/dev/null | tr -d '"')
  [ "$PH" = "freeze" ] && break
  sleep 1
done
echo "phase=$PH"

# buy M4A1-S (B → 4 rifles → 3 m4a1s)
agent-browser press b && sleep 0.7
agent-browser press 4 && sleep 0.7
agent-browser press 3 && sleep 0.9
echo "m4a1s: $(agent-browser eval "JSON.stringify(window.__eng.ammo())" 2>/dev/null | head -c 90)"
agent-browser press b && sleep 1.0
agent-browser screenshot "$SHOTS/01-m4a1s-vm.png" >/dev/null 2>&1
echo "fov after close: $(agent-browser eval "window.__eng.state().fov" 2>/dev/null | head -1)"

# buy SSG 08 (B → 4 → 8)
agent-browser press b && sleep 0.7
agent-browser press 4 && sleep 0.7
agent-browser press 8 && sleep 0.9
echo "ssg08: $(agent-browser eval "JSON.stringify(window.__eng.ammo())" 2>/dev/null | head -c 90)"
agent-browser press b && sleep 1.0

# scope: trusted right-clicks (agent-browser mouse), fov asserts between
agent-browser mouse move 640 360 >/dev/null 2>&1
agent-browser mouse down right >/dev/null 2>&1; agent-browser mouse up right >/dev/null 2>&1
sleep 1.2
echo "scope1: $(agent-browser eval "JSON.stringify({fov: window.__eng.state().fov, lvl: window.__eng.state().scopeLevel})" 2>/dev/null | head -1)"
agent-browser screenshot "$SHOTS/02-ssg-scope1.png" >/dev/null 2>&1
agent-browser mouse down right >/dev/null 2>&1; agent-browser mouse up right >/dev/null 2>&1
sleep 1.2
echo "scope2: $(agent-browser eval "JSON.stringify({fov: window.__eng.state().fov, lvl: window.__eng.state().scopeLevel})" 2>/dev/null | head -1)"
agent-browser screenshot "$SHOTS/03-ssg-scope2.png" >/dev/null 2>&1
# third right-click: back to hip (0 → 1 → 2 → 0)
agent-browser mouse down right >/dev/null 2>&1; agent-browser mouse up right >/dev/null 2>&1
sleep 1.0
echo "scope3 (should be hip): $(agent-browser eval "JSON.stringify({fov: window.__eng.state().fov, lvl: window.__eng.state().scopeLevel})" 2>/dev/null | head -1)"

echo "--- page errors:"
agent-browser errors 2>/dev/null | head -3
kill $GS 2>/dev/null
echo done