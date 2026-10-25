import { readFile, access, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// Weapon GLBs are served through this extensionless route (one URL per
// weapon id) instead of the static `/assets|staging/models/weapons/<id>.glb`
// paths, for the same reason as the player model route
// (/api/assets/human/route.ts): browser download-manager extensions (IDM
// etc.) must never recognize the binaries as downloadable files:
//   1. no `.glb` extension in the URL
//   2. the game fetches with method POST — download managers only hook GET
//   3. explicit `model/gltf-binary` Content-Type, never octet-stream
//
// Asset-acceptance policy (mirrors the human model): accepted = committed
// public/assets/models/weapons/<id>.glb; pending = gitignored
// public/staging/models/weapons/<id>.glb. STAGING WINS if present so the
// user can evaluate new drops live; acceptance is a plain `mv` + `git add`.
//
// If neither file exists the route 404s and the caller keeps its procedural
// model — a fresh clone runs fully procedural, nothing breaks.
//
// Accepted set (2026-10-24): ak47, ak74, galil, m4, famas, aug — the user's Sketchfab
// AK-47 (Lokeig, NOT the rejected CC0 Quaternius pack, which must never be
// restored), the user's own AK-74M upload, the user's CS2-rip Galil AR
// (accepted "Galil accepted.", Task 71; single merged mesh, no named parts,
// baked rotY 180° by scripts/bake-galil.ts — the first staging rendered
// reversed), the user's Sketchfab M4 upload (accepted with "replace m4a4
// with this new one", Task 104; 89 unnamed Pattern2D/Cylinder meshes, no
// named parts, baked rotY(-90°) by scripts/bake-m4.ts — the raw lies along
// +X with the muzzle at -X), the user's Sketchfab FAMAS upload with the
// "Plasmas" CS:GO skin (accepted with "change famas model to this", Task
// 105; 3 unnamed Object_N meshes + PNG baseColor, no named parts, baked
// rotY(180°) by scripts/bake-famas.ts — the raw lies along +Z with the
// muzzle at +Z, bullpup), and the user's Steyr AUG A3 upload (accepted
// with the bare "AUG" message, Task 106; 2 unnamed meshes, 14,223 tris,
// baseColorTexture + metallicRoughnessTexture, no named parts, baked
// rotY(+90°) by scripts/bake-aug.ts — the raw lies along +X with the
// muzzle at +X, bullpup with an enclosed mag + vertical foregrip). All
// six accepted for DEV-ONLY use per the
// user's explicit decision ("i dont want publish this game. i want it for
// dev purposes only") — see the license ledger in
// public/assets/models/README.md before ever distributing this repo.
// All other ids 404 → procedural (weapon GLB contract:
// public/assets/models/README.md).

const ASSET_DIRS = ['staging', 'assets'] // staging wins
const ID_RE = /^[a-z0-9]{2,12}$/

async function resolveFile(id: string): Promise<string> {
  if (!ID_RE.test(id)) throw new Error(`bad weapon id`)
  for (const dir of ASSET_DIRS) {
    const p = path.join(process.cwd(), 'public', dir, 'models', 'weapons', `${id}.glb`)
    try { await access(p); return p } catch { /* try next */ }
  }
  throw new Error(`no glb for ${id}`)
}

// per-id parsed-buffer cache. Task 113: entries are validated against the
// file on every request (path + mtimeMs + size), so replacing a staged or
// accepted GLB is picked up on the next request — the previous forever-cache
// was the bug that served a stale human model for half an hour after its
// re-bake (see /api/assets/human/route.ts).
const cache = new Map<string, { path: string; mtimeMs: number; size: number; body: Buffer; etag: string }>()

async function loadFile(id: string): Promise<{ body: Buffer; etag: string }> {
  const p = await resolveFile(id)
  const st = await stat(p)
  const c = cache.get(id)
  if (c && c.path === p && c.mtimeMs === st.mtimeMs && c.size === st.size) return c
  const body = await readFile(p)
  const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"'
  cache.set(id, { path: p, mtimeMs: st.mtimeMs, size: st.size, body, etag })
  return cache.get(id)!
}

function fileResponse(req: Request, c: { body: Buffer; etag: string }): Response {
  if (req.headers.get('if-none-match') === c.etag) {
    return new Response(null, { status: 304, headers: { ETag: c.etag } })
  }
  return new Response(new Uint8Array(c.body), {
    status: 200,
    headers: {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': String(c.body.length),
      // GET responses may be cached + revalidated via ETag; POST responses
      // are never cached by browsers, which is fine — the client module
      // caches the parsed models in memory for the whole page session.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ETag: c.etag,
    },
  })
}

/** the game client fetches each weapon model with POST */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    return fileResponse(req, await loadFile(id))
  } catch {
    return new Response('weapon model file not found (drop <id>.glb into public/staging/models/weapons/ to evaluate, or public/assets/models/weapons/ once accepted)', { status: 404 })
  }
}

/** GET kept for manual testing / curl; the game itself never uses it */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return POST(req, ctx)
}
