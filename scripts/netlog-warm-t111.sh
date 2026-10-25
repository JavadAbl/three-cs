#!/bin/bash
# Task 111 diagnosis: which URLs go to NETWORK on a WARM (second) run.
# Reloads the app (fresh document, cache already populated), patches a net
# logger ON TOP of the Task-81 wrapper (logger -> t81 wrapper -> real fetch;
# cache-served calls never increment stats.net), plays dust2 T, then dumps
# every URL that caused a net fetch, with sizes where known.
set -u
ROOT=/home/z/my-project

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
sleep 8

# install the logger in the lobby (wrapper is already installed on mount)
agent-browser eval "window.__netlog=[];var o=window.fetch;window.fetch=function(i,n){var b=window.__assetCache?window.__assetCache.stats.net:-1;var u=String(typeof i==='string'?i:(i&&i.url)||i);return o.call(window,i,n).then(function(r){if(window.__assetCache&&window.__assetCache.stats.net>b)window.__netlog.push(u);return r})};'logger installed'" 2>&1 | tail -1

# join dust2 T
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST2" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: dust2"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "play clicked"

# wait for bar lift
agent-browser wait --fn "document.body && (window.__eng ? (document.body.innerText.toUpperCase().includes('RESUME') || document.body.innerText.toUpperCase().includes('BUY')) : false)" --timeout 210000 >/dev/null 2>&1 || echo "WARN: bar still up"
sleep 3

agent-browser eval "JSON.stringify({netlog:window.__netlog, stats:window.__assetCache.stats, persisted:window.__assetCache.persisted()})" -o "$ROOT/scripts/t111-warm2-netlog.json" >/dev/null 2>&1
echo "net count: $(agent-browser eval "window.__netlog.length" 2>/dev/null | tail -1)"
python3 - "$ROOT/scripts/t111-warm2-netlog.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
log = d.get('netlog') or []
print(f"netlog entries: {len(log)}")
from collections import Counter
import re
buckets = Counter()
for u in log:
    m = re.match(r'([^?]+)', u)
    p = m.group(1) if m else u
    for pre in ('/api/assets/weapon/', '/api/assets/human', '/draco/', '/assets/sounds/', '/staging/sounds/', '/assets/textures/'):
        if p.startswith(pre):
            buckets[pre] += 1
            break
    else:
        buckets[p[:50]] += 1
print(json.dumps(d.get('stats'), indent=None))
print("buckets:", dict(buckets))
print("--- full list (first 40):")
for u in log[:40]:
    print(" ", u[:110])
PY
