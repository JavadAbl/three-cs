#!/bin/bash
# Deterministic FX verification during freeze phase (bots don't shoot).
OUT=/home/z/my-project

hide() {
  agent-browser eval "(() => { if (!document.getElementById('hide-ui-style')) { const s = document.createElement('style'); s.id='hide-ui-style'; s.textContent='div.pointer-events-auto.absolute.inset-0.z-50{display:none !important}'; document.head.appendChild(s); } return 'ok' })()" >/dev/null 2>&1
}

state() {
  agent-browser eval "window.__eng ? JSON.stringify(window.__eng.state()) : 'x'" 2>/dev/null | tail -1
}

wait_freeze() {
  for i in $(seq 1 180); do
    s=$(state)
    echo "$s" | rg -q 'freeze' && echo "$s" | rg -q 'alive.{0,3}true' && return 0
    sleep 1
  done
  return 1
}

hide

# ---- window 1: explosion ----
if wait_freeze; then
  agent-browser eval "window.__eng.teleport(1, 0, -2, 0)" >/dev/null 2>&1
  agent-browser eval "window.__eng.fxdemo()" >/dev/null 2>&1
  agent-browser screenshot "$OUT/shot-v5c-fx-explosion.png" >/dev/null 2>&1
  sleep 2.2
  agent-browser screenshot "$OUT/shot-v5c-fx-smoke.png" >/dev/null 2>&1
  echo "explosion shots taken"
else
  echo "no freeze window"; exit 1
fi

# ---- window 2: decals on mid doors wall ----
if wait_freeze; then
  agent-browser eval "window.__eng.teleport(2, 0, -5.5, 0)" >/dev/null 2>&1
  agent-browser eval "window.__eng.fxdemo()" >/dev/null 2>&1
  agent-browser screenshot "$OUT/shot-v5c-fx-decals.png" >/dev/null 2>&1
  echo "decal shots taken"
else
  echo "no second freeze window"; exit 1
fi
echo "FX TOUR DONE"
