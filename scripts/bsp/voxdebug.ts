// Voxel debug render — cross-sections of the leaf-walk solid map
import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync('/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp')
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const lumps: Array<{ off: number; len: number }> = []
for (let i = 0; i < 15; i++) lumps.push({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const nodesOff = lumps[5].off, planesOff = lumps[1].off, leavesOff = lumps[10].off
const nLeaves = lumps[10].len / 28

// empty: child==-1 (dummy leaf 0); solid: contents -1; sky: -6
function contentsAt(x: number, y: number, z: number): number {
  let n = dv.getInt32(lumps[14].off + 36, true)
  let guard = 0
  while (n >= 0 && guard++ < 300) {
    const o = nodesOff + n * 24
    const planenum = dv.getInt32(o, true)
    const po = planesOff + planenum * 20
    const nx = dv.getFloat32(po, true), ny = dv.getFloat32(po + 4, true), nz = dv.getFloat32(po + 8, true), d = dv.getFloat32(po + 12, true)
    const side = (nx * x + ny * y + nz * z - d) >= 0 ? 0 : 1
    const child = dv.getInt16(o + 4 + side * 2, true)
    if (child >= 0) n = child
    else if (child === -1) return 0 // dummy leaf 0 = empty
    else { const l = ~child; return l < nLeaves ? dv.getInt32(leavesOff + l * 28, true) : 0 }
  }
  return 0
}

// world bounds
const m0 = lumps[14].off
const wmin = [0, 1, 2].map(k => dv.getFloat32(m0 + k * 4, true))
const wmax = [0, 1, 2].map(k => dv.getFloat32(m0 + 12 + k * 4, true))
console.log('bounds', wmin, wmax)

// horizontal slices at various z + one vertical slice
const CELL = 16 // bsp units per pixel
function renderSlice(z: number, name: string) {
  const W = Math.ceil((wmax[0] - wmin[0]) / CELL)
  const H = Math.ceil((wmax[1] - wmin[1]) / CELL)
  const px = Buffer.alloc(W * H * 3)
  for (let j = 0; j < H; j++) {
    const y = wmin[1] + (j + 0.5) * CELL
    for (let i = 0; i < W; i++) {
      const x = wmin[0] + (i + 0.5) * CELL
      const c = contentsAt(x, y, z)
      let r = 40, g = 40, b = 60 // empty
      if (c === -1) { r = 200; g = 160; b = 90 } // solid
      else if (c === -6) { r = 90; g = 140; b = 220 } // sky
      else if (c === -2) { r = 90; g = 220; b = 200 } // water/other
      const k = (j * W + i) * 3
      px[k] = r; px[k + 1] = g; px[k + 2] = b
    }
  }
  // PPM → PNG via no compression trick: write PPM (viewable) + also convert later
  writeFileSync(`/tmp/slice-${name}.ppm`, `P6\n${W} ${H}\n255\n`)
  const fs = require('fs')
  fs.appendFileSync(`/tmp/slice-${name}.ppm`, px)
  console.log(`slice z=${z} (${name}) → ${W}x${H}, solids: ${[...px].filter((v, idx) => idx % 3 === 0 && v === 200).length}`)
}
for (const [z, n] of [[-112, 'floor-112'], [-64, 'mid-64'], [0, 'spawn0'], [128, 'upper128'], [420, 'ceil420']] as const) {
  renderSlice(z, n)
}
