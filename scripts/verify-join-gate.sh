#!/bin/bash
# Task 82: in-game verification — match entry must be GATED behind the
# loading bar. While the bar is up the client must not join the room, and
# the server keeps unjoined matches dormant ('warmup': no startRound, no bot
# ticks) — so ZERO room events ('init'/'round'/'shot'/...) may arrive before
# the bar lifts. After lift the match must run normally (bots fire within
# the observation window — the gate delays gameplay, never disables it).
#
# Designed to run on BOTH old and new code (A/B): the bar is detected by its
# LOADING-text overlay (old code has no data-loading attr), and the socket
# sniffer uses the public onAny API. Old code verdict: GATE-FAIL with room
# events (incl. bot shots) streaming DURING the load — the reported bug.
# Usage: verify-join-gate.sh <label:new|old>
set -u
ROOT=/home/z/my-project
LABEL="${1:-new}"
LOG="$ROOT/scripts/joingate-$LABEL.json"
mkdir -p "$ROOT/download"

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1 || agent-browser reload >/dev/null 2>&1 || true
sleep 7

# lobby funnel (same as Task 80): NORMAL bots, DUST2, TERRORIST
agent-browser eval "(function(){var s=document.querySelector('select'); if(!s) return 'no select'; var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,'normal'); s.dispatchEvent(new Event('change',{bubbles:true})); return 'difficulty='+s.value})()" 2>&1 | tail -1
MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "DUST2" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: dust2"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: terrorist"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "▶ PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

# Arm the recorder IMMEDIATELY after PLAY — before any join can flow.
# __eng is assigned inside start() BEFORE connect(), so once __eng exists the
# hook is live before the first room event. The bar tracker polls the
# LOADING overlay by text so old/new code are both covered.
agent-browser eval "(function(){
  window.__gate = { hookAt: null, events: [], barUp: null, barLift: null, note: '' };
  var G = window.__gate;
  var findBar = function(){
    var divs = Array.prototype.slice.call(document.querySelectorAll('div'));
    for (var i=0;i<divs.length;i++){ var t=(divs[i].innerText||'').trim();
      if (t.indexOf('LOADING')===0 && t.indexOf('%')>0) return divs[i]; }
    return null; };
  setInterval(function(){
    var now = performance.now();
    if (findBar()) { if (G.barUp==null) G.barUp = now; G.barSeen = true; }
    else if (G.barUp!=null && G.barLift==null) G.barLift = now;
    if (!G.hookAt && window.__eng) {
      var s = window.__eng.sock();
      if (s) {
        var rec = function(name){ try { G.events.push([name, performance.now()]); } catch(e){} };
        if (typeof s.onAny === 'function') s.onAny(rec);
        else { var orig = s.onevent.bind(s);
          s.onevent = function(p){ try { rec(p.data[0]); } catch(e){} return orig(p); }; }
        G.hookAt = performance.now();
        G.note = 'hooked ' + (G.hookAt/1000).toFixed(1) + 's after page, socket.connected=' + s.connected;
      }
    }
  }, 100);
  return 'recorder armed';
})()" 2>&1 | tail -1

# wait for the bar to appear (immediately on PLAY), then mid-load screenshot
agent-browser wait --fn "window.__gate && window.__gate.barUp != null" --timeout 30000 >/dev/null 2>&1 || echo "WARN: bar never appeared"
sleep 20 && agent-browser screenshot "$ROOT/download/joingate-$LABEL-1-bar.png" >/dev/null 2>&1 && echo "bar screenshot taken"

# wait for the bar to lift — cold load ~125 s in this env (preloader hard cap
# 120 s + warmup 15 s deadline), so allow 190 s
agent-browser wait --fn "window.__gate && window.__gate.barLift != null" --timeout 190000 >/dev/null 2>&1 || echo "WARN: bar never lifted"

# resume if the pause menu is up (post-gate gameplay unchanged)
sleep 2
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 || true

# observation window into the LIVE match — bots must be fighting by now
sleep 55
agent-browser screenshot "$ROOT/download/joingate-$LABEL-2-live.png" >/dev/null 2>&1 && echo "live screenshot taken"

# verdict — the gate-open signature is 'init' (the join ack: NOTHING can
# arrive before it). Gated client: init lands at the very END of the load
# (>=90% — released just before the 300 ms bar fade) and zero shots precede
# the bar lift. Old code: init fires within ~seconds of PLAY (mid-load) and
# bot gunfire streams DURING the download -> GATE-FAIL.
agent-browser eval "(function(){var G=window.__gate; var lift=G.barLift, up=G.barUp, ev=G.events; var firstInit=null; for(var i=0;i<ev.length;i++){if(ev[i][0]==='init'){firstInit=ev[i][1];break;}} var preInit=ev.filter(function(e){return firstInit!=null && e[1]<firstInit;}); var inFade=ev.filter(function(e){return firstInit!=null && e[1]>=firstInit && e[1]<lift;}); var post=ev.filter(function(e){return e[1]>=lift;}); var tally=function(a){var m={};a.forEach(function(e){m[e[0]]=(m[e[0]]||0)+1;});return m;}; var out={attach:G.note, loadSeconds:lift&&up?+((lift-up)/1000).toFixed(1):null, initAtPctOfLoad:firstInit&&up&&lift?+(((firstInit-up)/(lift-up))*100).toFixed(1):null, eventsBeforeJoin:preInit.length, eventsInReleaseFade:inFade.length, fadeTally:tally(inFade), shotsBeforeLift:ev.filter(function(e){return e[1]<lift&&(e[0]==='shot'||e[0]==='reloadFx');}).length, eventsAfterLift:tally(post), shotsAfterLift:post.filter(function(e){return e[0]==='shot';}).length}; out.verdict=(out.eventsBeforeJoin===0&&out.initAtPctOfLoad!==null&&out.initAtPctOfLoad>=90&&out.shotsBeforeLift===0&&out.shotsAfterLift>0)?'GATE-OK':'GATE-FAIL'; return JSON.stringify(out);})()" 2>/dev/null | python3 -c "import json,sys; s=sys.stdin.read().strip(); s=json.loads(s) if s.startswith('\"') else s; print(s)" > "$LOG"
echo "log: $LOG ($(wc -c < "$LOG" 2>/dev/null || echo 0) bytes)"
