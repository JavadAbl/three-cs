import { readFile, access, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// The TERRORIST character model (Task 115: leather rebel), served through this
// extensionless route for the same anti-download-manager reasons as
// /api/assets/human (no .glb extension, POST fetch, model/gltf-binary type).
// The usermodel.ts T slot fetches this; if it 404s, T players fall back to
// the soldier proto with the classic tan tint — never a crash.

// Asset-acceptance policy (same v3 as human): accepted model =
// public/assets/models/rebel.glb (committed). Pending model =
// public/staging/models/rebel.glb (gitignored, evaluation copy).
// STAGING WINS if present — dropping a new version into staging immediately
// overrides the accepted copy, so the user can evaluate it live; acceptance
// is a plain `mv staging -> assets` + `git add` + ASSET_CACHE_VERSION bump
// (the staged rebel payload IS a cached key by then, see preloader.ts).
// ACCEPTED (Task 115 acceptance, 2026-10-25): committed at
// public/assets/models/rebel.glb (sha1 8f06fbf5591741f330536e44287fa63d78e8aefd,
// 20,675,948 B) + ASSET_CACHE_VERSION v6→v7.
const ACCEPTED = path.join(process.cwd(), 'public', 'assets', 'models', 'rebel.glb')
const STAGED = path.join(process.cwd(), 'public', 'staging', 'models', 'rebel.glb')

async function resolveFile(): Promise<string> {
  try { await access(STAGED); return STAGED } catch { /* no staged copy */ }
  return ACCEPTED
}

// Task 113 lesson (the "big monster" stale-serve): stat the resolved file
// (path + mtimeMs + size) on EVERY request and re-read + re-hash the etag on
// any change — replacing the file on disk is picked up on the next request,
// no touch/restart needed.
interface Entry { path: string; mtimeMs: number; size: number; body: Buffer; etag: string }
let cache: Entry | null = null

async function loadFile(): Promise<{ body: Buffer; etag: string }> {
  const p = await resolveFile()
  const st = await stat(p)
  if (cache && cache.path === p && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache
  const body = await readFile(p)
  const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"'
  cache = { path: p, mtimeMs: st.mtimeMs, size: st.size, body, etag }
  return cache
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
      // caches the parsed model in memory for the whole page session.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ETag: c.etag,
    },
  })
}

/** the game client fetches the model with POST (invisible to download managers) */
export async function POST(req: Request): Promise<Response> {
  try {
    return fileResponse(req, await loadFile())
  } catch {
    return new Response('rebel model not found (drop rebel.glb into public/staging/models/ to evaluate, or public/assets/models/ once accepted) — T players fall back to the soldier model', { status: 404 })
  }
}

/** GET kept for manual testing / curl; the game itself never uses it */
export async function GET(req: Request): Promise<Response> {
  return POST(req)
}
