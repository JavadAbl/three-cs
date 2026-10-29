#!/bin/bash
# Task 141 live E2E v2 — capture console/errors + more phases + generous window.
set -u
cd /home/z/my-project

agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 6
agent-browser console --clear >/dev/null 2>&1
agent-browser errors --clear >/dev/null 2>&1

SNAP=$(agent-browser snapshot -i 2>/dev/null || true)
OFFICE=$(echo "$SNAP" | rg -i "OFFICE CS 1.6" | rg -o "e[0-9]+" | head -1)
CT=$(echo "$SNAP" | rg "COUNTER-T" | rg -o "e[0-9]+" | head -1)
PLAY=$(echo "$SNAP" | rg 'button "▶ PLAY"' | rg -o "e[0-9]+" | head -1)
echo "refs: office=$OFFICE ct=$CT play=$PLAY"
[ -n "$OFFICE" ] && agent-browser click @$OFFICE >/dev/null 2>&1 && echo "map: office"
[ -n "$CT" ] && agent-browser click @$CT >/dev/null 2>&1 && echo "team: CT"
sleep 1
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "play clicked"

for i in $(seq 1 36); do
  sleep 5
  P=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'no-engine'" 2>/dev/null | tail -1 | tr -d '"')
  [ $((i % 3)) -eq 0 ] && echo "poll$i: $P"
  case "$P" in
    live|playing) echo "poll$i: $P"; break ;;
  esac
done

echo "=== errors:"
agent-browser errors 2>/dev/null | head -15
echo "=== console tail:"
agent-browser console 2>/dev/null | tail -15
echo "=== final phase:"
agent-browser eval "window.__eng ? JSON.stringify({phase: window.__eng.state().phase, pos: window.__eng.state().pos}) : 'no-engine'" 2>/dev/null | tail -1
