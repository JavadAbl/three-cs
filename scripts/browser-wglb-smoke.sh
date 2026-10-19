#!/bin/bash
# Browser smoke test for the staged weapon GLBs (Task 53):
#   1. lobby warm-up fetches all 33 weapon GLBs (all states must be 'ready')
#   2. join CT, wait for freeze, verify a remote bot renders the GLB gun
#   3. switch to knife -> GLB bayonet viewmodel replaces procedural
#   4. screenshots for eyeball verification
set -u
SHOTS=/tmp/wglb-shots
mkdir -p "$SHOTS"
cd /home/z/my-project
pkill -f "bun index\.ts" 2>/dev/null
sleep 0.5
cd mini-services/game-server
bun index.ts > /tmp/gs-wglb.log 2>&1 &
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
# lobby dwell = warm-up window
for i in $(seq 1 15); do
  READY=$(agent-browser eval "
    window.__weapongltf_probe = (window.__eng ? null : null);
    'awaiting'" 2>/dev/null | tr -d '"' )
  # probe module state through the engine once in-game; in lobby just wait
  agent-browser eval "performance.getEntriesByType('resource').filter(r => r.name.includes('/api/assets/weapon/')).length" 2>/dev/null | tr -d '\n' | xargs -I{} echo "weapon route fetches so far: {}"
  sleep 1
  N=$(agent-browser eval "performance.getEntriesByType('resource').filter(r => r.name.includes('/api/assets/weapon/')).length" 2>/dev/null | tr -d '"\n ')
  [ "${N:-0}" -ge 33 ] 2>/dev/null && break
done
echo "route fetches: ${N:-0}"

CTBTN=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER" | rg -o "e[0-9]+" | head -1)
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1)
agent-browser click @$PLAY >/dev/null 2>&1 && echo "joined CT"
PH=no
for i in $(seq 1 25); do
  PH=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'noeng'" 2>/dev/null | tr -d '"')
  [ "$PH" = "freeze" ] && break
  sleep 1
done
echo "phase=$PH"

echo "--- wglb states (per weapon id):"
agent-browser eval "JSON.stringify(window.__eng.wglb())" 2>/dev/null | head -c 1000
echo ""
echo "--- ready count:"
agent-browser eval "Object.values(window.__eng.wglb()).filter(s => s === 'ready').length" 2>/dev/null

# remote bot guns: gunParts > 1 means the GLB group (RootNode+mesh) replaced
# the procedural stub; meshWorld presence is the stronger check
echo "--- remote players (w / gunParts):"
agent-browser eval "JSON.stringify(window.__eng.players().map(p => ({id: p.id.slice(0,6), w: p.w, parts: p.gunParts})))" 2>/dev/null | head -c 500
echo ""

# knife viewmodel: switch to knife (slot 3 in CS 1.6 keys) and screenshot
agent-browser press 3 && sleep 1
echo "--- vm parts after knife switch (GLB knife = 2 children: bayonet + gloves):"
agent-browser eval "window.__eng.vm().parts" 2>/dev/null
agent-browser screenshot "$SHOTS/knife-vm.png" >/dev/null 2>&1
sleep 1
agent-browser screenshot "$SHOTS/knife-vm2.png" >/dev/null 2>&1

echo "--- screenshots in $SHOTS"
ls -la "$SHOTS" 2>/dev/null | tail -3

kill $GS 2>/dev/null
echo done
