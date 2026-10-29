#!/bin/bash
set -u
# menu must already be open at the RIFLES page (cat persists while open)
BOUGHT=0
for i in $(seq 1 400); do
  OPEN=$(agent-browser eval "document.body.innerText.includes('Buy time is OPEN')" 2>/dev/null | tr -d '"')
  if [ "$OPEN" = "true" ]; then
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'8',code:'Digit8',bubbles:true})); return 1;})()" >/dev/null 2>&1
    W=$(agent-browser eval "window.__eng.state().weapon" 2>/dev/null | tr -d '"')
    if echo "$W" | rg -q "aug"; then echo "iter $i: AUG IN HAND"; BOUGHT=1; break; fi
  fi
  sleep 0.3
done
echo "bought=$BOUGHT"
