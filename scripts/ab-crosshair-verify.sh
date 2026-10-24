#!/bin/bash
# Task 102b: verify the crosshair fix — four ticks symmetric around center at
# rest AND while firing (dynamic spread). Writes tick geometry + screenshots.
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
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" >/dev/null 2>&1
agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 90000 >/dev/null 2>&1 || echo "WARN: never live"
sleep 1

echo "--- ticks at rest ---"
agent-browser eval "(function(){
  var c=document.querySelector('div.relative.h-0');
  if(!c) return 'no crosshair';
  var ts=c.querySelectorAll('div');
  var out=[];
  for(var i=0;i<ts.length;i++){var r=ts[i].getBoundingClientRect();
    out.push({i:i,x:Math.round(r.x),y:Math.round(r.y),w:r.width,h:r.height,
      gapFromCenterX:Math.round((r.x<640? 640-(r.x+r.width) : (r.x+r.width<=640?0:r.x-640))*10)/10),
      edge:Math.round((r.x<638? 640-(r.x+r.width) : r.x-640)*10)/10});}
  return JSON.stringify({spread:window.__eng.state().spread, ticks:out});
})()" 2>&1 | tail -2

agent-browser screenshot "$PREFIX-rest.png" >/dev/null 2>&1
echo "shot: $PREFIX-rest.png"

# While firing: glock semi shots ramp recoil spread; measure mid-burst
agent-browser eval "(function(){
  var e=window.__eng; var s=[];
  var id=setInterval(function(){ e.fire(); }, 120);
  window.__xhTimer=id;
  return 'firing burst started';
})()" 2>&1 | tail -1
sleep 1
echo "--- ticks while firing (recoil spread high) ---"
agent-browser eval "(function(){
  var c=document.querySelector('div.relative.h-0');
  var ts=c.querySelectorAll('div');
  var out=[];
  for(var i=0;i<ts.length;i++){var r=ts[i].getBoundingClientRect();
    out.push({i:i,x:Math.round(r.x),y:Math.round(r.y),w:r.width,h:r.height});}
  clearInterval(window.__xhTimer);
  return JSON.stringify({spread:window.__eng.state().spread, ticks:out});
})()" 2>&1 | tail -2

agent-browser screenshot "$PREFIX-fire.png" >/dev/null 2>&1
echo "shot: $PREFIX-fire.png"
