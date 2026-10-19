// ============================================================
// make-draco-demo-glb.ts — reproducible Draco-compression benchmark.
//
// Generates a synthetic "rifle" GLB at the WEAPONS_PLAN viewmodel
// budget (~13k tris, raw float32 position/normal/uv — exactly what
// Blender's default GLB export produces), with named part nodes
// matching the engine's ViewModel convention (body/mag/bolt/...).
// Then we can measure what `gltf-transform draco` saves on it and
// verify that node names survive compression (engine animates by
// node name — slide/bolt/mag/pump).
//
// Run: bun scripts/make-draco-demo-glb.ts
// Output: scripts/.tmp/rifle-raw.glb (delete after measuring;
//         the numbers land in the models README + worklog).
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

type V3 = [number, number, number]

interface Raw {
  pos: number[]
  norm: number[]
  uv: number[]
  idx: number[]
}

/** (seg+1)² vertex grid over u,v ∈ [0,1]; u→right, v→up as seen from
 *  outside (face-local), so (a,b,c)/(b,d,c) is CCW from the +normal side. */
function grid(seg: number, fn: (u: number, v: number) => { p: V3; n: V3 }): Raw {
  const pos: number[] = [], norm: number[] = [], uv: number[] = [], idx: number[] = []
  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j <= seg; j++) {
      const u = i / seg, v = j / seg
      const r = fn(u, v)
      pos.push(r.p[0], r.p[1], r.p[2])
      norm.push(r.n[0], r.n[1], r.n[2])
      uv.push(u, v)
    }
  }
  const W = seg + 1
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1
      idx.push(a, b, c, b, d, c)
    }
  }
  return { pos, norm, uv, idx }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Subdivided box centered at origin — 12·seg² triangles, outward normals. */
function boxMesh(w: number, h: number, d: number, seg: number): Raw {
  const hw = w / 2, hh = h / 2, hd = d / 2
  const faces: Array<(u: number, v: number) => { p: V3; n: V3 }> = [
    // +Z (from +Z: right=+X, up=+Y)
    (u, v) => ({ p: [lerp(-hw, hw, u), lerp(-hh, hh, v), hd], n: [0, 0, 1] }),
    // -Z (from -Z: right=-X, up=+Y)
    (u, v) => ({ p: [lerp(hw, -hw, u), lerp(-hh, hh, v), -hd], n: [0, 0, -1] }),
    // +X (from +X: right=-Z, up=+Y)
    (u, v) => ({ p: [hw, lerp(-hh, hh, v), lerp(hd, -hd, u)], n: [1, 0, 0] }),
    // -X (from -X: right=+Z, up=+Y)
    (u, v) => ({ p: [-hw, lerp(-hh, hh, v), lerp(-hd, hd, u)], n: [-1, 0, 0] }),
    // +Y (from above: right=+X, up=-Z)
    (u, v) => ({ p: [lerp(-hw, hw, u), hh, lerp(hd, -hd, v)], n: [0, 1, 0] }),
    // -Y (from below: right=+X, up=+Z)
    (u, v) => ({ p: [lerp(-hw, hw, u), -hh, lerp(-hd, hd, v)], n: [0, -1, 0] }),
  ]
  const out: Raw = { pos: [], norm: [], uv: [], idx: [] }
  let base = 0
  for (const f of faces) {
    const g = grid(seg, f)
    out.pos.push(...g.pos); out.norm.push(...g.norm); out.uv.push(...g.uv)
    for (const i of g.idx) out.idx.push(i + base)
    base += (seg + 1) * (seg + 1)
  }
  return out
}

/** Cylinder along Z (muzzle toward -Z, our model convention).
 *  Sides: n·rings·2 tris + 2 n-gon cap fans. */
function cylMeshZ(r: number, len: number, n: number, rings: number): Raw {
  const out: Raw = { pos: [], norm: [], uv: [], idx: [] }
  const zOf = (j: number) => -len / 2 + (len * j) / rings
  // side grid: i ∈ [0..n] (seam column duplicated for clean u=0/u=1 UVs)
  for (let i = 0; i <= n; i++) {
    const th = (2 * Math.PI * i) / n
    const cx = Math.cos(th), cy = Math.sin(th)
    for (let j = 0; j <= rings; j++) {
      out.pos.push(r * cx, r * cy, zOf(j))
      out.norm.push(cx, cy, 0)
      out.uv.push(i / n, j / rings)
    }
  }
  const W = rings + 1
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < rings; j++) {
      const a = i * W + j, b = (i + 1) * W + j, c = a + 1, d = b + 1
      out.idx.push(a, b, c, b, d, c)
    }
  }
  // caps
  for (const front of [true, false]) {
    const z = front ? len / 2 : -len / 2
    const nz = front ? 1 : -1
    const center = out.pos.length / 3
    out.pos.push(0, 0, z); out.norm.push(0, 0, nz); out.uv.push(0.5, 0.5)
    const ringStart = out.pos.length / 3
    for (let i = 0; i <= n; i++) {
      const th = (2 * Math.PI * i) / n
      out.pos.push(r * Math.cos(th), r * Math.sin(th), z)
      out.norm.push(0, 0, nz)
      out.uv.push(0.5 + 0.5 * Math.cos(th), 0.5 + 0.5 * Math.sin(th))
    }
    for (let i = 0; i < n; i++) {
      const a = ringStart + i, b = ringStart + i + 1
      if (front) out.idx.push(center, a, b)
      else out.idx.push(center, b, a)
    }
  }
  return out
}

// ---------------------------------------------------------------- assembly

interface Part { name: string; raw: Raw; t: V3 }

/** Rifle-ish silhouette at the WEAPONS_PLAN viewmodel budget.
 *  Node names deliberately match the engine's ViewModel convention. */
const parts: Part[] = [
  { name: 'body', raw: boxMesh(0.05, 0.075, 0.5, 18), t: [0, 0, -0.05] },
  { name: 'handguard', raw: boxMesh(0.042, 0.05, 0.24, 12), t: [0, 0.005, -0.33] },
  { name: 'barrel', raw: cylMeshZ(0.008, 0.34, 24, 32), t: [0, 0.012, -0.46] },
  { name: 'muzzle', raw: cylMeshZ(0.012, 0.06, 12, 6), t: [0, 0.012, -0.64] },
  { name: 'stock', raw: boxMesh(0.035, 0.06, 0.22, 12), t: [0, -0.008, 0.2] },
  { name: 'mag', raw: boxMesh(0.03, 0.13, 0.055, 12), t: [0, -0.1, -0.1] },
  { name: 'grip', raw: boxMesh(0.028, 0.085, 0.04, 10), t: [0, -0.07, 0.04] },
  { name: 'bolt', raw: boxMesh(0.018, 0.02, 0.1, 8), t: [0, 0.048, -0.03] },
]

function build(): Buffer {
  // BIN packing (4-byte-aligned views)
  const views: Array<{ buffer: number; byteOffset: number; byteLength: number; target: number }> = []
  const accessors: Array<Record<string, unknown>> = []
  const chunks: Uint8Array[] = []
  let binLen = 0
  const push = (arr: Float32Array | Uint16Array, target: number): number => {
    const pad = (4 - (binLen % 4)) % 4
    if (pad) { chunks.push(new Uint8Array(pad)); binLen += pad }
    views.push({ buffer: 0, byteOffset: binLen, byteLength: arr.byteLength, target })
    chunks.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
    binLen += arr.byteLength
    return views.length - 1
  }
  const acc = (view: number, comp: number, count: number, type: string, minmax?: number[]) => {
    accessors.push({ bufferView: view, componentType: comp, count, type, ...(minmax ? { min: minmax.slice(0, 3), max: minmax.slice(3) } : {}) })
    return accessors.length - 1
  }

  const nodes: Array<Record<string, unknown>> = []
  const meshes: Array<Record<string, unknown>> = []
  let totalTris = 0, totalVerts = 0

  for (const p of parts) {
    const pos = new Float32Array(p.raw.pos)
    const norm = new Float32Array(p.raw.norm)
    const uv = new Float32Array(p.raw.uv)
    const idx = new Uint16Array(p.raw.idx)
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k])
        max[k] = Math.max(max[k], pos[i + k])
      }
    }
    const pa = acc(push(pos, 34962), 5126, pos.length / 3, 'VEC3', [...min, ...max])
    const na = acc(push(norm, 34962), 5126, norm.length / 3, 'VEC3')
    const ta = acc(push(uv, 34962), 5126, uv.length / 2, 'VEC2')
    const ia = acc(push(idx, 34963), 5123, idx.length, 'SCALAR')
    const meshIdx = meshes.length
    meshes.push({
      name: p.name,
      primitives: [{ attributes: { POSITION: pa, NORMAL: na, TEXCOORD_0: ta }, indices: ia, material: 0 }],
    })
    nodes.push({ name: p.name, mesh: meshIdx, translation: p.t })
    totalTris += idx.length / 3
    totalVerts += pos.length / 3
  }

  const gltf = {
    asset: { version: '2.0', generator: 'make-draco-demo-glb' },
    scene: 0,
    scenes: [{ name: 'rifle', nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [{
      name: 'steel',
      pbrMetallicRoughness: { baseColorFactor: [0.28, 0.28, 0.3, 1], metallicFactor: 0.85, roughnessFactor: 0.35 },
    }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: binLen }],
  }

  // GLB container
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  const binPad = (4 - (binLen % 4)) % 4
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLen + binPad
  const out = Buffer.alloc(total)
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
  let o = 0
  dv.setUint32(o, 0x46546c67, true); o += 4        // 'glTF'
  dv.setUint32(o, 2, true); o += 4
  dv.setUint32(o, total, true); o += 4
  dv.setUint32(o, jsonBytes.length + jsonPad, true); o += 4
  dv.setUint32(o, 0x4e4f534a, true); o += 4        // 'JSON'
  out.set(jsonBytes, o); o += jsonBytes.length
  out.fill(0x20, o, o + jsonPad); o += jsonPad
  dv.setUint32(o, binLen + binPad, true); o += 4
  dv.setUint32(o, 0x004e4942, true); o += 4        // 'BIN'
  for (const c of chunks) { out.set(c, o); o += c.length }
  // binPad bytes stay zero from alloc

  console.log(`parts=${parts.length} verts=${totalVerts} tris=${totalTris} bin=${binLen}B glb=${total}B`)
  return out
}

const dir = path.join(process.cwd(), 'scripts', '.tmp')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'rifle-raw.glb')
writeFileSync(file, build())
console.log('wrote', file)
