#!/bin/bash
# Task 106: full AUG fire-verification sequence — buy at freeze, close menus,
# relock pointer, auto-fire hold test + screenshots at the first live round.
set -u
BOUGHT=0

# 0) make sure all menus are closed first
agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',bubbles:true})); return 1;})()" >/dev/null 2>&1
sleep 0.3

# 1) wait for freeze of a fresh round (or the current one), buy AUG fast
echo "waiting for freeze..."
for i in $(seq 1 400); do
  PH=$(agent-browser eval "window.__eng.state().phase" 2>/dev/null | tr -d '"')
  if [ "$PH" = "freeze" ]; then
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',bubbles:true})); return 1;})()" >/dev/null 2>&1
    sleep 0.35
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'4',code:'Digit4',bubbles:true})); return 1;})()" >/dev/null 2>&1
    sleep 0.35
    for j in $(seq 1 40); do
      OPEN=$(agent-browser eval "document.body.innerText.includes('Buy time is OPEN')" 2>/dev/null | tr -d '"')
      if [ "$OPEN" = "true" ]; then
        agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'8',code:'Digit8',bubbles:true})); return 1;})()" >/dev/null 2>&1
        W=$(agent-browser eval "window.__eng.state().weapon" 2>/dev/null | tr -d '"')
        if echo "$W" | rg -q "aug"; then echo "iter $i: AUG bought"; BOUGHT=1; break; fi
      fi
      sleep 0.15
    done
    [ "$BOUGHT" = "1" ] && break
    # window closed or round already started — close menu, retry next freeze
    agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',bubbles:true})); return 1;})()" >/dev/null 2>&1
  fi
  sleep 0.4
done
[ "$BOUGHT" = "1" ] || { echo "FAIL: could not buy AUG"; exit 1; }

# 2) close the buy menu (b toggles it closed), verify no menu
agent-browser eval "(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',bubbles:true})); return 1;})()" >/dev/null 2>&1
sleep 0.5
M=$(agent-browser eval "window.__eng.state().menu" 2>/dev/null | tr -d '"')
echo "menu after close: $M"

# 3) wait for live
for i in $(seq 1 60); do
  PH=$(agent-browser eval "window.__eng.state().phase" 2>/dev/null | tr -d '"')
  [ "$PH" = "live" ] && break
  sleep 0.4
done
echo "phase=$PH"

# 4) re-acquire pointer lock via canvas click
agent-browser eval "(function(){ var c=document.querySelector('canvas'); if(c) c.click(); return 1;})()" >/dev/null 2>&1
sleep 1.0
PL=$(agent-browser eval "!!document.pointerLockElement" 2>/dev/null | tr -d '"')
echo "pointerLock=$PL"

# 5) FIRE TEST — hold LMB ~0.9s (expect ~9 rounds at 100ms), release, verify stop
A0=$(agent-browser eval "window.__eng.ammo().ammo.mag" 2>/dev/null | tr -d '"')
agent-browser eval "(function(){ document.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true})); return 1;})()" >/dev/null 2>&1
sleep 0.25
agent-browser screenshot scripts/t106-flash1.png >/dev/null 2>&1
sleep 0.65
A1=$(agent-browser eval "window.__eng.ammo().ammo.mag" 2>/dev/null | tr -d '"')
agent-browser eval "(function(){ document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true})); return 1;})()" >/dev/null 2>&1
sleep 0.5
A2=$(agent-browser eval "window.__eng.ammo().ammo.mag" 2>/dev/null | tr -d '"')
echo "FIRE: mag $A0 -> $A1 (held) -> $A2 (after release)"
agent-browser screenshot scripts/t106-afterfire.png >/dev/null 2>&1

# 6) another short burst + mid-fire screenshot
sleep 0.5
agent-browser eval "(function(){ document.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true})); return 1;})()" >/dev/null 2>&1
sleep 0.2
agent-browser screenshot scripts/t106-flash2.png >/dev/null 2>&1
sleep 0.3
agent-browser eval "(function(){ document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true})); return 1;})()" >/dev/null 2>&1
A3=$(agent-browser eval "window.__eng.ammo().ammo.mag" 2>/dev/null | tr -d '"')
echo "BURST2: mag now $A3"
echo "DONE"
