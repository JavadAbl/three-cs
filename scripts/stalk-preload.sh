#!/bin/bash
# Task 81 debugger: run the cold flow and STALK it — every 2 s sample the bar
# text + cache stats; when the progress number stops moving across 3 samples,
# probe the failing layer live (raw fetch / fresh IDB open / wrapper state).
# Usage: stalk-preload.sh <shot-prefix>
set -u
PRE="${1:-stalk}"
ROOT=/home/z/my-project

agent-browser close --all >/dev/null 2>&1
sleep 1
# cold state via the safe static-page wipe
agent-browser open "http://localhost:81/assets/textures/maps/sources.json" >/dev/null 2>&1
sleep 1
agent-browser eval "new Promise(function(res){var r=indexedDB.deleteDatabase('three-cs-assets');r.onsuccess=res;r.onerror=res;r.onblocked=res}).then(function(){return 'wiped'})" >/dev/null 2>&1
agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 8

# join
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST2" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "play"

# stalk: pct of the bar + stats, every 2 s; freeze = same pct 3×
LASTP="init"; SAME=0
for i in $(seq 1 45); do
  sleep 2
  SAMPLE=$(agent-browser eval "(function(){var m=document.body.innerText.match(/([0-9]{1,3})%/);var t=document.body.innerText.match(/LOADING TEXTURES · ([0-9]+)\/([0-9]+)|LOADING MODELS · ([0-9]+)\/([0-9]+)|LOADING SOUNDS · ([0-9]+)\/([0-9]+)|(PREPARING|DECODING|COMPILING)[^\n]*|READY[^\n]*|SERVED[^\n]*/);var bar=document.body.innerText.includes('LOADING')&&!document.body.innerText.includes('RESUME');return JSON.stringify({pct:m?m[1]:'none',line:t?t[0]:'none',bar:bar})})()" 2>/dev/null | tail -1)
  PCT=$(echo "$SAMPLE" | rg -o '"pct":"[^"]*"' | head -1)
  echo "t=$((i*2))s $SAMPLE"
  if [ "$PCT" = "$LASTP" ]; then SAME=$((SAME+1)); else SAME=0; LASTP="$PCT"; fi
  if [ "$SAME" -ge 3 ] && [ "$LASTP" != '"pct":"none"' ]; then
    echo "=== FREEZE DETECTED at $((i*2))s — probing layers ==="
    # 1. raw (wrapper) fetch probe
    agent-browser eval "(function(){var t0=performance.now();return Promise.race([fetch('/assets/textures/maps/metal.jpg').then(function(r){return 'WRAPPED FETCH ok in '+(performance.now()-t0).toFixed(0)+'ms'}),new Promise(function(res){setTimeout(function(){res('WRAPPED FETCH HANGS')},4000)})]).then(function(a){return a})})()" 2>&1 | tail -1
    # 2. fresh IDB open + get probe
    agent-browser eval "new Promise(function(res){var t0=performance.now();var rq=indexedDB.open('three-cs-assets');var to=setTimeout(function(){res('IDB OPEN HANGS')},4000);rq.onsuccess=function(){try{var tx=rq.result.transaction('blobs','readonly');var g=tx.objectStore('blobs').get('x');g.onsuccess=function(){clearTimeout(to);res('IDB ok '+(performance.now()-t0).toFixed(0)+'ms')};g.onerror=function(){clearTimeout(to);res('IDB get err')}}catch(e){clearTimeout(to);res('IDB tx throw')}};rq.onerror=function(){res('IDB open err')}})" 2>&1 | tail -1
    # 3. resource timing: how many asset requests completed
    agent-browser eval "JSON.stringify(performance.getEntriesByType('resource').filter(function(r){return /\/assets\/|\/staging\/|\/draco\/|\/api\/assets\//.test(r.name)}).length)" 2>&1 | tail -1
    # 4. cache stats + a bypass fetch (HMR-dev URL untouched) sanity
    agent-browser eval "JSON.stringify(window.__assetCache?window.__assetCache.stats:null)" 2>&1 | tail -1
    agent-browser screenshot "$ROOT/download/${PRE}-freeze.png" >/dev/null 2>&1
    break
  fi
  if [ "$LASTP" = '"pct":"none"' ]; then echo "bar lifted or never appeared"; break; fi
done
