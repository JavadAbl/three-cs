#!/usr/bin/env bash
# Task 137: idempotent game-server (:3003) guardian.
#
# WHY THIS EXISTS: the sandbox reaps agent-spawned background processes at
# tool-invocation end, and container boots no longer respawn :3003 by
# themselves (Task 136). A plain `nohup ... &` or even `setsid ... &` gets
# killed at invocation end; only a DOUBLE-FORKED orphan (reparented to
# init within ~1s, before the reaper runs) survives.
#
# Contract:
#   - exits fast, never blocks, always exits 0 (it runs inside `bun run dev`
#     at container boot — a failure here must NEVER break the web app boot)
#   - no-op when :3003 is already accepting connections
#   - spawns `bun index.ts` double-forked with cwd=mini-services/game-server
#
# Wired in: package.json "dev" script (boot-time) + platform cron (self-heal).

GAME_DIR="/home/z/my-project/mini-services/game-server"
LOG="$GAME_DIR/server.log"
PORT=3003

# --- probe 1: anything listening on :3003? ---
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  exit 0
fi

# --- probe 2: ss unavailable / edge case — try a raw connect ---
if command -v curl >/dev/null 2>&1; then
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null; then
    exit 0
  fi
fi

# --- spawn: subshell backgrounds bun and exits immediately -> bun is
#     orphaned to init (pid 1, tini) before any reaper can claim it ---
echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] ensure-game-server: :$PORT down, spawning" >> "$LOG"
( cd "$GAME_DIR" && setsid bun index.ts >> "$LOG" 2>&1 < /dev/null & )

exit 0
