// Task 113 — find WHAT geometry sits at |x| extremes in the staged human.glb.
// The normalized model spans ±0.54 m sideways (1.08 m wide!) — hands are at
// ±0.36, so something else bulges to ±0.54. Dump verts with |x| > 2.5 raw
// (≈0.45 normalized) grouped by mesh + their (y,z) body region, and the
// overall per-axis histogram of the width.
import fs from 'node:fs'

function parseGLB(path) {
  const b = fs.readFileSync(path)
  const jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString())
  let off = 20 + jsonLen
  if (off % 4) off += 4 - (off % 4)
  const binLen = b.readUInt32LE(off)
  const binStart = off + 8
  return { json, bin: b.subarray(binStart, binStart + binLen) }
}

const { json: j, bin } = parseGLB('public/staging/models/human.glb')

// node -> mesh mapping (nodes 2..6 carry meshes 0..4)
const nodeMesh = {}
for (const [ni, n] of (j.nodes ?? []).entries()) if (n.mesh !== undefined) nodeMesh[ni] = n.mesh
const meshName = (mi) => {
  const node = (j.nodes ?? []).find(n => n.mesh === mi)
  return node?.name ?? `mesh${mi}`
}

// per mesh: count verts by |x| band, and capture extremes
for (const [mi, m] of (j.meshes ?? []).entries()) {
  for (const prim of m.primitives) {
    const pa = j.accessors[prim.attributes.POSITION]
    const bv = j.bufferViews[pa.bufferView]
    const base = (bv.byteOffset ?? 0) + (pa.byteOffset ?? 0)
    const arr = new Float32Array(bin.buffer, bin.byteOffset + base, pa.count * 3)
    const bands = { '<1.0': 0, '1.0-2.0': 0, '2.0-2.5': 0, '2.5-3.0': 0, '>3.0': 0 }
    const ext = []
    let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < pa.count; i++) {
      const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2]
      const ax = Math.abs(x)
      if (ax < 1) bands['<1.0']++
      else if (ax < 2) bands['1.0-2.0']++
      else if (ax < 2.5) bands['2.0-2.5']++
      else if (ax < 3) bands['2.5-3.0']++
      else bands['>3.0']++
      if (ax > 2.5 && ext.length < 400) ext.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)])
      if (ax > 2.5) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z) }
    }
    console.log(`\nmesh[${mi}] "${meshName(mi)}" verts=${pa.count}`)
    console.log(`  |x| bands: ${JSON.stringify(bands)}`)
    if (ext.length) {
      console.log(`  |x|>2.5 verts: ${ext.length}+ sampled, y∈[${minY.toFixed(2)},${maxY.toFixed(2)}] z∈[${minZ.toFixed(2)},${maxZ.toFixed(2)}] (raw; height axis = z)`)
      console.log(`  first 12: ${JSON.stringify(ext.slice(0, 12))}`)
    }
  }
}
