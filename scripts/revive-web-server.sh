#!/usr/bin/env bash
# Task 138: idempotent web-server (:3000) guardian — the :3000 twin of the
# Task-137 ensure-game-server.sh.
#
# WHY THIS EXISTS: the platform chain (tini -> bun run dev -> next-server)
# normally owns :3000, but a next-server crash inside a still-running tini
# leaves the web app dark with nothing respawning it (same failure class as
# Task 136's :3003). This guardian revives `next dev` double-forked so the
# invocation reaper can't claim it.
#
# Contract (mirrors ensure-game-server.sh):
#   - exits fast, never blocks, always exits 0
#   - no-op when :3000 already serves HTTP (LISTEN + HTTP probe)
#   - never kills a healthy process
#   - spawns `next dev -p 3000` double-forked with cwd=/home/z/my-project
#
# Wired in: platform cron (self-heal every ~10 min, alongside the :3003
# guardian). NOT wired into package.json "dev" — the platform itself runs
# that script at boot, which would self-deadlock (guardian spawning the same
# server the boot chain is about to start); boot-time coverage for :3000
# comes from the platform chain itself, this script only covers mid-session
# death.

set +e
WEB_DIR="/home/z/my-project"
LOG="/home/z/my-project/dev-revive.log"
PORT=3000

# --- probe 1: anything listening on :3000? ---
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  exit 0
fi

# --- probe 2: ss unavailable / LISTEN race — try a real HTTP request ---
if command -v curl >/dev/null 2>&1; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null)
  if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "308" ]; then
    exit 0
  fi
fi

# --- spawn: subshell backgrounds next and exits immediately -> next is
#     orphaned to init (pid 1, tini) before any reaper can claim it ---
echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] revive-web-server: :$PORT down, spawning next dev" >> "$LOG"
( cd "$WEB_DIR" && setsid npx next dev -p 3000 >> "$LOG" 2>&1 < /dev/null & )

exit 0
