#!/bin/bash
# Task 106: live eval of the AUG replacement (public/assets/models/weapons/aug.glb).
# Dust (bright), CT team, warmup buy, vm probe + auto-fire + screenshots.
set -u
PREFIX="${1:-t106}"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
agent-browser eval "location.reload(); 1" >/dev/null 2>&1
sleep 2
for _ in $(seq 1 50); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

DUST=$(agent-browser snapshot -i 2>/dev/null | rg "DUST$" | rg -o "e[0-9]+" | head -1)
[ -n "$DUST" ] && agent-browser click @$DUST >/dev/null 2>&1 && echo "map: dust"
CT=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER" | rg -o "e[0-9]+" | head -1)
[ -n "$CT" ] && agent-browser click @$CT >/dev/null 2>&1 && echo "team: CT"
P=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1)
[ -n "$P" ] && agent-browser click @$P >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu"
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "WARN: RESUME click failed"
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1

agent-browser wait --fn "window.__eng && window.__eng.wglb && window.__eng.wglb()['aug'] === 'ready'" --timeout 30000 >/dev/null 2>&1 \
  && echo "aug model: ready" || echo "WARN: aug GLB not ready"
sleep 1

# ---- buy AUG during warmup (B -> 4 rifles -> AUG row) ----
agent-browser eval "(function(){ document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true})); return 'b';})()" >/dev/null 2>&1
sleep 1.2
echo "--- buy menu open ---"
agent-browser snapshot -i 2>/dev/null | rg -i "RIFLE|Kevlar|Buy" | head -4
agent-browser eval "(function(){ document.dispatchEvent(new KeyboardEvent('keydown',{key:'4',bubbles:true})); return '4';})()" >/dev/null 2>&1
sleep 1.2
echo "--- rifle page ---"
agent-browser snapshot -i 2>/dev/null | rg -i "AUG|M4|FAMAS|AWP" | head -10
