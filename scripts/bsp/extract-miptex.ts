// Extract embedded miptex textures from a BSP v30 file as PPM images (mip 0).
// Palette-fidelity ground truth for re-skinning (Task 77: aim_headshot greens).
// Usage: npx tsx scripts/bsp/extract-miptex.ts <file.bsp> <outdir>
import * as fs from 'fs'
import * as path from 'path'

const [bspPath, outDir] = process.argv.slice(2) as [string, string]
const buf = fs.readFileSync(bspPath)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const lumps: Array<{ off: number; len: number }> = []
const lumpDirOff = 4 // GoldSrc BSP30: int32 version at 0, then lump_t[15] at 4
const nLumps = 15
for (let i = 0; i < nLumps; i++) {
  lumps.push({ off: dv.getInt32(lumpDirOff + i * 8, true), len: dv.getInt32(lumpDirOff + i * 8 + 4, true) })
}

const miptexOff = lumps[2].off, miptexLen = lumps[2].len
const num = dv.getInt32(miptexOff, true)
fs.mkdirSync(outDir, { recursive: true })

for (let i = 0; i < num; i++) {
  const rel = dv.getInt32(miptexOff + 4 + i * 4, true)
  if (rel === -1) continue // external (wad) — not embedded
  const p = miptexOff + rel
  const name = buf.toString('latin1', p, p + 16).replace(/\0.*$/, '').replace(/[^A-Za-z0-9_-]/g, '_')
  const w = dv.getUint32(p + 16, true), h = dv.getUint32(p + 20, true)
  if (w === 0 || h === 0 || w > 512 || name === 'sky' || name.startsWith('{')) continue
  const off0 = dv.getUint32(p + 24, true)
  const off3 = dv.getUint32(p + 36, true)
  const mip3Bytes = (w >> 3) * (h >> 3)
  const palOff = p + off3 + mip3Bytes
  const palSize = dv.getUint16(palOff, true)
  if (palSize !== 256) { console.log(`skip ${name}: palette size ${palSize}`); continue }
  const pal = new Uint8Array(buf.buffer, buf.byteOffset + palOff + 2, 256 * 3)
  const px = new Uint8Array(buf.buffer, buf.byteOffset + p + off0, w * h)

  // mean color of mip0 (palette-weighted)
  let r = 0, g = 0, b = 0
  for (let k = 0; k < w * h; k++) {
    const c = px[k] * 3
    r += pal[c]; g += pal[c + 1]; b += pal[c + 2]
  }
  r = Math.round(r / (w * h)); g = Math.round(g / (w * h)); b = Math.round(b / (w * h))

  // write PPM (P6) — PIL converts downstream
  const out = Buffer.alloc(3 * w * h)
  for (let k = 0; k < w * h; k++) {
    const c = px[k] * 3
    out[k * 3] = pal[c]; out[k * 3 + 1] = pal[c + 1]; out[k * 3 + 2] = pal[c + 2]
  }
  const file = path.join(outDir, `${String(i).padStart(2, '0')}_${name}.ppm`)
  fs.writeFileSync(file, Buffer.from(`P6\n${w} ${h}\n255\n`, 'ascii'), )
  fs.appendFileSync(file, out)
  console.log(`${name}  ${w}x${h}  meanRGB(${r},${g},${b})  -> ${file}`)
}
