# DUST2 — CS2-style Web FPS · Deployment Guide

A multiplayer Counter-Strike-style FPS that runs in the browser:
**Dust2 map · headshot hitboxes (4× damage) · bomb defusal · economy & buy menu · bots fill 5v5 · room codes for friends.**

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
| 1 / 2 / 3 / 4 | Primary / Pistol / Knife / C4 |
| Q | Last weapon |
| E (hold) | Plant / defuse the bomb |
| B | Buy menu (during freeze time + 20s) |
| TAB | Scoreboard (hold) |
| ENTER | Chat |
| ESC | Pause / settings |

## Game rules (bomb defusal)

- **Terrorists** win by planting the C4 (hold **E** on site A or B) and letting it explode, or by eliminating all CTs
- **Counter-Terrorists** win by defusing (hold **E**, 10s), eliminating all Ts, or running out the round timer
- Headshots deal **4× damage** — armor + helmet reduce it
- Kill/round rewards feed the economy; first team to the target round count wins the match

## Tuning

- **Match length**: lobby → "Match format" (first to 4 / 8 / 13 / 16)
- **Bot difficulty**: lobby → easy / normal / hard
- **No bots**: lobby → "HUMANS ONLY"
- **Player speed / damage / prices**: edit `src/game/weapons.ts` (client) and `mini-services/game-server/weapons.ts` (server) — keep them in sync
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
