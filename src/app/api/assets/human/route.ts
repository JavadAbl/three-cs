import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// The player character model is served through this extensionless route instead
// of the static `/assets/models/human.glb` path, so browser download-manager
// extensions (IDM etc.) never recognize it as a downloadable file:
//   1. no `.glb` extension in the URL (extension matching is their main trigger)
//   2. the game fetches it with method POST — download managers only hook GET
//   3. explicit `model/gltf-binary` Content-Type, never octet-stream/attachment
// The binary itself stays untracked in git (see public/assets/models/README.md).

const FILE = path.join(process.cwd(), 'public', 'assets', 'models', 'human.glb')

let cache: { body: Buffer; etag: string } | null = null

async function loadFile(): Promise<{ body: Buffer; etag: string }> {
  if (!cache) {
    const body = await readFile(FILE)
    const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"'
    cache = { body, etag }
  }
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
    return new Response('model file not found (drop human.glb into public/assets/models/)', { status: 404 })
  }
}

/** GET kept for manual testing / curl; the game itself never uses it */
export async function GET(req: Request): Promise<Response> {
  return POST(req)
}
