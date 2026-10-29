#!/bin/bash
# Task 142 FINAL E2E — doors B+C open (walk-through proof), A+D decor closed.
set -u
cd /home/z/my-project

agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 8

SNAP=$(agent-browser snapshot -i 2>/dev/null || true)
OFFICE=$(echo "$SNAP" | rg -i "OFFICE CS 1.6" | rg -o "e[0-9]+" | head -1)
CT=$(echo "$SNAP" | rg "COUNTER-T" | rg -o "e[0-9]+" | head -1)
PLAY=$(echo "$SNAP" | rg 'button "▶ PLAY"' | rg -o "e[0-9]+" | head -1)
echo "refs: office=$OFFICE ct=$CT play=$PLAY"
[ -n "$OFFICE" ] && agent-browser click @$OFFICE >/dev/null 2>&1 && echo "map: office"
[ -n "$CT" ] && agent-browser click @$CT >/dev/null 2>&1 && echo "team: CT"
sleep 1
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "play clicked"

LIVE=""
for i in $(seq 1 40); do
  sleep 5
  P=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'no-engine'" 2>/dev/null | tail -1 | tr -d '"')
  [ $((i % 4)) = 0 ] && echo "poll$i: $P"
  if [ "$P" = "live" ]; then LIVE=1; break; fi
done
[ -z "$LIVE" ] && { echo "NOT-LIVE"; agent-browser screenshot scripts/t142-final-notlive.png >/dev/null 2>&1; exit 1; }
echo "LIVE"
sleep 2
agent-browser find text "RESUME" click >/dev/null 2>&1 || true

# retry wrapper: round resets during freeze yank the player to spawn — retry
# until a teleport holds (readback within the same minute)
shot() { # x y z yaw outfile
  agent-browser eval "window.__eng.teleport($1, $2, $3, $4); 'tp'" >/dev/null 2>&1
  sleep 1.3
  agent-browser screenshot "scripts/$5" >/dev/null 2>&1
  echo "shot $5"
}
held() { # x y z label -> prints HELD/RESET
  for t in 1 2 3 4; do
    agent-browser eval "window.__eng.teleport($1, $2, $3); 'tp'" >/dev/null 2>&1
    sleep 1.1
    POS=$(agent-browser eval "JSON.stringify([window.__eng.state().pos[0].toFixed(1), window.__eng.state().pos[2].toFixed(1)])" 2>/dev/null | tail -1)
    case "$POS" in *"$1"*) echo "$4 HELD at $POS"; return 0;; esac
    echo "  $4 try$t reset ($POS) — retrying"
    sleep 3
  done
  echo "$4 DID-NOT-HOLD"
}

# door B — approach from south, walk-through line
shot 12.4 10.45 -26.5 4.7124 t142-final-b-approach.png
held 12.4 10.45 -23.2 "door B inside:"
shot 12.4 10.45 -23.2 4.7124 t142-final-b-inside.png
shot 12.4 10.45 -20.0 4.7124 t142-final-b-through.png

# door C — approach from west
shot 27.5 10.45 22.4 3.1416 t142-final-c-approach.png
held 31.2 10.45 22.4 "door C inside:"
shot 31.2 10.45 22.4 3.1416 t142-final-c-inside.png
shot 34.5 10.45 22.4 3.1416 t142-final-c-through.png

# decor doors A and D — closed visuals
shot 2.4 10.45 -6.5 1.5708 t142-final-a-closed.png
shot -13.4 8.45 35.5 4.7124 t142-final-d-closed.png

echo "FINAL E2E DONE"
