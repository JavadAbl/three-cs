#!/bin/bash
# Browser smoke test for FIRST-PERSON GUN viewmodels from the staged GLBs
# (Task 54 — user: "but in first person camera i see old models in hand"):
#   1. lobby warm-up fetches all 33 weapon GLBs (all states must be 'ready')
#   2. join CT: spawn pistol (usp) vm must be the GLB branch (vmGlb='usp')
#   3. buy m4a1s (B → 4 → 3): long-gun vm must be the GLB branch (vmGlb='m4a1s')
#   4. press 3: knife vm still GLB (Task 53 regression)
#   5. remote bot guns still GLB (Task 53 regression)
#   6. screenshots of all three for VLM eyeball verification
#
# HEADLESS CAVEAT: requestPointerLock silently fails in the headless browser,
# so the pause overlay (gated on !pointerLocked in hud.tsx) never clears by
# itself. It's a real-browser-only nuisance — here we hide it via CSS before
# each screenshot (screenshot-only; no game state touched).
set -u
SHOTS=/tmp/wglb2-shots
hidepause() {
  # full-screen blurred overlays only (the pause menu is absolute inset-0
  # backdrop-blur-sm; plain panels must not be touched)
  agent-browser eval "[...document.querySelectorAll('div.absolute.inset-0.backdrop-blur-sm')].forEach(e => e.style.display = 'none'); 'ok'" 2>/dev/null
}
mkdir -p "$SHOTS"
cd /home/z/my-project
pkill -f "bun index\.ts" 2>/dev/null
sleep 0.5
cd mini-services/game-server
bun index.ts > /tmp/gs-wglb2.log 2>&1 &
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
for i in $(seq 1 15); do
  N=$(agent-browser eval "performance.getEntriesByType('resource').filter(r => r.name.includes('/api/assets/weapon/')).length" 2>/dev/null | tr -d '"\n ')
  [ "${N:-0}" -ge 33 ] 2>/dev/null && break
  sleep 1
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

echo "--- wglb ready count (want 33):"
agent-browser eval "Object.values(window.__eng.wglb()).filter(s => s === 'ready').length" 2>/dev/null

echo "--- spawn vm (want glb=usp parts=8 w=usp):"
agent-browser eval "JSON.stringify({glb: window.__eng.vmGlb(), ...window.__eng.vm()})" 2>/dev/null
hidepause
agent-browser screenshot "$SHOTS/01-usp-vm.png" >/dev/null 2>&1

# buy m4a1s (B → 4 rifles → 3 m4a1s) — staged long gun with support hand
agent-browser press b && sleep 0.7
agent-browser press 4 && sleep 0.7
agent-browser press 3 && sleep 1.0
agent-browser press b && sleep 1.0
echo "--- m4a1s vm (want glb=m4a1s parts=12 w=m4a1s):"
agent-browser eval "JSON.stringify({glb: window.__eng.vmGlb(), ...window.__eng.vm()})" 2>/dev/null
hidepause
agent-browser screenshot "$SHOTS/02-m4a1s-vm.png" >/dev/null 2>&1

# knife (Task 53 regression)
agent-browser press 3 && sleep 1
echo "--- knife vm (want glb=knife parts=8):"
agent-browser eval "JSON.stringify({glb: window.__eng.vmGlb(), ...window.__eng.vm()})" 2>/dev/null
hidepause
agent-browser screenshot "$SHOTS/03-knife-vm.png" >/dev/null 2>&1

# remote bot guns (Task 53 regression): gunParts=1 → GLB group replaced stub
echo "--- remote players (w / gunParts / glb):"
agent-browser eval "JSON.stringify(window.__eng.players().map(p => ({id: p.id.slice(0,6), w: p.w, parts: p.gunParts, glb: p.glb})))" 2>/dev/null | head -c 600
echo ""

echo "--- screenshots in $SHOTS"
ls -la "$SHOTS" | tail -8
kill $GS 2>/dev/null
echo done
