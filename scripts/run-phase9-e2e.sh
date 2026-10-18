#!/bin/bash
# Phase 9 E2E runner: game-server + socket tests in ONE shell session
# (background processes don't survive across tool calls in this sandbox).
# Runs the phase-9 suite then the phase E2E regressions.
set -u
cd /home/z/my-project
LOG=/tmp/gs-p9.log

pkill -f "bun index\.ts" 2>/dev/null
sleep 0.5

cd mini-services/game-server
bun index.ts > "$LOG" 2>&1 &
GS=$!
cd /home/z/my-project

for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3003/socket.io/?EIO=4&transport=polling" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 0.5
done
echo "game-server up (pid $GS, handshake $code)"

bun scripts/test-phase9-e2e.ts
RC=$?

echo "=== regression: phase8 e2e ==="
bun scripts/test-phase8-e2e.ts 2>&1 | tail -2
echo "=== regression: phase7 e2e ==="
bun scripts/test-phase7-e2e.ts 2>&1 | tail -2
echo "=== regression: phase6 e2e ==="
bun scripts/test-phase6-e2e.ts 2>&1 | tail -2
echo "=== regression: phase5 e2e ==="
bun scripts/test-phase5-e2e.ts 2>&1 | tail -2
echo "=== regression: phase4 e2e ==="
bun scripts/test-phase4-e2e.ts 2>&1 | tail -2
echo "=== regression: phase3 e2e ==="
bun scripts/test-phase3-e2e.ts 2>&1 | tail -2

kill $GS 2>/dev/null
exit $RC
