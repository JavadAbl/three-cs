#!/bin/bash
# Task 102b: diagnose the reported broken weapon aiming pointer (crosshair).
# Join AIM DEPOT, resume, screenshot center, dump crosshair DOM + engine spread.
set -u
PREFIX="$1"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
agent-browser eval "location.reload(); 1" >/dev/null 2>&1
sleep 2
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "AIM DEPOT" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim depot"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu"
agent-browser find text "RESUME" click >/dev/null 2>&1 || echo "WARN: RESUME click failed"
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

sleep 2
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 90000 >/dev/null 2>&1 || echo "WARN: never live"
sleep 1

# ---- crosshair state ----
echo "--- engine state ---"
agent-browser eval "JSON.stringify(window.__eng.state())" 2>&1 | tail -1

echo "--- crosshair DOM ---"
agent-browser eval "(function(){
  // the crosshair container is the div at left-1/2 top-1/2 with 4 green ticks
  var all=document.querySelectorAll('div');
  var out=[];
  for (var i=0;i<all.length;i++){
    var d=all[i];
    if(d.className && d.className.indexOf && d.className.toString().indexOf('left-1/2')>=0 && d.className.toString().indexOf('top-1/2')>=0){
      var r=d.getBoundingClientRect();
      out.push({cls:d.className.toString().slice(0,80), cx:r.x+r.width/2, cy:r.y+r.height/2, w:r.width, h:r.height, children:d.childElementCount});
    }
  }
  var ticks=document.querySelectorAll('div.bg-\\[\\#3cff5e\\]').length;
  return JSON.stringify({candidates:out.slice(0,6), greenTicks:ticks, vw:innerWidth, vh:innerHeight});
})()" 2>&1 | tail -1

echo "--- screenshots ---"
agent-browser screenshot "$PREFIX-center.png" >/dev/null 2>&1
echo "shot: $PREFIX-center.png"

# fire 3 shots to see spread behaviour, then screenshot again
agent-browser eval "(function(){
  var e=window.__eng; if(!e) return 'no eng';
  // simulate LMB presses through the engine's own handlers if exposed; else mouse events
  return 'spread now: '+JSON.stringify(e.state().spread);
})()" 2>&1 | tail -1
