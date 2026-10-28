#!/usr/bin/env bash
# Task 138: idempotent Next.js dev server (:3000) guardian.
#
# WHY: at the 07:58 container reboot the platform's `bun run dev` chain
# (bun -> bash -> next dev -> next-server) lost its children mid-session —
# the husk stayed alive but nothing listened on :3000, so the :81 preview
# went 502. /start.sh has NO respawn loop for the dev chain, so this
# guardian (+ the platform cron that calls it) is the self-heal.
#
# Same survival contract as ensure-game-server.sh: double-forked spawn so
# the sandbox invocation-end reaper can't claim it. NOTE: never wire this
# into package.json "dev" — `bun run dev` executes that script; calling a
# spawner of `bun run dev` from inside it would recurse forever.
#
# exits fast, never blocks, always exits 0.

PORT=3000
PROJ="/home/z/my-project"

# --- probe: anything listening on :3000? ---
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  exit 0
fi
if command -v curl >/dev/null 2>&1; then
  if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null; then
    exit 0
  fi
fi

# --- spawn: bun run dev runs the package.json dev script, which FIRST
#     ensures the game server (:3003) and then pipes next dev into
#     tee dev.log. Outer stdio -> a separate boot log so the tee inside
#     keeps its exclusive handle on dev.log. ---
echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] ensure-web-dev: :$PORT down, spawning bun run dev" >> "$PROJ/web-dev-guardian.log"
( cd "$PROJ" && setsid bash -c 'exec bun run dev' >> "$PROJ/web-dev-guardian.log" 2>&1 < /dev/null & )

exit 0
