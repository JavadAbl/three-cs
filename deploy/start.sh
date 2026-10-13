#!/bin/bash
# Runs the Next.js web server (:3000) and the Socket.IO game server (:3003)
set -e

echo "[start] launching web server on :3000"
bun /app/server.js &
WEB_PID=$!

echo "[start] launching game server on :3003"
cd /app/mini-services/game-server
bun index.ts &
WS_PID=$!

# if either process dies, stop the container
wait -n $WEB_PID $WS_PID
EXIT=$?
echo "[start] a server exited (code $EXIT) — shutting down"
kill $WEB_PID $WS_PID 2>/dev/null || true
exit $EXIT
