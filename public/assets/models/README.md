# Player model assets — staging & acceptance workflow

`public/assets/` holds **accepted, committed** running assets. New or pending
binaries live in **`public/staging/`** (gitignored, still web-served so the
game can run them for live evaluation).

## Lifecycle of a model binary

1. **Pending** — drop the file into `public/staging/models/human.glb`.
   It is gitignored (never committed, invisible to `git status` and to
   auto-commits), but the game runs it immediately.
2. **Accept** — when the user explicitly approves it:
   ```bash
   mv public/staging/models/human.glb public/assets/models/human.glb
   git add public/assets/models/human.glb && git commit
   ```
   Plain `git add` — no `-f` flag, no ignore rules in `public/assets/`.
3. **Revoke** — `git rm --cached public/assets/models/<file>` moves it back
   out of git (keep it on disk, or move it to staging again).

While a staged copy exists it **overrides** the accepted copy (evaluation
always tests the newest drop). The route caches the parsed buffer in module
memory — touch `src/app/api/assets/human/route.ts` (or restart dev) after
replacing a file to re-read it.

## How the game loads the model

Through the extensionless route **`/api/assets/human`**
(`src/app/api/assets/human/route.ts`, fetched via POST), never the static
`.glb` path — browser download-manager extensions (IDM etc.) must not
recognize it as a downloadable file:

- **If the file is missing** (fresh clone, nothing staged), the route returns
  404 and the game still works: players fall back to the built-in procedural
  soldier rig (players.ts) — nothing breaks.
- The model is preloaded while the lobby menu is open, so starting a match
  never triggers a fresh download.

## Why binaries are staged at all

Large binaries bloat git history permanently (every version ever committed
stays in the pack forever). Staging keeps evaluation cheap: swap files as
often as you like, only accepted copies enter history.
