#!/usr/bin/env bash
# Task 138: idempotent WEB-SERVER (:3000) revival — sibling of
# scripts/ensure-game-server.sh (which owns :3003).
#
# WHY: the Next dev server (platform-spawned at boot) can die mid-session
# under memory pressure (4GB cap; observed during the Task-138 palm pack
# runs + HMR churn: the whole tini -> bun run dev -> next-server chain
# vanished, :81 fell back to 502). This script double-fork-spawns the same
# `bun run dev` the platform uses, so the revival survives the invocation
# reaper exactly like the game-server guardian does.
#
# Boot-race note: this script must NOT be called from inside the "dev"
# package.json script (it would race the platform's own next dev at boot
# with EADDRINUSE). It is only for the cron self-heal loop.

PORT=3000

if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  exit 0
fi
if command -v curl >/dev/null 2>&1; then
  if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null; then
    exit 0
  fi
fi

echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] revive-web-server: :$PORT down, spawning" >> /home/z/my-project/dev-revive.log
( cd /home/z/my-project && setsid bash -c 'bun run dev >> /home/z/my-project/dev-revive.log 2>&1 < /dev/null' & )

exit 0
