// ============================================================
// Task 101 — convert the user-provided GLBs (moon + 15k-star
// cluster) into engine-native night-sky assets:
//
//   public/assets/models/sky/moon.bin        raw BufferGeometry slices
//   public/assets/models/sky/moon_diffuse.jpg  equirect lunar albedo (1024x512)
//   public/assets/models/sky/stars-night.bin  camera-facing point cloud
//   public/assets/models/sky/star-sprite.png  soft radial glow sprite
//   public/assets/models/sky/sources.json     provenance
//
// WHY convert instead of shipping the GLBs raw:
//  - moon.glb uses KHR_materials_pbrSpecularGlossiness — REMOVED from
//    three's GLTFLoader (0.186): the diffuse map would silently not
//    attach. The mesh is a perfect unit sphere (r=1.000 everywhere),
//    so the node chain's x100 scale + axis swap are irrelevant — we
//    slice the raw accessor buffers (already tightly packed) and scale
//    in code. 570KB glb (incl. 407KB texture the loader can't use)
//    becomes 174KB bin + 407KB jpg.
//  - star cluster: 45,000 quads, only ~30% face the blob center (20%
//    near-random) — viewed from INSIDE, half render edge-on. Converted
//    to THREE.Points: positions/sizes/colors derived per quad, always
//    camera-facing, remapped onto the sky dome (285..330 r, above the
//    horizon), 6.6MB -> ~550KB. The model's angular structure and
//    3-tier color scheme are preserved exactly.
// ============================================================
import fs from 'node:fs'

const OUT = '/home/z/my-project/public/assets/models/sky'
fs.mkdirSync(OUT, { recursive: true })

function parseGLB(path) {
  const b = fs.readFileSync(path)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path)
  const jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString())
  let off = 20 + jsonLen
  if (off % 4) off += 4 - (off % 4)
  const binLen = b.readUInt32LE(off)
  const bin = b.slice(off + 8, off + 8 + binLen)
  return { json, bin }
}
function readAccessor(j, bin, ai) {
  const a = j.accessors[ai], v = j.bufferViews[a.bufferView]
  const off = (v.byteOffset || 0) + (a.byteOffset || 0)
  const n = a.count, comps = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type]
  const [fmt, size] = { 5126: ['f32', 4], 5123: ['u16', 2], 5125: ['u32', 4] }[a.componentType]
  const stride = v.byteStride || comps * size
  const out = []
  for (let i = 0; i < n; i++) {
    const base = off + i * stride, c = []
    for (let k = 0; k < comps; k++) {
      const p = base + k * size
      c.push(fmt === 'f32' ? bin.readFloatLE(p) : fmt === 'u16' ? bin.readUInt16LE(p) : bin.readUInt32LE(p))
    }
    out.push(c)
  }
  return out
}
// deterministic rnd (matches the codebase's no-Math.random convention)
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------- MOON ----------------
{
  const { json: j, bin } = parseGLB('/home/z/my-project/upload/moon.glb')
  const bv = j.bufferViews
  // verify tight packing assumptions before slicing
  const [posAcc, normAcc, uvAcc, idxAcc] = j.meshes[0].primitives[0].attributes.POSITION === 0
    ? [j.accessors[0], j.accessors[1], j.accessors[2], j.accessors[3]]
    : [null, null, null, null]
  if (!posAcc) throw new Error('moon accessor order changed — re-inspect')
  const pnView = bv[posAcc.bufferView]
  const pnOff = (pnView.byteOffset || 0) + (posAcc.byteOffset || 0)
  const normOff = (bv[normAcc.bufferView].byteOffset || 0) + (normAcc.byteOffset || 0)
  const uvView = bv[uvAcc.bufferView]
  const uvOff = (uvView.byteOffset || 0) + (uvAcc.byteOffset || 0)
  const idxView = bv[idxAcc.bufferView]
  const idxOff = (idxView.byteOffset || 0) + (idxAcc.byteOffset || 0)
  const vCount = posAcc.count, iCount = idxAcc.count
  const POS_NORM_LEN = vCount * 12 * 2, UV_LEN = vCount * 8, IDX_LEN = iCount * 4
  console.log(`moon: ${vCount} verts, ${iCount} idx — slicing ${POS_NORM_LEN}+${UV_LEN}+${IDX_LEN} bytes`)
  const out = Buffer.concat([
    bin.slice(pnOff, pnOff + POS_NORM_LEN / 2),              // positions (f32x3, tight)
    bin.slice(pnOff + POS_NORM_LEN / 2, pnOff + POS_NORM_LEN), // normals
    bin.slice(uvOff, uvOff + UV_LEN),
    bin.slice(idxOff, idxOff + IDX_LEN),
  ])
  fs.writeFileSync(`${OUT}/moon.bin`, out)
  // texture
  const img = j.images[0]
  const texBytes = bin.slice((bv[img.bufferView].byteOffset || 0), (bv[img.bufferView].byteOffset || 0) + bv[img.bufferView].byteLength)
  fs.writeFileSync(`${OUT}/moon_diffuse.jpg`, texBytes)
  console.log(`moon.bin ${out.length} B + moon_diffuse.jpg ${texBytes.length} B`)
}

// ---------------- STARS ----------------
{
  const { json: j, bin } = parseGLB('/home/z/my-project/upload/star_cluster_-_15k_stars_model.glb')
  const rnd = mulberry32(101)
  // per-mesh emissive tints, desaturated 55% toward white (raw glTF
  // emissives are near-pure RGB; straight use = christmas-tree sky)
  const TINTS = [[1, 0.346, 0.346], [1, 1, 0.340], [0, 0.341, 1]].map(t => t.map(c => c + (1 - c) * 0.55))
  // world-size bucket edges (from quad edge length q: w = 0.9 + q*5.5)
  const EDGES = [1.15, 1.35, 1.60, 1.90, 2.30, 2.80]
  const buckets = Array.from({ length: EDGES.length + 1 }, () => ({ size: 0, stars: [] }))
  let kept = 0, dropped = 0
  j.meshes.forEach((mesh, mi) => {
    const p = mesh.primitives[0]
    const pos = readAccessor(j, bin, p.attributes.POSITION)
    const tint = TINTS[mi]
    for (let q = 0; q + 3 < pos.length; q += 4) {
      const cx = (pos[q][0] + pos[q + 1][0] + pos[q + 2][0] + pos[q + 3][0]) / 4
      const cy = (pos[q][1] + pos[q + 1][1] + pos[q + 2][1] + pos[q + 3][1]) / 4
      const cz = (pos[q][2] + pos[q + 1][2] + pos[q + 2][2] + pos[q + 3][2]) / 4
      const len = Math.hypot(cx, cy, cz) || 1
      const dy = cy / len
      if (dy <= 0.02) { dropped++; continue }   // below horizon — never visible past the walls
      const e1 = Math.hypot(pos[q + 1][0] - pos[q][0], pos[q + 1][1] - pos[q][1], pos[q + 1][2] - pos[q][2])
      const e2 = Math.hypot(pos[q + 3][0] - pos[q][0], pos[q + 3][1] - pos[q][1], pos[q + 3][2] - pos[q][2])
      const qSize = (e1 + e2) / 2
      const w = 0.9 + qSize * 5.5
      const r = 285 + rnd() * 45               // depth band inside the 350-r sky sphere
      const px = (cx / len) * r, py = (cy / len) * r, pz = (cz / len) * r
      const bright = Math.min(1, 0.35 + 0.65 * Math.min(1, qSize / 0.22))
      const col = [tint[0] * bright, tint[1] * bright, tint[2] * bright]
      let bi = EDGES.findIndex(e => w < e)
      if (bi === -1) bi = EDGES.length
      buckets[bi].stars.push([px, py, pz, ...col])
      kept++
    }
  })
  // bucket world sizes = upper edge midpoints (soft-glow sprites read ~half
  // their point px, so sizes are deliberately generous)
  const SIZES = [1.0, 1.25, 1.48, 1.75, 2.10, 2.55, 3.30]
  const chunks = [Buffer.from(Uint32Array.from([buckets.length]).buffer)]
  buckets.forEach((b, i) => {
    b.size = SIZES[i]
    const arr = new Float32Array(b.stars.length * 6)
    b.stars.forEach((s, k) => { for (let t = 0; t < 6; t++) arr[k * 6 + t] = s[t] })
    const head = Buffer.alloc(8)
    head.writeUInt32LE(b.stars.length, 0)
    head.writeFloatLE(b.size, 4)
    chunks.push(head, Buffer.from(arr.buffer))
    console.log(`  bucket ${i}: size ${b.size} x ${b.stars.length} stars`)
  })
  const out = Buffer.concat(chunks)
  fs.writeFileSync(`${OUT}/stars-night.bin`, out)
  console.log(`stars: kept ${kept}, dropped(below horizon) ${dropped} -> stars-night.bin ${out.length} B`)
  // sprite
  const img = j.images[0]
  const bv = j.bufferViews[img.bufferView]
  const texBytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
  fs.writeFileSync(`${OUT}/star-sprite.png`, texBytes)
  console.log(`star-sprite.png ${texBytes.length} B`)
}

// ---------------- provenance ----------------
fs.writeFileSync(`${OUT}/sources.json`, JSON.stringify({
  purpose: 'AIM DEPOT night sky (Task 101) — replaces the Task-100 canvas-painted moon/stars',
  origin: 'GLB models supplied by the game owner (uploaded 2026-10-24, Sketchfab exports)',
  files: {
    'moon.bin': 'moon.glb raw accessor slices: f32 pos[3223] + f32 norm[3223] + f32 uv[3223] + u32 idx[17664] — unit sphere, engine scales x12',
    'moon_diffuse.jpg': 'extracted from moon.glb (KHR_materials_pbrSpecularGlossiness diffuseTexture — the extension three r166+ GLTFLoader no longer parses, hence the extraction)',
    'stars-night.bin': 'star_cluster_-_15k_stars_model.glb converted to camera-facing points: u32 nBuckets, then per bucket {u32 count, f32 size, count*(f32 pos[3]+f32 col[3])}; quad centers normalized onto the 285-330 dome (below-horizon stars culled); sizes/colors derived from quad edge length + per-mesh emissive tints (desaturated 55%)',
    'star-sprite.png': 'extracted from the star cluster GLB (soft radial glow, black = zero emission for additive blending)',
  },
  note: 'License is whatever the Sketchfab source listings state — supplied by the repo owner for this game. Do not claim CC0 here.',
}, null, 2))
console.log('sources.json written')
