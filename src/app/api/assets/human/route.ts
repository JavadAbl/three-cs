import { readFile, access, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// The player character model is served through this extensionless route instead
// of the static `/assets/models/human.glb` path, so browser download-manager
// extensions (IDM etc.) never recognize it as a downloadable file:
//   1. no `.glb` extension in the URL (extension matching is their main trigger)
//   2. the game fetches it with method POST — download managers only hook GET
//   3. explicit `model/gltf-binary` Content-Type, never octet-stream/attachment
// The binary is committed when ACCEPTED (see the policy below and
// public/assets/models/README.md); pending/evaluation copies live in
// public/staging (gitignored).

// Asset-acceptance policy v3: accepted model = public/assets/models/human.glb
// (committed). Pending model = public/staging/models/human.glb (gitignored,
// evaluation copy). STAGING WINS if present — dropping a new version into
// staging immediately overrides the accepted copy, so the user can evaluate
// it live; acceptance is a plain `mv staging -> assets` + `git add` +
// ASSET_CACHE_VERSION bump (the staged human payload IS a cached key by
// then, see preloader.ts).
// ACCEPTED (Task 117 acceptance, 2026-10-25): committed at
// public/assets/models/human.glb (sha1 cdd14b1d4477e8b6bd04bf7acfbfb23a19b70827,
// 9,723,308 B — the Task-112 v2 arm-surgery bake that Task 113 live-verified
// human-scale) + ASSET_CACHE_VERSION v7→v8.
const ACCEPTED = path.join(process.cwd(), 'public', 'assets', 'models', 'human.glb')
const STAGED = path.join(process.cwd(), 'public', 'staging', 'models', 'human.glb')

async function resolveFile(): Promise<string> {
  try { await access(STAGED); return STAGED } catch { /* no staged copy */ }
  return ACCEPTED
}

// Task 113: this cache used to hold the parsed body FOREVER — "touch this
// file (or restart dev) after replacing the model" — and that footgun is
// exactly what showed the user a giant supine spiky "monster": the Task-112
// v1 bake entered the module cache, the v2 re-bake replaced the file on disk
// 30 s later, but the running dev server kept serving v1 (sha/content-length
// mismatch vs the on-disk file proved it). Now every request stats the
// resolved file (path + mtimeMs + size — a microsecond operation) and any
// change re-reads the body and re-hashes the etag. Replacing the staged or
// accepted file is picked up on the very next request, no touch/restart.
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
    return new Response('model file not found (drop human.glb into public/staging/models/ to evaluate, or public/assets/models/ once accepted)', { status: 404 })
  }
}

/** GET kept for manual testing / curl; the game itself never uses it */
export async function GET(req: Request): Promise<Response> {
  return POST(req)
}
