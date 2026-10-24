#!/bin/bash
# Task 106: fast-poll engine phase; the instant it reads 'freeze', buy AUG.
set -u
echo "polling phase for freeze..."
BOUGHT=0
for i in $(seq 1 240); do
  PH=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'none'" 2>/dev/null | tr -d '"')
  if [ "$PH" = "freeze" ]; then
    echo "iter $i: FREEZE — buying"
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true})); return 1;})()" >/dev/null 2>&1
    sleep 0.4
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'4',bubbles:true})); return 1;})()" >/dev/null 2>&1
    sleep 0.5
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'8',bubbles:true})); return 1;})()" >/dev/null 2>&1
    sleep 0.8
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true})); return 1;})()" >/dev/null 2>&1
    sleep 0.4
    W=$(agent-browser eval "window.__eng.state().weapon" 2>/dev/null | tr -d '"')
    echo "weapon: $W"
    if echo "$W" | rg -q "aug"; then BOUGHT=1; echo "AUG IN HAND"; break; fi
  fi
  sleep 0.5
done
echo "bought=$BOUGHT"
