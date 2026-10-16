// Full voxelization + isometric top-down render for visual verification
import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync('/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp')
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const lumps: Array<{ off: number; len: number }> = []
for (let i = 0; i < 15; i++) lumps.push({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const nodesOff = lumps[5].off, planesOff = lumps[1].off, leavesOff = lumps[10].off
const nLeaves = lumps[10].len / 28

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
    else if (child === -1) return 0
    else { const l = ~child; return l < nLeaves ? dv.getInt32(leavesOff + l * 28, true) : 0 }
  }
  return 0
}

const m0 = lumps[14].off
const wmin = [0, 1, 2].map(k => dv.getFloat32(m0 + k * 4, true))
const wmax = [0, 1, 2].map(k => dv.getFloat32(m0 + 12 + k * 4, true))

// ---- 1. top-down floor-height map (first walkable floor below z=300, shaded by height) ----
const CELL = 16
const W = Math.ceil((wmax[0] - wmin[0]) / CELL)
const H = Math.ceil((wmax[1] - wmin[1]) / CELL)
const floorZ: Float32Array = new Float32Array(W * H)
const solidDepth: Float32Array = new Float32Array(W * H)
for (let j = 0; j < H; j++) {
  const y = wmin[1] + (j + 0.5) * CELL
  for (let i = 0; i < W; i++) {
    const x = wmin[0] + (i + 0.5) * CELL
    // scan down from z=300 (below func_wall ceiling 384)
    let found = -9999
    let air = 0
    for (let z = 300; z >= -190; z -= 8) {
      const c = contentsAt(x, y, z)
      if (c === 0 && found === -9999) air++ // count air until floor
      if (c !== 0) { found = z + 8; break }
    }
    floorZ[j * W + i] = found
    solidDepth[j * W + i] = air * 8
  }
}
// color by floor height: -184 dark blue → -96 bright green → none = red
const px = Buffer.alloc(W * H * 3)
for (let k = 0; k < W * H; k++) {
  const z = floorZ[k]
  let r = 0, g = 0, b = 0
  if (z < -9000) { r = 30; g = 30; b = 30 } // no floor found (all air = outside?)
  else {
    const t = (z + 190) / 100 // 0 at -190, 1 at -90
    r = 40 + t * 200; g = 90 + t * 130; b = 220 - t * 200
  }
  px[k * 3] = r; px[k * 3 + 1] = g; px[k * 3 + 2] = b
}
writeFileSync('/tmp/floormap.ppm', `P6\n${W} ${H}\n255\n`)
require('fs').appendFileSync('/tmp/floormap.ppm', px)
console.log('floor map done', W, 'x', H)

// ---- 2. vertical X-Z cross-section at y=-254 (through the south slit) ----
const SW = Math.ceil((wmax[0] - wmin[0]) / CELL)
const SH = Math.ceil((wmax[2] - wmin[2]) / 8)
const sx = Buffer.alloc(SW * SH * 3)
for (let jj = 0; jj < SH; jj++) {
  const z = wmax[2] - (jj + 0.5) * 8
  for (let ii = 0; ii < SW; ii++) {
    const x = wmin[0] + (ii + 0.5) * CELL
    const c = contentsAt(x, -254, z)
    let r = 40, g = 40, b = 60
    if (c === -1) { r = 200; g = 160; b = 90 }
    else if (c === -6) { r = 90; g = 140; b = 220 }
    else if (c !== 0) { r = 90; g = 220; b = 200 }
    const k = (jj * SW + ii) * 3
    sx[k] = r; sx[k + 1] = g; sx[k + 2] = b
  }
}
writeFileSync('/tmp/xsection-slit.ppm', `P6\n${SW} ${SH}\n255\n`)
require('fs').appendFileSync('/tmp/xsection-slit.ppm', sx)
console.log('x-section done', SW, 'x', SH)

// ---- 3. vertical Y-Z cross-section at x=1040 (through T spawn) ----
const TW = Math.ceil((wmax[1] - wmin[1]) / CELL)
const TH = Math.ceil((wmax[2] - wmin[2]) / 8)
const tx = Buffer.alloc(TW * TH * 3)
for (let jj = 0; jj < TH; jj++) {
  const z = wmax[2] - (jj + 0.5) * 8
  for (let ii = 0; ii < TW; ii++) {
    const y = wmin[1] + (ii + 0.5) * CELL
    const c = contentsAt(1040, y, z)
    let r = 40, g = 40, b = 60
    if (c === -1) { r = 200; g = 160; b = 90 }
    else if (c === -6) { r = 90; g = 140; b = 220 }
    const k = (jj * TW + ii) * 3
    tx[k] = r; tx[k + 1] = g; tx[k + 2] = b
  }
}
writeFileSync('/tmp/xsection-tspawn.ppm', `P6\n${TW} ${TH}\n255\n`)
require('fs').appendFileSync('/tmp/xsection-tspawn.ppm', tx)
console.log('tspawn x-section done', TW, 'x', TH)
