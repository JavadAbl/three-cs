#!/bin/bash
# Task 141 live E2E — every agent-browser call SHORT (the daemon wedges on long
# waits; poll from the shell instead).
set -u
cd /home/z/my-project

agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 6

SNAP=$(agent-browser snapshot -i 2>/dev/null || true)
OFFICE=$(echo "$SNAP" | rg -i "OFFICE CS 1.6" | rg -o "e[0-9]+" | head -1)
CT=$(echo "$SNAP" | rg "COUNTER-T" | rg -o "e[0-9]+" | head -1)
PLAY=$(echo "$SNAP" | rg 'button "▶ PLAY"' | rg -o "e[0-9]+" | head -1)
echo "refs: office=$OFFICE ct=$CT play=$PLAY"

[ -n "$OFFICE" ] && agent-browser click @$OFFICE >/dev/null 2>&1 && echo "map: office"
[ -n "$CT" ] && agent-browser click @$CT >/dev/null 2>&1 && echo "team: CT"
sleep 1
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "play clicked"

# poll phase from the shell — short evals, 5s apart, up to 150s
LIVE=""
for i in $(seq 1 30); do
  sleep 5
  P=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'no-engine'" 2>/dev/null | tail -1 | tr -d '"')
  echo "poll$i: $P"
  if [ "$P" = "live" ] || [ "$P" = "playing" ]; then LIVE=$P; break; fi
  if [ "$P" = "no-engine" ] && [ $i -gt 6 ]; then echo "engine never appeared"; break; fi
done

if [ -z "$LIVE" ]; then
  echo "NOT-LIVE — screenshot for diagnosis"
  agent-browser screenshot scripts/t141-notlive.png >/dev/null 2>&1 || true
  exit 1
fi

echo "LIVE"
sleep 2
# dismiss pause menu if present (pointer lock in headless can lag)
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "no resume needed"

# teleport straight to the two vantages (yaw: 0=-X, PI/2=-Z, PI=+X, 3PI/2=+Z)
agent-browser eval "window.__eng.teleport(-27.7, 6.05, 44.2, 4.7124)" >/dev/null 2>&1   # face +Z (north fence line)
sleep 1.5
agent-browser screenshot scripts/t141-shot-north.png >/dev/null 2>&1 && echo "shot north"

agent-browser eval "window.__eng.teleport(-27.7, 6.05, 44.2, 3.1416)" >/dev/null 2>&1   # face +X (east entrance)
sleep 1.5
agent-browser screenshot scripts/t141-shot-east.png >/dev/null 2>&1 && echo "shot east"

agent-browser eval "window.__eng.teleport(2, 6.05, 47, 3.1416)" >/dev/null 2>&1          # inside the entrance corridor
sleep 1.5
agent-browser screenshot scripts/t141-shot-corridor.png >/dev/null 2>&1 && echo "shot corridor"
echo DONE
