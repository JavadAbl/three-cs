#!/bin/bash
# Task 120 — LIVE verify the real-CS-announcer replacement:
#  1. join a match (dev server on :3000), reach phase 'live'
#  2. __eng.sfx(): whole pack loaded, ZERO errors (decoders incl. the 4
#     new announcer Vorbis bodies — a bad decode would land in errors[])
#  3. in-page fetch + decodeAudioData of the 4 /assets/sounds/announce_*.ogg
#     — served bytes must decode to the NEW source durations:
#     ct_win 1.876689 / t_win 1.644807 / planted 1.508980 / defused 1.775601
#     (old TTS bodies were ~1.0-1.4 s, so duration distinguishes them)
set -u

agent-browser set viewport 1280 720 >/dev/null 2>&1 || true
agent-browser open http://localhost:81/ >/dev/null 2>&1
for _ in $(seq 1 45); do agent-browser snapshot -i 2>/dev/null | rg -q "QUICK PLAY" && break; sleep 1; done
sleep 1

MAPBTN=$(agent-browser snapshot -i 2>/dev/null | rg "AIM DEPOT" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$MAPBTN" ] && agent-browser click @$MAPBTN >/dev/null 2>&1 && echo "map: aim depot"
TBTN=$(agent-browser snapshot -i 2>/dev/null | rg "TERRORIST" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$TBTN" ] && agent-browser click @$TBTN >/dev/null 2>&1 && echo "team: TERRORIST"
PLAY=$(agent-browser snapshot -i 2>/dev/null | rg "PLAY" | rg -o "e[0-9]+" | head -1 || true)
[ -n "$PLAY" ] && agent-browser click @$PLAY >/dev/null 2>&1 && echo "launched play"

agent-browser wait --fn "document.body && document.body.innerText.toUpperCase().includes('RESUME')" --timeout 360000 >/dev/null 2>&1 || echo "WARN: no pause menu"
sleep 1
agent-browser find text "RESUME" click >/dev/null 2>&1 || true
agent-browser wait --fn "document.pointerLockElement !== null" --timeout 8000 >/dev/null 2>&1 \
  || agent-browser eval "(function(){var o=document.querySelector('.z-50'); if(o){o.style.display='none'; return 'overlay hidden'} return 'no overlay'})()" 2>&1 | tail -1

agent-browser wait --fn "window.__eng && window.__eng.state().phase === 'live'" --timeout 120000 >/dev/null 2>&1 \
  && echo "phase: live" || echo "WARN: never live"

echo "--- sfx() state ---"
agent-browser eval "JSON.stringify(__eng.sfx())" 2>&1 | tail -1

echo "--- served announce bodies (in-page fetch + decode) ---"
agent-browser eval "(async () => {
  const ac = new AudioContext();
  const want = { announce_ct_win: 1.876689, announce_t_win: 1.644807, announce_planted: 1.508980, announce_defused: 1.775601 };
  const out = {};
  for (const k of Object.keys(want)) {
    const r = await fetch('/assets/sounds/' + k + '.ogg');
    const ab = await r.arrayBuffer();
    const buf = await ac.decodeAudioData(ab).catch(e => null);
    out[k] = buf ? { status: r.status, dur: +buf.duration.toFixed(3), want: want[k], match: Math.abs(buf.duration - want[k]) < 0.01 } : { status: r.status, decode: 'FAIL' };
  }
  ac.close();
  return JSON.stringify(out);
})()" 2>&1 | tail -1

echo "--- page errors ---"
agent-browser errors 2>&1 | tail -3
