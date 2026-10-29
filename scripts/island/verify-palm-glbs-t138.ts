// ============================================================
// Task 138 — numeric sanity gate for the packed island palm GLBs.
//
// WHY: the Task-134 pack used `gltf-transform quantize`, which in this
// sandbox baked node.scale = 8.5e37 (reciprocal of float32-min-normal)
// into every palm. three renders KHR_mesh_quantization positions as
// normalized ints × node matrix => every palm rendered ~10^38 units
// away: perfect scene graph, zero pixels, "no trees on island".
// The Task-134 gate checked triangle COUNTS only. This gate checks
// the TRANSFORMS and attribute types, which is what actually
// determines whether the mesh lands inside the camera frustum.
//
// Run:  bun scripts/island/verify-palm-glbs-t138.ts
// Exit: 0 = all green, 1 = any FAIL line.
import { readFileSync } from 'fs'

const MODELS = ['palm-hd', 'palm-low', 'palm-burned', 'palm-series']
const DIR = 'public/staging/models/island'

function parseGLB(path: string): { json: any; bin: Buffer } {
  const b = readFileSync(path)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path)
  const total = b.readUInt32LE(8)
  let off = 12
  const jlen = b.readUInt32LE(off)
  if (b.readUInt32LE(off + 4) !== 0x4e4f534a) throw new Error('chunk 0 not JSON')
  const json = JSON.parse(b.slice(off + 8, off + 8 + jlen).toString('utf8'))
  off += 8 + jlen + ((jlen % 4) ? (4 - (jlen % 4)) : 0)
  if (off + 8 > total) return { json, bin: Buffer.alloc(0) }
  const blen = b.readUInt32LE(off)
  if (b.readUInt32LE(off + 4) !== 0x004e4942) throw new Error('chunk 1 not BIN')
  return { json, bin: b.slice(off + 8, off + 8 + blen) }
}

// the exact render-space math three performs for a vertex:
//   v = raw_value (normalized attr: divided by 32767 etc.) * nodeScale + nodePos
// then the engine multiplies by inst.scale (target height) + inst.position.
function renderableVertexY(raw: number, normalized: boolean, compType: number): number {
  let v = raw
  if (normalized) {
    const div = compType === 5126 ? 1 : compType === 5122 ? 32767 : compType === 5121 ? 255 : 65535
    v = v / div
  }
  return v
}

let fails = 0, checks = 0
function assert(cond: boolean, label: string, detail?: string) {
  checks++
  if (!cond) { fails++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

for (const m of MODELS) {
  const path = `${DIR}/${m}.glb`
  const { json, bin } = parseGLB(path)
  console.log(`\n${m} (${bin.length + 20} bytes BIN)`)

  // 1. NO quantization extension, float32 positions
  const exts: string[] = json.extensionsUsed || []
  assert(!exts.includes('KHR_mesh_quantization'), 'no KHR_mesh_quantization', `extensionsUsed=${JSON.stringify(exts)}`)

  // 2. node transforms: finite + sane magnitude (this is the 8.5e37 gate)
  for (const [i, n] of (json.nodes || []).entries()) {
    for (const k of ['scale', 'translation', 'rotation'] as const) {
      const v = n[k]
      if (v === undefined) continue
      assert(v.every((x: number) => Number.isFinite(x) && Math.abs(x) < 1000),
        `node[${i}].${k} sane`, JSON.stringify(v))
    }
    if (n.matrix) assert(n.matrix.every((x: number) => Number.isFinite(x) && Math.abs(x) < 1000), `node[${i}].matrix sane`)
  }

  // 3. POSITION accessors: float32 + bufferView byteLength EXACTLY fits
  //    count * comps * 4 (Task 138: Bun's Buffer.from(Float32Array) wrote
  //    4x-short views — this assert nails that class of corruption), and
  //    render-space y span sane (per-MODEL union; sub-meshes span partial
  //    heights — fronds start at ~0.45, bark at 0 — only the union must be [0,1])
  const meshPrims: any[] = (json.meshes || []).flatMap((mm: any) => mm.primitives)
  assert(meshPrims.length >= 1, 'has mesh primitives')
  const ymn = [], ymx = []
  for (const [pi, pr] of meshPrims.entries()) {
    const acc = json.accessors[pr.attributes.POSITION]
    assert(acc.componentType === 5126, `prim[${pi}] POSITION is float32`, `componentType=${acc.componentType}`)
    const bv = json.bufferViews[acc.bufferView]
    assert(bv.byteLength >= acc.count * 12, `prim[${pi}] POSITION view fits data (Task 138 truncation gate)`,
      `view=${bv.byteLength}B need=${acc.count * 12}B`)
    const mn = acc.min, mx = acc.max
    assert(Array.isArray(mn) && Array.isArray(mx), `prim[${pi}] POSITION has min/max`)
    if (Array.isArray(mn) && Array.isArray(mx)) {
      ymn.push(mn[1]); ymx.push(mx[1])
      assert(Math.max(...mn.map(Math.abs), ...mx.map(Math.abs)) < 5, `prim[${pi}] footprint sane`,
        `min=${mn.map((x: number) => +x.toFixed(2))} max=${mx.map((x: number) => +x.toFixed(2))}`)
    }
    // spot-check raw buffer values against accessor min/max (catches
    // buffer/offset misalignment: first vertex must lie inside the bbox)
    const off = (bv.byteOffset || 0) + (acc.byteOffset || 0)
    const sample = [0, 1, 2].map(c => {
      const raw = bin.readFloatLE(off + c * 4)
      return renderableVertexY(raw, acc.normalized === true, acc.componentType)
    })
    assert(sample.every((v, c) => v >= mn[c] - 1e-3 && v <= mx[c] + 1e-3),
      `prim[${pi}] buffer sample inside min/max`, `sample=${sample.map(v => +v.toFixed(3))}`)
  }
  // model-union height: base ≈ 0, top ≈ 1 (height-1 normalize contract)
  if (ymn.length) {
    const lo = Math.min(...ymn), hi = Math.max(...ymx)
    assert(lo >= -0.1 && lo <= 0.1, 'model base at y≈0', `union min.y=${lo.toFixed(3)}`)
    assert(hi >= 0.9 && hi <= 1.1, 'model top at y≈1 (height-1)', `union max.y=${hi.toFixed(3)}`)
  }

  // 4. index validity: max index < vertex count (catches broken merges)
  for (const [pi, pr] of meshPrims.entries()) {
    if (pr.indices === undefined) continue
    const iAcc = json.accessors[pr.indices]
    const pAcc = json.accessors[pr.attributes.POSITION]
    const ibv = json.bufferViews[iAcc.bufferView]
    const iOff = (ibv.byteOffset || 0) + (iAcc.byteOffset || 0)
    const w = iAcc.componentType === 5125 ? 4 : 2
    let maxIdx = -1
    for (let i = 0; i < iAcc.count; i++) {
      const v = w === 4 ? bin.readUInt32LE(iOff + i * w) : bin.readUInt16LE(iOff + i * w)
      if (v > maxIdx) maxIdx = v
      if (i > 20000) break // sample cap; full sweep for small meshes
    }
    assert(maxIdx < pAcc.count, `prim[${pi}] indices < vertexCount`, `maxIdx=${maxIdx} verts=${pAcc.count}`)
  }

  // 5. images are webp (payload still compressed)
  const imgs: string[] = (json.images || []).map((im: any) => im.mimeType || '?')
  assert(imgs.length > 0 && imgs.every(t => t === 'image/webp'), 'textures are webp', JSON.stringify(imgs.slice(0, 3)))
}

console.log(`\n${checks - fails}/${checks} checks green, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
