// Check: do f776/f775/f843/f844 (west ramp side walls) / f357/f356 (east ramp south wall) 
// exist as triangles in geom.json? Trace what convert2.ts would emit for them.
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp'
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const L = (i: number) => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(L)
const nVerts = lumps[3].len / 12
const nEdges = lumps[12].len / 4
const nFaces = lumps[7].len / 20
const nTexinfo = lumps[6].len / 40
const nSurfedges = lumps[13].len / 4

const CHECK = [776, 775, 843, 844, 357, 356, 848, 849, 358, 359, 190, 191]
for (const fi of CHECK) {
  const o = lumps[7].off + fi * 20
  const planenum = dv.getUint16(o, true)
  const side = dv.getUint8(o + 2)
  const firstedge = dv.getInt32(o + 4, true)
  const numedges = dv.getUint16(o + 8, true)
  const texinfo = dv.getInt16(o + 10, true)
  // tex name
  const miptex = dv.getInt32(lumps[6].off + texinfo * 40 + 32, true)
  const base = lumps[2].off
  const rel = dv.getInt32(base + 4 + miptex * 4, true)
  let tname = '??'
  if (rel !== -1) {
    const p = base + rel
    tname = buf.toString('latin1', p, p + 16).replace(/\0.*$/, '')
  }
  // verts
  const verts: number[][] = []
  for (let k = 0; k < numedges; k++) {
    const se = dv.getInt32(lumps[13].off + (firstedge + k) * 4, true)
    const e = lumps[12].off + Math.abs(se) * 4
    const v = dv.getUint16(se >= 0 ? e : e + 2, true)
    verts.push([dv.getFloat32(lumps[3].off + v * 12, true), dv.getFloat32(lumps[3].off + v * 12 + 4, true), dv.getFloat32(lumps[3].off + v * 12 + 8, true)])
  }
  // surfedge sanity — replicate faceVerts()
  const ok = (() => {
    if (numedges < 3 || numedges > 32) return `numedges=${numedges}`
    if (firstedge < 0 || firstedge + numedges > nSurfedges) return `firstedge OOR`
    for (let k = 0; k < numedges; k++) {
      const se = dv.getInt32(lumps[13].off + (firstedge + k) * 4, true)
      if (Math.abs(se) >= nEdges) return `se ${se} OOR (nEdges=${nEdges})`
      const e = lumps[12].off + Math.abs(se) * 4
      const v = dv.getUint16(se >= 0 ? e : e + 2, true)
      if (v >= nVerts) return `v ${v} OOR (nVerts=${nVerts})`
    }
    return 'ok'
  })()
  console.log(`f${fi}: texinfo=${texinfo} miptex=${miptex} tex="${tname}" side=${side} ne=${numedges} faceVerts=${ok}`)
  console.log(`   verts: ${verts.map(v => `(${v[0].toFixed(1)},${v[1].toFixed(1)},${v[2].toFixed(1)})`).join(' ')}`)
}

// now check geom.json for a marker vertex of f776 (game coords)
const geom = JSON.parse(readFileSync('/home/z/my-project/public/assets/maps/aimhead/geom.json', 'utf8'))
const SCALE = 0.025, Z_REBASE = 192
const gx = (x: number) => +(x * SCALE).toFixed(4)
const gy = (z: number) => +((z + Z_REBASE) * SCALE).toFixed(4)
const gz = (y: number) => +(-y * SCALE).toFixed(4)
console.log('\n-- searching geom.json vertex pools for f776/f844/f357 marker verts (game coords) --')
for (const g of geom.groups) {
  for (let i = 0; i < g.pos.length; i += 3) {
    const px = g.pos[i], py = g.pos[i + 1], pz = g.pos[i + 2]
    // f776 verts game: x -32..-26.4, y 2.4..6.8, z -4.8 ; find any vert with pz≈-4.8 && px in [-32,-26] && py in [2.5,6.7]
    if (Math.abs(pz + 4.8) < 0.02 && px > -32.1 && px < -26.3 && py > 2.5 && py < 6.7) {
      console.log(`  WEST south-wall vert in ${g.tex}: (${px},${py},${pz})`)
    }
    // f844: z=-8.0
    if (Math.abs(pz + 8.0) < 0.02 && px > -32.1 && px < -26.3 && py > 2.5 && py < 6.7) {
      console.log(`  WEST north-wall vert in ${g.tex}: (${px},${py},${pz})`)
    }
    // f357 east south wall: z=-4.8, x 24.8..30.4
    if (Math.abs(pz + 4.8) < 0.02 && px > 24.7 && px < 30.5 && py > 2.5 && py < 6.7) {
      console.log(`  EAST south-wall vert in ${g.tex}: (${px},${py},${pz})`)
    }
    // east north wall f? at y=320 → z=-8: x 24.8..30.4
    if (Math.abs(pz + 8.0) < 0.02 && px > 24.7 && px < 30.5 && py > 2.5 && py < 6.7) {
      console.log(`  EAST north-wall vert in ${g.tex}: (${px},${py},${pz})`)
    }
  }
}
console.log('(no output above = side walls missing from render)')
