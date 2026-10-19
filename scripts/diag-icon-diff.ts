// Forensics: WHERE do the 180°-roll diffs sit? Theory says the new icon should
// be the exact rotation; practice shows ~1% full-alpha flips. Hypotheses:
// (a) sub-pixel edge jitter hugging the silhouette boundary (benign),
// (b) a systematic shift (bad), (c) something structural (very bad).
// This prints, for every diff pixel, the distance to the nearest alpha
// transition in the old-rotated image, plus a coarse row/col histogram.
import { readFileSync } from 'fs'
import { inflateSync } from 'node:zlib'

function decodePNG(path: string): { w: number; h: number; rgba: Uint8Array } {
  const buf = readFileSync(path)
  let w = 0, h = 0, idat: Buffer[] = []
  let off = 8
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const rgba = new Uint8Array(w * h * 4)
  const stride = w * 4 + 1
  for (let y = 0; y < h; y++) Buffer.from(raw.buffer, raw.byteOffset + y * stride + 1, w * 4).copy(rgba, y * w * 4)
  return { w, h, rgba }
}

for (const id of ['ak47', 'awp', 'deagle']) {
  const oldI = decodePNG(`/tmp/icon-old-${id}.png`)
  const newI = decodePNG(`public/staging/icons/${id}.png`)
  const { w, h } = oldI
  const alpha = (img: Uint8Array, x: number, y: number) => img[(y * w + x) * 4 + 3]
  // old rotated 180° alpha map
  const rotA = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    rotA[y * w + x] = oldI.rgba[((h - 1 - y) * w + (w - 1 - x)) * 4 + 3]
  // transition map: pixel is a boundary if any 4-neighbor alpha crosses the 128 binarization
  const solid = (x: number, y: number) => (rotA[y * w + x] >= 128 ? 1 : 0)
  const boundary = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = solid(x, y)
    if ((x > 0 && solid(x - 1, y) !== s) || (x < w - 1 && solid(x + 1, y) !== s) ||
        (y > 0 && solid(x, y - 1) !== s) || (y < h - 1 && solid(x, y + 1) !== s)) boundary[y * w + x] = 1
  }
  // distance (Chebyshev, capped at 5) of each pixel to nearest boundary pixel
  const dist = new Int8Array(w * h).fill(9)
  for (let r = 0; r <= 5; r++)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (dist[y * w + x] === 9) {
        let hit = false
        for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && boundary[ny * w + nx]) { hit = true; break }
        }
        if (hit) dist[y * w + x] = r
      }
  // diff pixels (alpha difference > 16) -> distance histogram
  const hist = new Array(7).fill(0)
  let n = 0
  const rows: number[] = [], cols: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.abs(newI.rgba[(y * w + x) * 4 + 3] - rotA[y * w + x])
    if (d > 16) {
      n++
      hist[Math.min(dist[y * w + x], 6)]++
      rows.push(y); cols.push(x)
    }
  }
  const fmt = (v: number[]) => v.join(',')
  console.log(`${id}: ${n} diff pixels (>16 alpha) — distance-to-boundary histogram [0,1,2,3,4,5,>5]: ${fmt(hist)}`)
  console.log(`   rows ${Math.min(...rows)}..${Math.max(...rows)} (h=${h}), cols ${Math.min(...cols)}..${Math.max(...cols)} (w=${w})`)
  // IoU of binarized masks
  let inter = 0, union = 0
  for (let i = 0; i < w * h; i++) {
    const a = rotA[i] >= 128 ? 1 : 0, b = newI.rgba[i * 4 + 3] >= 128 ? 1 : 0
    inter += a & b; union += a | b
  }
  console.log(`   binarized IoU: ${(100 * inter / union).toFixed(2)}%`)
}
