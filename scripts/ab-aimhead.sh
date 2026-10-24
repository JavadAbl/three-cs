#!/bin/bash
# Task 77: in-game screenshot on the AIM HEADSHOT map (BSP arena), from the
# T spawn vantage (26, 2.45, -3.2) — the spawn faces the arena mid, so no
# teleports/hop-train are needed. Robust to both the old (bare) and new
# (map-scoped) __pbrState keys, so the same script takes BEFORE (shared
# desert set) and AFTER (green aztec set) shots.
# Usage: ab-aimhead.sh <out.png>
set -u
OUT="$1"
ROOT=/home/z/my-project

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
# menu wait: a cold Next compile (fresh session or a src swap) delays first paint
# past any fixed sleep — poll until the menu's map cards render, then click
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

# join: AIM HEADSHOT map + TERRORIST team, then the orange PLAY button
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "AIM HEADSHOT" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

# wait until truly joined: pause overlay (RESUME) is rendered
agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu appeared"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "WARN: RESUME click failed"
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 || echo "WARN: pointer not locked — hiding pause overlay via DOM (world renders regardless)"
# headless pointer-lock is flaky; the pause overlay (bg-black/70 + blur) darkens
# every shot — hide it via DOM for a clean screenshot (React keeps state, the
# inline display:none persists until re-render on state change)
agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

# wait for the PBR hot-swap (old key: bare 'sand'; new: 'aimhead:sand')
agent-browser wait --fn "window.__pbrState && ((window.__pbrState['aimhead:sand']) || window.__pbrState.sand) === 'ready'" --timeout 25000 >/dev/null 2>&1 || echo "WARN: pbr sand not ready"
sleep 1.5

POS=$(agent-browser eval "JSON.stringify(window.__eng.state().pos)" 2>/dev/null | tr -d '"' || echo "?")
echo "pos at shot: $POS"
agent-browser screenshot "$OUT" >/dev/null 2>&1
echo "shot: $OUT"
