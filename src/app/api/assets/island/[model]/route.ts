import { readFile, access, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// Island prop GLBs (Task 134: the user's 4 packed Sketchfab palms — palm-hd,
// palm-low, palm-burned, palm-series) are served through this extensionless
// route for the same anti-download-manager reasons as the weapon/human/rebel
// routes (see /api/assets/weapon/[id]/route.ts). Task 135 lesson (the
// "stuck on warmup" report): the palms were first shipped as DIRECT static
// GETs to /assets|/staging/models/island/<m>.glb — the only .glb-suffixed
// URLs left in the client — and the user's IDM extension pattern-matched
// them, captured the downloads, and let the fetch responses resolve WITHOUT
// their bodies. The preloader awaited the body read with no timeout, so the
// whole loading bar wedged, the join gate never released, and the server room
// sat in 'warmup' (no rounds, no bot ticks) forever. This route removes the
// trigger entirely:
//   1. no `.glb` extension in the URL
//   2. the game fetches with method POST — download managers only hook GETs
//   3. explicit `model/gltf-binary` Content-Type, never octet-stream
//
// Asset-acceptance policy v3 (same as every model route): accepted =
// committed public/assets/models/island/<m>.glb; pending = gitignored
// public/staging/models/island/<m>.glb. STAGING WINS if present — the palms
// are STAGED (Task 134 staging-preview state): acceptance will be the
// documented `mv` + `git add` + ASSET_CACHE_VERSION bump (v12 -> v13).
// If neither file exists the route 404s and the map renders without props —
// the island stays fully playable (collision is on boxes, not props).
//
// A fresh container wipe regenerates these payloads via the committed
// pipeline: scripts/island/pack-palm-models-t134.ts (see island-regen.sh).

const ASSET_DIRS = ['staging', 'assets'] // staging wins
const MODEL_RE = /^[a-z0-9][a-z0-9-]{1,23}$/ // palm-hd / palm-low / palm-burned / palm-series (hyphens!)

async function resolveFile(model: string): Promise<string> {
  if (!MODEL_RE.test(model)) throw new Error('bad island model name')
  for (const dir of ASSET_DIRS) {
    const p = path.join(process.cwd(), 'public', dir, 'models', 'island', `${model}.glb`)
    try { await access(p); return p } catch { /* try next */ }
  }
  throw new Error(`no glb for ${model}`)
}

// per-model parsed-buffer cache. Same hard rule as the human/rebel/weapon
// routes (Task 113 stale-serve lesson): entries are validated against the
// file (path + mtimeMs + size) on EVERY request, so re-packing a staged or
// accepted GLB is picked up on the next request — no restart, no stale body.
const cache = new Map<string, { path: string; mtimeMs: number; size: number; body: Buffer; etag: string }>()

async function loadFile(model: string): Promise<{ body: Buffer; etag: string }> {
  const p = await resolveFile(model)
  const st = await stat(p)
  const c = cache.get(model)
  if (c && c.path === p && c.mtimeMs === st.mtimeMs && c.size === st.size) return c
  const body = await readFile(p)
  const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"'
  cache.set(model, { path: p, mtimeMs: st.mtimeMs, size: st.size, body, etag })
  return cache.get(model)!
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
      // are never cached by browsers, which is fine — the client asset
      // cache (preloader.ts) stores these under synthetic GET keys and
      // hands back blob-backed Responses for the whole page session.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ETag: c.etag,
    },
  })
}

/** the game client fetches each island prop model with POST */
export async function POST(req: Request, ctx: { params: Promise<{ model: string }> }): Promise<Response> {
  try {
    const { model } = await ctx.params
    return fileResponse(req, await loadFile(model))
  } catch {
    return new Response('island prop model not found (drop <model>.glb into public/staging/models/island/ to evaluate, or public/assets/models/island/ once accepted) — the map renders without props', { status: 404 })
  }
}

/** GET kept for manual testing / curl; the game itself never uses it */
export async function GET(req: Request, ctx: { params: Promise<{ model: string }> }): Promise<Response> {
  return POST(req, ctx)
}
