#!/bin/bash
# Task 106: wait for the next round freeze, buy AUG (B -> 4 -> 8), verify.
set -u
# close the browsing-only menu first
agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 'esc';})()" >/dev/null 2>&1
sleep 0.5
agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 'esc2';})()" >/dev/null 2>&1
sleep 0.5

echo "waiting for a live round with buy window..."
for i in $(seq 1 90); do
  # buy window check: open menu, read the banner, close if locked
  agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true})); return 'b';})()" >/dev/null 2>&1
  sleep 0.8
  TXT=$(agent-browser eval "document.body.innerText" 2>/dev/null)
  if echo "$TXT" | rg -q "BUY TIME OVER"; then
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true})); return 'close';})()" >/dev/null 2>&1
    sleep 5
    continue
  fi
  # buy window open: rifles = 4, AUG = 8
  echo "buy window OPEN at iter $i"
  agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'4',bubbles:true})); return '4';})()" >/dev/null 2>&1
  sleep 1.0
  agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'8',bubbles:true})); return '8';})()" >/dev/null 2>&1
  sleep 1.0
  agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true})); return 'close';})()" >/dev/null 2>&1
  sleep 0.5
  W=$(agent-browser eval "window.__eng.state().weapon" 2>/dev/null)
  echo "weapon now: $W"
  if echo "$W" | rg -q "aug"; then echo "AUG BOUGHT"; break; fi
  # if it failed (e.g. page mismatch), keep polling
  sleep 3
done
