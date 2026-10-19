#!/bin/bash
# Phase 4 E2E runner: game-server + socket test in ONE shell session
# (background processes don't survive across tool calls in this sandbox,
# so the server and the test must live and die within this script)
set -u
cd /home/z/my-project
LOG=/tmp/gs-p4.log

# start the game server fresh (plain bun, no --hot — task-29 lesson)
cd mini-services/game-server
bun index.ts > "$LOG" 2>&1 &
GS=$!
cd /home/z/my-project

# wait for the socket.io handshake to answer
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3003/socket.io/?EIO=4&transport=polling" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 0.5
done
echo "game-server up (pid $GS, handshake http $code)"

# run the E2E suite against it
bun scripts/test-phase4-e2e.ts
RC=$?

# also re-run the standard E2E suites against this same server instance
echo "=== regression: aimhead ==="
bun scripts/test-aimhead.ts 2>&1 | tail -2
echo "=== regression: bugfixes ==="
bun scripts/test-bugfixes.ts 2>&1 | tail -2

kill $GS 2>/dev/null
wait $GS 2>/dev/null
echo "game-server stopped; phase4 e2e exit=$RC"
exit $RC
