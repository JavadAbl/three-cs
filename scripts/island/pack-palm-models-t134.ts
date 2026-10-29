// ============================================================
// Task 134 — pack the 4 user-provided palm GLBs into engine-ready
// island prop models (authoring-time, deterministic):
//
//   upload/*.glb  ->  (intermediate merged/normalized GLB in .tmp)
//                 ->  public/staging/models/island/{palm-hd,palm-low,
//                     palm-burned,palm-series}.glb  (via compress-glb.sh:
//                     prune/dedup/weld/webp/draco)
//                 ->  public/staging/models/island/sources.json (provenance)
//
// What this script does per model (pure math, no DOM — images are
// passed through byte-exact, re-encoded by gltf-transform's webp step):
//   1. parse the GLB, compute node world matrices (TRS chains)
//   2. bake every mesh primitive into world space, MERGE per material
//      (the plant-series model is an exploded Sketchfab export: 64
//      separate frond meshes -> 2 merged draw calls)
//   3. normalize: auto-detect Z-up, rotate if needed; recenter base to
//      origin (min-y = 0, x/z centered); uniform-scale to height 1.0 —
//      the engine then scales per-instance by the target palm height
//      (5.5-9 m, the SAME h0 draw the procedural palms used, so collider
//      boxes keep matching the visual)
//   4. write a minimal clean GLB (1 buffer; geometry rebuilt; materials/
//      textures/images copied with remapped bufferViews)
//   5. shells out to compress-glb.sh (weld + webp textures + draco)
//
// Run:  bun scripts/island/pack-palm-models-t134.ts
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { execSync } from 'child_process'
import * as THREE from 'three'

// three BufferGeometryUtils.mergeGeometries — pure JS, DOM-free
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const UPLOAD = [
  { src: 'upload/realistic_hd_windmill_palm_125.glb', out: 'palm-hd' },
  { src: 'upload/low_poly_palm_tree.glb', out: 'palm-low' },
  { src: 'upload/burned_palm_tree.glb', out: 'palm-burned' },
  { src: 'upload/plant_series__palm_tree.glb', out: 'palm-series' },
]
const TMP_DIR = 'scripts/.tmp/palm-pack'
const STAGE_DIR = 'public/staging/models/island'
mkdirSync(TMP_DIR, { recursive: true })
mkdirSync(STAGE_DIR, { recursive: true })

// ---------------------------------------------------------------- GLB parse
type Parsed = { json: any; bin: Buffer }
function parseGLB(path: string): Parsed {
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

// read an accessor (positions/normals/uvs/indices) with stride handling
function readAccessor(j: any, bin: Buffer, ai: number): any {
  const a = j.accessors[ai]
  const v = j.bufferViews[a.bufferView]
  const off = (v.byteOffset || 0) + (a.byteOffset || 0)
  const n = a.count
  const comps: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
  const nc = comps[a.type] ?? 1
  const fmts: Record<number, [string, number]> = { 5126: ['f32', 4], 5123: ['u16', 2], 5125: ['u32', 4], 5121: ['u8', 1] }
  const [fmt, size] = fmts[a.componentType]
  const stride = v.byteStride || nc * size
  const out: number[] = new Array(n * nc)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const p = off + i * stride + c * size
      out[i * nc + c] = fmt === 'f32' ? bin.readFloatLE(p)
        : fmt === 'u16' ? bin.readUInt16LE(p)
          : fmt === 'u32' ? bin.readUInt32LE(p)
            : bin.readUInt8(p)
    }
  }
  return out
}

// node local matrix from TRS or matrix
function localMatrix(n: any): THREE.Matrix4 {
  if (n.matrix) return new THREE.Matrix4().fromArray(n.matrix)
  const t = new THREE.Vector3(...(n.translation || [0, 0, 0]))
  const q = new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1]))
  const s = new THREE.Vector3(...(n.scale || [1, 1, 1]))
  return new THREE.Matrix4().compose(t, q, s)
}

// ---------------------------------------------------------------- main pack
type MatGeo = { material: number; geoms: THREE.BufferGeometry[] }
const provenance: any[] = []

for (const { src, out } of UPLOAD) {
  const { json, bin } = parseGLB(src)
  const sceneNodes: number[] = (json.scenes?.[json.scene ?? 0]?.nodes) ?? []
  // world matrix per node
  const world = new Map<number, THREE.Matrix4>()
  const walk = (idx: number, parent: THREE.Matrix4) => {
    const n = json.nodes[idx]
    const w = parent.clone().multiply(localMatrix(n))
    world.set(idx, w)
    for (const c of (n.children || [])) walk(c, w)
  }
  for (const r of sceneNodes) walk(r, new THREE.Matrix4())

  // gather primitives into world space, grouped by material
  const byMat = new Map<number, THREE.BufferGeometry[]>()
  let droppedPrims = 0, tris = 0
  for (const [idx, w] of world) {
    const n = json.nodes[idx]
    if (n.mesh === undefined) continue
    for (const pr of json.meshes[n.mesh].primitives) {
      if ((pr.mode ?? 4) !== 4) { droppedPrims++; continue }
      const posA = pr.attributes?.POSITION
      if (posA === undefined) { droppedPrims++; continue }
      const pos = readAccessor(json, bin, posA)
      const uvA = pr.attributes?.TEXCOORD_0
      const normA = pr.attributes?.NORMAL
      const vCount = pos.length / 3
      // bake world transform
      const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(w)
      const positions = new Float32Array(vCount * 3)
      for (let i = 0; i < vCount; i++) {
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(w)
        positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      // normals: transform (or synthesize flat from faces after merge if absent)
      const normals = new Float32Array(vCount * 3)
      if (normA !== undefined) {
        const na = readAccessor(json, bin, normA)
        const nv = new THREE.Vector3()
        for (let i = 0; i < vCount; i++) {
          nv.set(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]).applyMatrix3(nm).normalize()
          normals[i * 3] = nv.x; normals[i * 3 + 1] = nv.y; normals[i * 3 + 2] = nv.z
        }
      }
      g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      const uvs = new Float32Array(vCount * 2)
      if (uvA !== undefined) {
        const ua = readAccessor(json, bin, uvA)
        for (let i = 0; i < vCount * 2; i++) uvs[i] = ua[i]
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      if (pr.indices !== undefined) {
        const idx = readAccessor(json, bin, pr.indices)
        g.setIndex(idx)
        tris += idx.length / 3
      } else tris += vCount / 3
      const mat = pr.material ?? 0
      if (!byMat.has(mat)) byMat.set(mat, [])
      byMat.get(mat)!.push(g)
    }
  }
  if (droppedPrims) console.log(`  (dropped ${droppedPrims} non-triangle primitives)`)

  // merge per material; synthesize missing normals AFTER merge (flat)
  const matGeoms: MatGeo[] = [...byMat.entries()].map(([material, geoms]) => {
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false)!
    if (!merged.getAttribute('normal') || (merged.getAttribute('normal') as THREE.BufferAttribute).array.every((x: number) => x === 0))
      merged.computeVertexNormals()
    return { material, geoms: [merged] }
  })

  // whole-model bbox
  const bb = new THREE.Box3()
  for (const mg of matGeoms) {
    mg.geoms[0].computeBoundingBox()
    bb.union(mg.geoms[0].boundingBox!)
  }
  const size = new THREE.Vector3(); bb.getSize(size)
  let upAxis: 'y' | 'z' = (size.y >= size.z * 0.7 && size.y >= size.x * 0.55) ? 'y' : 'z'
  if (upAxis === 'z') {
    // Z-up source -> rotate -90 deg about X (z->y, y->-z)
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
    for (const mg of matGeoms) mg.geoms[0].applyMatrix4(rot)
    bb.makeEmpty()
    for (const mg of matGeoms) {
      mg.geoms[0].computeBoundingBox()
      bb.union(mg.geoms[0].boundingBox!)
    }
    bb.getSize(size)
  }
  // normalize: base min-y to 0, center x/z, uniform scale to height 1
  const center = new THREE.Vector3(); bb.getCenter(center)
  const scale = 1 / size.y
  // scale then translate: p' = S * p + T
  const S = new THREE.Matrix4().makeScale(scale, scale, scale)
  const T = new THREE.Matrix4().makeTranslation(-center.x * scale, -bb.min.y * scale, -center.z * scale)
  const norm = T.multiply(S)
  for (const mg of matGeoms) mg.geoms[0].applyMatrix4(norm)
  console.log(`  ${src}: up=${upAxis} raw bbox ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} -> normalized to h=1, ${matGeoms.length} material mesh(es), ${(tris | 0)} tris`)

  // ---------------------------------------------------------------- write GLB
  // 1 buffer: [geometry attrs + indices ...][original image bytes ...]
  const views: any[] = []
  const viewBufs: Buffer[] = []
  let byteLen = 0
  const pushView = (buf: Buffer) => {
    const pad = (4 - (byteLen % 4)) % 4
    byteLen += pad
    const start = byteLen
    views.push({ buffer: 0, byteOffset: start, byteLength: buf.length })
    viewBufs.push(buf)
    byteLen += buf.length
    return views.length - 1
  }
  const accessorsFinal: any[] = []
  const meshesOut: any[] = []
  for (const mg of matGeoms) {
    const g = mg.geoms[0]
    const posArr = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
    const posB = Buffer.from(posArr)
    const nrmB = Buffer.from((g.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array)
    const uvB = Buffer.from((g.getAttribute('uv') as THREE.BufferAttribute).array as Float32Array)
    if (!g.getIndex()) { // non-indexed -> build sequential
      const n = g.getAttribute('position').count
      const seq = new Uint32Array(n); for (let i = 0; i < n; i++) seq[i] = i
      g.setIndex(Array.from(seq))
    }
    const idxCount = g.getIndex()!.count
    const vCount = g.getAttribute('position').count
    // true min/max of the final normalized positions
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < posArr.length; i++) {
      mn[i % 3] = Math.min(mn[i % 3], posArr[i]); mx[i % 3] = Math.max(mx[i % 3], posArr[i])
    }
    const posV = pushView(posB)
    const nrmV = pushView(nrmB)
    const uvV = pushView(uvB)
    const u16 = vCount < 65536
    const idxB = Buffer.alloc(idxCount * (u16 ? 2 : 4))
    const ia = g.getIndex()!.array
    for (let i = 0; i < idxCount; i++) u16 ? idxB.writeUInt16LE(ia[i], i * 2) : idxB.writeUInt32LE(ia[i], i * 4)
    const idxV = pushView(idxB)
    const posAcc = accessorsFinal.length
    accessorsFinal.push({ bufferView: posV, componentType: 5126, count: vCount, type: 'VEC3', min: mn, max: mx })
    const nrmAcc = accessorsFinal.length
    accessorsFinal.push({ bufferView: nrmV, componentType: 5126, count: vCount, type: 'VEC3' })
    const uvAcc = accessorsFinal.length
    accessorsFinal.push({ bufferView: uvV, componentType: 5126, count: vCount, type: 'VEC2' })
    const idxAcc = accessorsFinal.length
    accessorsFinal.push({ bufferView: idxV, componentType: u16 ? 5123 : 5125, count: idxCount, type: 'SCALAR' })
    meshesOut.push({
      primitives: [{
        attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc },
        material: mg.material,
        indices: idxAcc,
      }],
    })
  }
  // images: copy bytes + rebuild bufferViews; keep textures/samplers/materials verbatim
  const imagesOut = (json.images || []).map((im: any) => {
    if (im.uri !== undefined) throw new Error('external image not supported: ' + im.uri)
    const bv = json.bufferViews[im.bufferView]
    const bytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
    const v = pushView(Buffer.from(bytes))
    return { mimeType: im.mimeType, bufferView: v }
  })
  // build final bin
  const binBuf = Buffer.alloc(byteLen)
  for (let i = 0; i < views.length; i++) {
    viewBufs[i].copy(binBuf, views[i].byteOffset)
  }

  const gltf: any = {
    asset: { version: '2.0', generator: 'three-cs pack-palm-models-t134 (merged+normalized from user upload)' },
    scene: 0,
    scenes: [{ nodes: meshesOut.map((_, i) => i) }],
    nodes: meshesOut.map((_, i) => ({ mesh: i, name: `${out}-${i}` })),
    meshes: meshesOut.map(m => ({ primitives: m.primitives })),
    accessors: accessorsFinal,
    bufferViews: views,
    buffers: [{ byteLength: byteLen }],
    materials: json.materials,
    textures: json.textures,
    samplers: json.samplers,
    images: imagesOut,
  }

  const jsonStr = JSON.stringify(gltf)
  const jpad = (4 - ((jsonStr.length + 20) % 4)) % 4
  const total = 12 + 8 + jsonStr.length + jpad + 8 + byteLen
  const glb = Buffer.alloc(total)
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(total, 8)
  glb.writeUInt32LE(jsonStr.length + jpad, 12); glb.writeUInt32LE(0x4e4f534a, 16)
  glb.write(jsonStr, 20, 'utf8')
  glb.fill(0x20, 20 + jsonStr.length, 20 + jsonStr.length + jpad) // spec: space-pad JSON chunk
  const binHeaderOff = 20 + jsonStr.length + jpad
  glb.writeUInt32LE(byteLen, binHeaderOff)
  glb.writeUInt32LE(0x004e4942, binHeaderOff + 4)
  binBuf.copy(glb, binHeaderOff + 8)
  const intermediate = `${TMP_DIR}/${out}.glb`
  writeFileSync(intermediate, glb)

  // ---------------------------------------------------------------- compress
  // NOTE Task 134: the Draco ENCODER is BROKEN in this environment — it
  // crashes ("Aborted") on palm-hd and, worse, SILENTLY CORRUPTS meshes
  // where it "succeeds" (palm-low 2764 -> 829 tris, burned 9904 -> 3013,
  // series bark 1600 -> 624; only ~30% survive, verified via
  // gltf-transform inspect). Draco is therefore BANNED for this batch.
  // We use quantize (KHR_mesh_quantization) instead — lossless-enough
  // u16/i16n attribute packing that three's GLTFLoader decodes NATIVELY
  // (no wasm decoder fetch, no DRACOLoader path), verified triangle-exact
  // on palm-hd. Texture payload is handled by the webp step (4-8x).
  const finalPath = `${STAGE_DIR}/${out}.glb`
  execSync(`bash -c '
    set -euo pipefail
    CLI=node_modules/.bin/gltf-transform
    W=$(mktemp -d)
    $CLI prune    "${intermediate}" "$W/1.glb"
    $CLI dedup    "$W/1.glb" "$W/2.glb"
    $CLI weld     "$W/2.glb" "$W/3.glb"
    $CLI webp     "$W/3.glb" "$W/4.glb"
    $CLI quantize "$W/4.glb" "${finalPath}"
    rm -rf "$W"'`, { stdio: 'inherit' })
  const compressor = 'quantize(KHR_mesh_quantization)'
  provenance.push({
    model: out,
    source_upload: src,
    source_generator: json.asset?.generator || '?',
    license_note: 'user upload for dev-only use (Task 63 waiver)',
    tris: tris | 0,
    materials: matGeoms.length,
    normalized: 'base at y=0, centered, height 1.0 (engine scales per instance)',
    original_bytes: statSync(src).size,
    staged_bytes: statSync(finalPath).size,
  })
}

writeFileSync(`${STAGE_DIR}/sources.json`, JSON.stringify(provenance, null, 1))
console.log(`\nstaged ${provenance.length} models + sources.json -> ${STAGE_DIR}/`)
for (const p of provenance) console.log(`  ${p.model}: ${p.original_bytes} -> ${p.staged_bytes} bytes (${(100 * p.staged_bytes / p.original_bytes).toFixed(1)}%), ${p.tris} tris`)
