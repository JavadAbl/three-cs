// Task 134: validate that the packed GLB's embedded WebP images actually
// decode (sharp decode test = the same codec class a browser runs).
import { readFileSync } from 'fs'
import sharp from 'sharp'

for (const f of ['palm-hd', 'palm-low', 'palm-burned', 'palm-series']) {
  const b = readFileSync(`public/staging/models/island/${f}.glb`)
  const jl = b.readUInt32LE(12)
  const j = JSON.parse(b.slice(20, 20 + jl).toString())
  let off = 20 + jl; if (off % 4) off += 4 - (off % 4)
  const blen = b.readUInt32LE(off)
  const bin = b.slice(off + 8, off + 8 + blen)
  console.log(`== ${f}: ${j.images?.length ?? 0} images`)
  for (let i = 0; i < (j.images?.length ?? 0); i++) {
    const im = j.images[i]
    const ext = im.extensions?.EXT_texture_webp
    const bv = j.bufferViews[ext?.bufferView ?? im.bufferView]
    const bytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
    try {
      const meta = await sharp(bytes).metadata()
      console.log(`  img#${i}: ${im.mimeType} ${bytes.length}B -> decode OK ${meta.width}x${meta.height} ${meta.format}`)
    } catch (e) {
      console.log(`  img#${i}: ${im.mimeType} ${bytes.length}B -> DECODE FAILED: ${String(e).slice(0, 80)}`)
    }
  }
}
