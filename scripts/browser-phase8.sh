#!/bin/bash
# Phase 8 browser E2E — EQUIPMENT menu (B→6) with the full utility belt,
# keyboard grenade buys, slot-5 cycling, RMB underhand lob (self-flash
# whiteout read off __cs2hud.flash), LMB full throw of the smoke, and the
# volumetric cloud on screen.
# NOTE: keyboard buys do NOT close the CS 1.6 menu — buy flash (4) + smoke (6)
# in ONE menu session, then toggle B once to close. Synthetic clicks need a
# lock-acquisition click first (onMouseDown gates on pointerLocked).
set -u
SHOTS=/tmp/p8-shots
mkdir -p "$SHOTS"
cd /home/z/my-project
pkill -f "bun index\.ts" 2>/dev/null
sleep 0.5
cd mini-services/game-server
bun index.ts > /tmp/gs-p8b.log 2>&1 &
GS=$!
cd /home/z/my-project
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3003/socket.io/?EIO=4&transport=polling" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 0.5
done
echo "game-server up ($code)"

agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 6
CTBTN=$(agent-browser snapshot -i 2>/dev/null | rg "COUNTER" | rg -o "e[0-9]+" | head -1)
[ -n "$CTBTN" ] && agent-browser click @$CTBTN >/dev/null 2>&1
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1)
agent-browser click @$PLAY >/dev/null 2>&1 && echo "joined CT"
for i in $(seq 1 25); do
  PH=$(agent-browser eval "window.__eng ? window.__eng.state().phase : 'noeng'" 2>/dev/null | tr -d '"')
  [ "$PH" = "freeze" ] && break
  sleep 1
done
echo "phase=$PH"

# ONE menu session: B → 6 (EQUIPMENT) → screenshot → flash (4) → smoke (6)
agent-browser press b && sleep 0.8
agent-browser press 6 && sleep 1.0
agent-browser screenshot "$SHOTS/01-equipment-menu.png" >/dev/null 2>&1
agent-browser press 4 && sleep 0.7        # flash  $200 (menu stays open)
agent-browser press 6 && sleep 0.7        # smoke  $300
agent-browser press b && sleep 0.5        # toggle the menu CLOSED
echo "belt: $(agent-browser eval "const s = window.__cs2hud; JSON.stringify({money: s.money, inv: s.inventory})" 2>/dev/null | head -c 200)"

# wait for live — bots come hunting, so move fast from here on
for i in $(seq 1 30); do
  PH=$(agent-browser eval "window.__eng.state().phase" 2>/dev/null | tr -d '"')
  [ "$PH" = "live" ] && break
  sleep 1
done

# synthetic clicks need pointer lock first: click #1 only acquires it
agent-browser mouse move 640 360 >/dev/null 2>&1
agent-browser mouse down left >/dev/null 2>&1
agent-browser mouse up left >/dev/null 2>&1
sleep 0.8

# SMOKE FIRST (bots hunt fast — the cloud is world fx and outlives us):
# slot 5 cycles held grenades: flash → smoke (bought in that order)
agent-browser press 5 && sleep 0.35
agent-browser press 5 && sleep 0.35
echo "slot5 weapon: $(agent-browser eval "window.__cs2hud.weapon" 2>/dev/null | tr -d '"')"
agent-browser mouse down left >/dev/null 2>&1
agent-browser mouse up left >/dev/null 2>&1
sleep 2.6
agent-browser screenshot "$SHOTS/03-smoke-cloud.png" >/dev/null 2>&1
sleep 4
agent-browser screenshot "$SHOTS/04-smoke-cloud-late.png" >/dev/null 2>&1
echo "alive after smoke: $(agent-browser eval "window.__cs2hud.alive" 2>/dev/null | tr -d '"')"

# then the flash: slot 5 cycles back to it, RMB = underhand lob → close-range pop
# (self-blind; bots may finish us afterwards — the cloud shots are already taken)
agent-browser press 5 && sleep 0.35
echo "slot5 now: $(agent-browser eval "window.__cs2hud.weapon" 2>/dev/null | tr -d '"')"
agent-browser mouse down right >/dev/null 2>&1
agent-browser mouse up right >/dev/null 2>&1
# flash fuse 1.6s → poll the whiteout intensity off the HUD state
for i in $(seq 1 16); do
  FL=$(agent-browser eval "window.__cs2hud.flash" 2>/dev/null | tr -d '"')
  [ -n "$FL" ] && [ "$FL" != "0" ] && [ "$FL" != "null" ] && [ "$FL" != "undefined" ] && break
  sleep 0.25
done
echo "flash whiteout: $FL"
agent-browser screenshot "$SHOTS/02-flash-whiteout.png" >/dev/null 2>&1
echo "post-throw: $(agent-browser eval "window.__cs2hud.inventory" 2>/dev/null | tr -d '"' | head -c 120)"

# page errors
echo "console errors: $(agent-browser console 2>/dev/null | rg -i 'error' | rg -v 'human.glb|404' | head -3 | wc -l)"

kill $GS 2>/dev/null
echo "done — shots in $SHOTS"
