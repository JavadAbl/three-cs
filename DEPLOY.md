# DUST2 — CS2-style Web FPS · Deployment Guide

A multiplayer Counter-Strike-style FPS that runs in the browser:
**Dust2 map · headshot hitboxes (4× damage) · bomb defusal · economy & buy menu · full CS:GO weapon roster — 42 buyable entries (33 guns · 6 grenades · kevlar/helmet/defuse kit) with 1.6-style silhouette icons · flash/smoke/molotov utility, per-player blind + LOS-blocking smoke · bots fill 5v5 · room codes for friends.**

This guide gets it running on your own server so you and your friends can play together.

---

## What you need

- A Linux server (any cheap VPS works — 1 vCPU / 1 GB RAM is enough for ~10 players)
- Docker + Docker Compose installed (easiest route), **or** Bun 1.x (manual route)
- Ports `80` (and `443` if you use a domain) open in your firewall

---

## Option A — Docker (recommended)

```bash
# 1. copy the project to your server (git clone, scp, or zip upload)
# 2. from the project root:
docker compose up -d --build

# 3. done — open it:
#    http://YOUR_SERVER_IP
```

That's it. The stack is:

| Container | What it does |
|-----------|--------------|
| `game`    | Next.js web app (`:3000`) + Socket.IO game server (`:3003`) |
| `caddy`   | Public entry point (`:80`/`:443`), routes web + WebSocket traffic |

### Playing with friends

1. Everyone opens `http://YOUR_SERVER_IP`
2. Each player types a nickname
3. **All players enter the same Room code** (e.g. `friday-night`) — the room auto-creates on first join
4. Pick teams (or AUTO), hit **PLAY**
5. Bots automatically fill both teams up to 5v5 so you can play 1v1, 3v3, anything

> Room capacity: 10 humans. Bots are per-room. Empty rooms are cleaned up after 5 minutes.

### HTTPS with your own domain (optional)

Edit `deploy/Caddyfile`, change the first line from `:80` to your domain:

```
dust2.example.com {
    ...
}
```

Then `docker compose restart caddy`. Caddy provisions free Let's Encrypt certificates automatically. Point your domain's A-record at the server first.

---

## Option B — Manual (no Docker)

Requires [Bun](https://bun.sh) (v1.x):

```bash
# 1. install dependencies
bun install
cd mini-services/game-server && bun install && cd ../..

# 2. build the web app
bun run build

# 3. start both servers (in separate shells, or under systemd/pm2)
bun run start                       # web server on :3000
cd mini-services/game-server && bun start   # game server on :3003
```

Put any reverse proxy in front that forwards:

- everything else → `localhost:3000`
- requests with query `?XTransformPort=3003` → `localhost:3003` (this is the WebSocket route the game client uses)

> **Sandbox note (Task 137):** in the dev sandbox, `bun run dev` automatically calls
> `scripts/ensure-game-server.sh` first — an idempotent guardian that double-fork-spawns
> the `:3003` game server if (and only if) nothing is listening there. This makes the
> server come back on every container boot. A platform cron job re-runs the same script
> every 10 min as a mid-session self-heal. On a real deployment (above) you run both
> services explicitly, so the guardian is a no-op if you also start the game server.

Example nginx snippet:

```nginx
location / {
    # WebSocket/game traffic
    if ($arg_XTransformPort) {
        proxy_pass http://127.0.0.1:3003;
    }
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

---

## Game controls

| Key | Action |
|-----|--------|
| WASD | Move |
| SHIFT | Walk (quiet) |
| CTRL / C | Crouch |
| SPACE | Jump |
| Mouse | Aim (click the game to lock the cursor) |
| LMB | Fire |
| RMB | Scope (AWP) |
| R | Reload |
| 1 / 2 / 3 / 4 / 5 | Primary / Pistol / Knife / C4 / Grenades (cycles) |
| Q | Last weapon |
| E (hold) | Plant / defuse the bomb |
| B | Buy menu (during freeze time + 20s) |
| LMB / RMB (grenade) | Full-power throw / underhand lob |
| TAB | Scoreboard (hold) |
| ENTER | Chat |
| ESC | Pause / settings |

## Weapon roster (full CS:GO set, one stat source)

All stats live in **`shared/weapons.ts`** (single source of truth — see Tuning).
Buy menu categories mirror CS 1.6 slots:

| Category (B → digit) | Weapons |
|---|---|
| 1 · PISTOLS | deagle, glock¹, usp¹, p250, five-seven, tec-9, cz75, dual berettas, p2000, r8, zeus |
| 2 · SHOTGUNS | nova, xm1014, mag-7, sawed-off — 9-pellet fans, server-validated per pellet |
| 3 · SMGs | mp9, mac-10, mp7, ump-45, mp5-sd, p90, bizon |
| 4 · RIFLES | ak-47, m4a4, m4a1-s, galil, famas, sg 553, aug, ssg 08, scar-20, g3sg1, awp |
| 5 · MACHINE GUNS | negev (accuracy-ramp spool), m249 |
| 6 · EQUIPMENT | kevlar, kevlar+helmet, defuse kit, flashbang, he, smoke, molotov, incendiary, decoy |

¹ starters (free, team default) · every menu row shows a procedural weapon-silhouette
icon rendered from the same viewmodel geometry the player holds.

Kill rewards follow CS classes ($300 rifles/pistols, $600 SMGs, $900 shotguns,
$100 AWP/auto-snipers, $300 MGs/grenades, $1500 knife) — verified against the
shared table by the phase-9 balance suite, and the economy is validated by
scripted 20-round bot simulations.

## Game rules (bomb defusal)

- **Terrorists** win by planting the C4 (hold **E** on site A or B) and letting it explode, or by eliminating all CTs
- **Counter-Terrorists** win by defusing (hold **E**, 10s), eliminating all Ts, or running out the round timer
- Headshots deal **4× damage** — armor + helmet reduce it
- Kill/round rewards feed the economy; first team to the target round count wins the match

## Tuning

- **Match length**: lobby → "Match format" (first to 4 / 8 / 13 / 16)
- **Bot difficulty**: lobby → easy / normal / hard
- **No bots**: lobby → "HUMANS ONLY"
- **Player speed / damage / prices**: edit `shared/weapons.ts` (the single source of truth — client and server both derive from it; `src/game/weapons.ts` and `mini-services/game-server/weapons.ts` are re-export shims, never hand-edit those)
- **Map layout**: `dust2.ts` in both locations (shared format: boxes + spawns + bomb sites + bot waypoints)

## Tech notes

- Client: Next.js 16 + Three.js (WebGL), procedural map textures. Character model:
  **asset-acceptance policy** — `public/assets/` holds only accepted, committed
  assets; pending binaries are evaluated from `public/staging/` (gitignored but
  web-served; loaders try `/assets/...` first, then `/staging/...`, and the model
  route serves staging over accepted while a staged copy exists). The accepted
  `public/assets/models/human.glb` (~7.6 MB) is committed only after explicit user
  approval (see `public/assets/models/README.md`); a fresh clone without it falls
  back to the built-in procedural soldier rig. The game preloads the model while
  the lobby menu is open (fetched via `POST /api/assets/human`, an extensionless
  route, so download-manager extensions like IDM never intercept it), so starting
  a match never triggers a model download.
- Server: Socket.IO at 20 Hz snapshots, server-authoritative HP/economy/rounds, line-of-sight hit validation
- Bots: waypoint pathfinding, LOS vision, difficulty-scaled reaction/accuracy, plant & defuse behavior
