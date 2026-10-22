#!/bin/bash
# Task 81: in-game verification of the preload pipeline.
#   cold: clear the IndexedDB asset store, join dust2, capture the loading
#         bar mid-flight, then dump __assetCache stats + [preload] timing +
#         pbrState/audio settle AFTER the bar lifts.
#   warm: play again — the preload must sweep to 100% in ~seconds with
#         stats.hits >> stats.net ("SERVED FROM CACHE").
# Usage: verify-preloader.sh cold|warm <shot-prefix>
set -u
MODE="${1:-cold}"
PRE="${2:-pre}"
ROOT=/home/z/my-project

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1 || agent-browser reload >/dev/null 2>&1 || true
sleep 8

if [ "$MODE" = "cold" ]; then
  # WIPE SAFELY: deleteDatabase BLOCKS (and wedges the origin's whole IDB
  # queue) while any app page holds an IDB connection. The persistent store
  # is now the CACHE API (three-cs-assets-*), wiped via caches.delete(); the
  # IDB delete is kept for hygiene on a connection-free page. All deletes run
  # from a static same-origin page that loads no game JS.
  agent-browser open "http://localhost:81/assets/textures/maps/sources.json" >/dev/null 2>&1
  sleep 1
  agent-browser eval "caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return k.indexOf('three-cs-assets-')===0?caches.delete(k):Promise.resolve()}))}).then(function(){return new Promise(function(res){var r=indexedDB.deleteDatabase('three-cs-assets');r.onsuccess=res;r.onerror=res;r.onblocked=res})}).then(function(){return 'cache wiped cleanly'})" 2>&1 | tail -1
  agent-browser open http://localhost:81/ >/dev/null 2>&1
  sleep 8
fi

# join: dust2 map tile, TERRORIST, PLAY
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST2" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: dust2"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "play clicked"

# the bar: 4 rapid screenshots — cold runs take seconds, we should catch motion
for i in 1 2 3 4; do
  sleep 0.7
  agent-browser screenshot "$ROOT/download/${PRE}-bar-${i}.png" >/dev/null 2>&1 && echo "bar shot $i"
done

# wait for the bar to lift (loadPhase cleared → HUD/pause shows)
agent-browser wait --fn "document.body && (window.__eng ? (document.body.innerText.toUpperCase().includes('RESUME') || document.body.innerText.toUpperCase().includes('BUY')) : false)" --timeout 210000 >/dev/null 2>&1 || echo "WARN: bar still up after 210s"
sleep 2
agent-browser screenshot "$ROOT/download/${PRE}-loaded.png" >/dev/null 2>&1 && echo "loaded shot"

# dump the evidence
agent-browser eval "JSON.stringify({cache:(window.__assetCache?{version:window.__assetCache.version,stats:window.__assetCache.stats}:null), pbr:(window.__pbrState||null), audio:(window.__eng?window.__eng.state().audioInfo||null:null)})" -o "$ROOT/scripts/${PRE}-stats.json" >/dev/null 2>&1 || \
  agent-browser eval "JSON.stringify({cache:(window.__assetCache?{version:window.__assetCache.version,stats:window.__assetCache.stats}:null), pbr:(window.__pbrState||null)})" 2>/dev/null > "$ROOT/scripts/${PRE}-stats.json"
echo "stats: $(head -c 400 "$ROOT/scripts/${PRE}-stats.json")"
