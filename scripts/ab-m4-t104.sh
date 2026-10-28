#!/bin/bash
# Task 104: live eval of the user's M4A4 replacement (staged m4.glb model +
# replaced m4_fire.ogg). Dust (bright — the near-black rifle reads best),
# CT team, warmup buy, vm + fire + reload + sound proofs.
set -u
PREFIX="$1"

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

# wait for the weapon GLB preload to include m4 (state 'ready')
agent-browser wait --fn "window.__eng && window.__eng.wglb && window.__eng.wglb()['m4'] === 'ready'" --timeout 30000 >/dev/null 2>&1 \
  && echo "m4 model: ready" || echo "WARN: m4 GLB not ready"
sleep 1

# ---- buy M4A4 during warmup (warmup buys always work — Task 66 lesson) ----
agent-browser eval "(function(){
  var d=document; function key(k){ d.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true})); }
  key('b'); return 'b pressed';
})()" >/dev/null 2>&1
sleep 1.2
echo "--- buy menu open ---"
agent-browser snapshot -i 2>/dev/null | rg -i "M4A4|RIFLE|Kevlar|page" | head -8
# rifles category = digit 4 (Task 66: B->4->row)
agent-browser eval "(function(){ document.dispatchEvent(new KeyboardEvent('keydown',{key:'4',bubbles:true})); return '4';})()" >/dev/null 2>&1
sleep 1.2
echo "--- rifle page ---"
agent-browser snapshot -i 2>/dev/null | rg -i "M4A4|M4A1|AUG|FAMAS|AWP|SSG" | head -10
