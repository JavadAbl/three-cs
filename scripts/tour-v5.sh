#!/bin/bash
# Screenshot tour of the v5 visual overhaul — takes shots while alive,
# waits for next round spawn if killed mid-tour.
OUT=/home/z/my-project
declare -a LOCATIONS=(
  "b-site|-34,0,-28,3.14"
  "t-spawn|0,0,40,3.14"
  "mid-top|0,0,24,0"
  "mid-doors|0,0,-14,0"
  "long-doors|34,0,14,0"
  "a-site|20,2,-30,0"
  "tunnels|-30,0,10,0"
  "ct-spawn|-8,0,-40,0"
  "cat-top|14.5,2,-24,0"
  "window-room|-16,0,-17.5,-1.57"
  "b-doors|-18,0,-24,0"
  "long-lane|35,0,-12,0"
)

alive() {
  agent-browser eval "window.__eng ? window.__eng.state().alive : false" 2>/dev/null | tail -1
}

# hide pause/buy overlays (pointer lock fails in headless → menu always open → blur)
hideOverlays() {
  agent-browser eval "(() => { if (!document.getElementById('hide-ui-style')) { const s = document.createElement('style'); s.id='hide-ui-style'; s.textContent = 'div.pointer-events-auto.absolute.inset-0.z-50{display:none !important}'; document.head.appendChild(s); } return 'ok' })()" >/dev/null 2>&1
}

wait_alive() {
  for i in $(seq 1 40); do
    if [ "$(alive)" = "true" ]; then return 0; fi
    sleep 4
  done
  return 1
}

for entry in "${LOCATIONS[@]}"; do
  name="${entry%%|*}"
  pos="${entry##*|}"
  if ! wait_alive; then echo "TIMEOUT waiting for alive ($name)"; exit 1; fi
  agent-browser eval "window.__eng.teleport($pos)" >/dev/null 2>&1
  sleep 0.8
  hideOverlays
  agent-browser screenshot "$OUT/shot-v5b-$name.png" >/dev/null 2>&1
  echo "shot: $name (alive=$(alive))"
done
echo "TOUR COMPLETE"
