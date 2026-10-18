# AGENTS.md — standing rules for anyone (human or AI) working in this repo

Read this before touching the repo. These rules are user-issued and persist across
sessions. When in doubt, ask the user — never assume an exception.

## Asset acceptance policy (v3) — the big rule

- `public/assets/`  = **accepted, committed running assets** — normal git content,
  no ignore rules. A fresh clone contains exactly these.
- `public/staging/` = **pending binaries under evaluation** — gitignored, but still
  web-served so the game runs them live.
- New or replaced binaries **always land in `public/staging/<same-relative-path>`**.
  Never drop a new binary directly into `public/assets/` — platform auto-commits
  sweep untracked non-ignored files, and it would enter git unreviewed.
- Loader behavior: sounds/textures/icons try `/assets/...` first, then `/staging/...`;
  the model route `POST /api/assets/human` serves **staging over accepted** while
  a staged copy exists, so a newly dropped version always wins for evaluation.
- **Accept only on explicit user approval.** Acceptance is a plain file move:
  ```bash
  mv public/staging/<x> public/assets/<x> && git add public/assets/<x>
  ```
  No `-f` flag — `public/assets/` has no ignore rules.
- Revocation: `git rm --cached public/assets/<x>` (move it back to staging if it
  should stay live). If it was already pushed, a history purge needs force-push.
- Why: large binaries bloat git history permanently; models get swapped often.
  Staging keeps evaluation free and history clean.

## Environment recovery (sandbox restart / data loss) — user rule 2026-10-19

- **If the sandbox has restarted and all or part of the project data is lost:
  pull from the remote repo FIRST. The remote repo is the single source of
  truth.** Do not improvise recovery from mirrors, /tmp copies, or memory
  before syncing with `origin/main`.
- Recovery order:
  1. Wipe symptoms: missing `public/staging/`, missing raw packs, mode-flip
     644→755 diffs, missing `~/.git-credentials`, empty directories.
  2. Credentials gone too? Re-create the store per the recipe in Git rules
     below (ask the user for the PAT if it was rotated).
  3. `git fetch origin` → if `git log origin/main..main` shows local commits
     that were never pushed, surface them to the user before discarding;
     otherwise `git reset --hard origin/main` restores the canonical tree.
     (Verified work is always pushed when done — standing Git rule — so the
     default expectation is: remote ⊇ local.)
  4. Anything still missing after the pull is gitignored-by-design (staged
     binaries, raw packs like `assets/packs/csgo/weapons`). Regenerate from
     committed scripts where possible; otherwise ask the user. Since the 9.3
     acceptance, ALL production sounds/icons/models are committed — a fresh
     pull restores the complete runnable game.

## Git rules

- Never commit or push binaries (models/sounds/textures/map data) that the user
  has not explicitly accepted.
- **Persistent push auth (user decision 2026-10-17)**: a PAT is stored in git's
  credential store at `/home/z/.git-credentials` — OUTSIDE the repo, chmod 600,
  never committed, never print/cat its contents. Plain `git push origin main`
  authenticates automatically. If auth fails, ONE of two causes:
  (a) the PAT was revoked/rotated → ask the user for a new one;
  (b) the environment was reset (happened 2026-10-17: the platform wiped
  `~/.git-credentials` AND the credential.helper line in `~/.gitconfig`, and
  chmod-flipped tracked files to 755). Recovery for (b): re-run
  `git config --global credential.helper 'store --file=/home/z/.git-credentials'`,
  rewrite the credentials file (`https://x-access-token:<PAT>@github.com`,
  chmod 600), and `git diff --name-only | xargs chmod 644` to clear mode-only
  changes. Do NOT embed tokens in remote URLs in `.git/config`, in repo
  files, or in logs; redact any token that appears in command output.
- Force-push only for a stated purpose (e.g. history purge) and never silently.
- Keep remote `main` = local `main`: push when work is committed and verified.

## Runtime / ops

- `next dev` on :3000, game-server on :3003. Browser verification goes through the
  **:81 proxy** (it transforms the socket connection) — not :3000 direct.
- Long-lived processes must survive the Bash-call reaper via double-fork:
  `( setsid nohup CMD >log 2>&1 < /dev/null & )` — anything else is killed at
  call end.
- Lobby gotcha: "▶ QUICK PLAY" is just a tab selector; the deploy button is "▶ PLAY".

## Verification bar (before calling anything done)

- E2E: `bun scripts/test-aimhead.ts` (4/4) and `bun scripts/test-bugfixes.ts` (3/3).
- Full-roster regression: `bun scripts/test-phase9.ts` + `scripts/run-phase9-e2e.sh`
  (data-driven buy/fire/reload/throw over every BUY_ENTRY + 10×MG tick-budget
  load sanity). Phase suites 3–8 + bots are the per-mechanic detail layers.
- Buy-icon orientation: `bun scripts/check-icon-orientation.ts` (35 checks —
  pins the gun view matrix's 180° acceptance roll and the per-weapon
  magazine-below-barrel anatomy; the p90's top mag is the one exemption).
- Model: `POST /api/assets/human` → 200; in-browser `model=READY`, players N/N
  `onRig`.
- VLM screenshot checks: only judge character models while ALIVE (the spectate
  camera ignores teleport); distant map crates get misread as "characters".
- `tsc`: `src/` + `mini-services/` + phase tests must be clean (known
  pre-existing errors live in `scripts/bsp*`, `scripts/texgen`, `examples/` —
  leave them).

## E2E harness invariants (learned the hard way — keep these in any socket test)

- **Move players incrementally** (`hop`-style ~9m steps): single far `state`
  emits trip the anti-teleport guard (>12m/claim) and are silently dropped.
- **Sync positions from `snapshot` rows before computing hops**: `roundStart`
  teleports everyone to spawns; a hop launched off a stale client-side position
  is a rejected no-op, leaving players spawn-side with no LOS.
- **Damage claims only apply during `live`** (`applyDamage` phase gate); grenade
  **throws** are also live-only (`throwGrenade` checks `m.phase`).
- **Buys are legal in freeze + the first 20s of live** — size test batches by a
  time budget computed from fireDelay/reloadMs so every buy lands in-window.
- The shooter never sees their own `shot` broadcasts (`socket.to(room)`) — count
  them on a witness socket.
- Who carries the bomb is a **connection race**: read `snapshot` row[13], never
  assume socket creation order.

## Session protocol

- Read `worklog.md` FIRST — it carries task history, lessons, and decisions.
- Sandbox restarted / data missing? Follow "Environment recovery" above —
  pull from remote first, remote is the single source of truth.
- Append an entry when done: `---` / `Task ID` / `Agent` / `Task` / `Work Log` /
  `Stage Summary`. Never overwrite existing entries.
