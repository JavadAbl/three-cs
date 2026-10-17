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
- Loader behavior: sounds/textures try `/assets/...` first, then `/staging/...`;
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

## Git rules

- Never commit or push binaries (models/sounds/textures/map data) that the user
  has not explicitly accepted.
- **Persistent push auth (user decision 2026-10-17)**: a PAT is stored in git's
  credential store at `/home/z/.git-credentials` — OUTSIDE the repo, chmod 600,
  never committed, never print/cat its contents. Plain `git push origin main`
  authenticates automatically. If auth fails, the token was revoked/rotated:
  ask the user for a new PAT and write it back in the same format
  (`https://x-access-token:<PAT>@github.com`). Do NOT embed tokens in remote
  URLs in `.git/config`, in repo files, or in logs; redact any token that
  appears in command output.
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
- Model: `POST /api/assets/human` → 200; in-browser `model=READY`, players N/N
  `onRig`.
- VLM screenshot checks: only judge character models while ALIVE (the spectate
  camera ignores teleport); distant map crates get misread as "characters".
- `tsc`: `src/` + `mini-services/` must be clean (known pre-existing errors live
  in `scripts/` and `examples/` — leave them).

## Session protocol

- Read `worklog.md` FIRST — it carries task history, lessons, and decisions.
- Append an entry when done: `---` / `Task ID` / `Agent` / `Task` / `Work Log` /
  `Stage Summary`. Never overwrite existing entries.
