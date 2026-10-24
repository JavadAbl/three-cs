// Task 101 — parse the two uploaded GLBs (moon + star cluster) to design the
// night-sky integration. Raw binary glTF parse (no deps).
import fs from 'node:fs'

function parseGLB(path) {
  const b = fs.readFileSync(path)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path)
  const jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString())
  let off = 20 + jsonLen
  if (off % 4) off += 4 - (off % 4)           // chunk padding
  const binLen = b.readUInt32LE(off)           // BIN chunk header: len at +0, type at +4, data at +8
  const binStart = off + 8
  const bin = b.slice(binStart, binStart + binLen)
  return { json, bin }
}
const accView = (j, ai) => {
  const a = j.accessors[ai], v = j.bufferViews[a.bufferView]
  return { a, v, bytes: v.byteLength }
}
function readAccessor(j, bin, ai) {
  const { a, v } = accView(j, ai)
  const off = (v.byteOffset || 0) + (a.byteOffset || 0)
  const n = a.count, comps = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type]
  const fmt = { 5126: ['f32', 4], 5123: ['u16', 2], 5125: ['u32', 4], 5121: ['u8', 1], 5122: ['i16', 2], 5120: ['i8', 1] }[a.componentType]
  const stride = v.byteStride || comps * fmt[1]
  const out = []
  for (let i = 0; i < n; i++) {
    const base = off + i * stride
    const c = []
    for (let k = 0; k < comps; k++) {
      const p = base + k * fmt[1]
      c.push(fmt[0] === 'f32' ? bin.readFloatLE(p) : fmt[0] === 'u16' ? bin.readUInt16LE(p) : fmt[0] === 'u32' ? bin.readUInt32LE(p) : fmt[0] === 'u8' ? bin.readUInt8(p) : fmt[0] === 'i16' ? bin.readInt16LE(p) : bin.readInt8(p))
    }
    out.push(c)
  }
  return out
}

// ---------- MOON ----------
{
  const { json: j, bin } = parseGLB('/home/z/my-project/upload/moon.glb')
  console.log('=== MOON ===')
  console.log('nodes:', JSON.stringify(j.nodes, null, 1).slice(0, 1200))
  const mesh = j.meshes[0]
  const p = mesh.primitives[0]
  const pos = readAccessor(j, bin, p.attributes.POSITION)
  const nrm = p.attributes.NORMAL ? readAccessor(j, bin, p.attributes.NORMAL) : null
  const uv = p.attributes.TEXCOORD_0 ? readAccessor(j, bin, p.attributes.TEXCOORD_0) : null
  console.log('verts:', pos.length, 'normals:', !!nrm, 'uv:', !!uv, 'indices:', p.indices != null ? j.accessors[p.indices].count : 'none')
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]
  for (const v of pos) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]) }
  console.log('bbox min', mn.map(x => +x.toFixed(3)), 'max', mx.map(x => +x.toFixed(3)))
  // radius sanity
  let rMin = 1e9, rMax = -1e9
  for (const v of pos) { const r = Math.hypot(v[0], v[1], v[2]); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r) }
  console.log('radius range', rMin.toFixed(3), '..', rMax.toFixed(3), '=>', (rMin + rMax) / 2 > 0 ? 'sphere-ish' : '?')
  // texture image
  const img = j.images[0]
  const bv = j.bufferViews[img.bufferView]
  const texBytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
  console.log('image bytes:', texBytes.length, 'mime:', img.mimeType, 'starts:', texBytes.slice(0, 4).toString('hex'))
  // specular-glossiness material details
  const m = j.materials[0]
  console.log('material keys:', Object.keys(m))
  const sg = m.extensions?.KHR_materials_pbrSpecularGlossiness
  if (sg) console.log('specGloss:', JSON.stringify(sg).slice(0, 300))
  fs.writeFileSync('/tmp/moon_tex.jpg', texBytes)
  console.log('extracted /tmp/moon_tex.jpg', texBytes.length, 'bytes; jpeg dims via marker:')
  // quick SOF scan
  let i = 2
  while (i < texBytes.length) {
    if (texBytes[i] !== 0xff) { i++; continue }
    const m2 = texBytes[i + 1]
    if (m2 >= 0xc0 && m2 <= 0xcf && m2 !== 0xc4 && m2 !== 0xc8 && m2 !== 0xcc) {
      console.log('  JPEG', texBytes.readUInt16BE(i + 7) + 'x' + texBytes.readUInt16BE(i + 5))
      break
    }
    i += 2 + texBytes.readUInt16BE(i + 2)
  }
}

// ---------- STAR CLUSTER ----------
{
  const { json: j, bin } = parseGLB('/home/z/my-project/upload/star_cluster_-_15k_stars_model.glb')
  console.log('\n=== STARS ===')
  console.log('meshes:', j.meshes.map(m => m.name).join(' | '))
  j.meshes.forEach((mesh, mi) => {
    const p = mesh.primitives[0]
    const pos = readAccessor(j, bin, p.attributes.POSITION)
    const uv = p.attributes.TEXCOORD_0 ? readAccessor(j, bin, p.attributes.TEXCOORD_0) : null
    const idx = p.indices != null ? readAccessor(j, bin, p.indices) : null
    console.log(`mesh ${mi}: verts=${pos.length} idx=${idx ? idx.length : 'none'} uv=${uv ? 'yes' : 'no'} material=${p.material}`)
    // quad analysis: groups of 4 verts
    let facing = 0, rand = 0, total = 0
    let sizeMin = 1e9, sizeMax = -1e9, sizeSum = 0
    let rMin = 1e9, rMax = -1e9, yMin = 1e9, yMax = -1e9
    const uvsSet = new Set()
    for (let q = 0; q + 3 < pos.length; q += 4) {
      const c = [0, 0, 0]
      for (let k = 0; k < 4; k++) { c[0] += pos[q + k][0] / 4; c[1] += pos[q + k][1] / 4; c[2] += pos[q + k][2] / 4 }
      // quad edge vectors
      const e1 = [pos[q + 1][0] - pos[q][0], pos[q + 1][1] - pos[q][1], pos[q + 1][2] - pos[q][2]]
      const e2 = [pos[q + 3][0] - pos[q][0], pos[q + 3][1] - pos[q][1], pos[q + 3][2] - pos[q][2]]
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[ 0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      const nl = Math.hypot(...n) || 1
      const r = Math.hypot(...c)
      const dot = (n[0] * c[0] + n[1] * c[1] + n[2] * c[2]) / (nl * r)
      total++
      if (Math.abs(dot) > 0.7) facing++; else if (Math.abs(dot) < 0.2) rand++
      const s = (Math.hypot(...e1) + Math.hypot(...e2)) / 2
      sizeMin = Math.min(sizeMin, s); sizeMax = Math.max(sizeMax, s); sizeSum += s
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r)
      yMin = Math.min(yMin, c[1]); yMax = Math.max(yMax, c[1])
      if (uv) for (let k = 0; k < 4; k++) uvsSet.add(`${uv[q + k][0].toFixed(2)},${uv[q + k][1].toFixed(2)}`)
    }
    console.log(`  quads=${total} facingCenter(${Math.round(100 * facing / total)}%) nearRandom(${Math.round(100 * rand / total)}%)`)
    console.log(`  quad size ${sizeMin.toFixed(3)}..${sizeMax.toFixed(3)} avg ${(sizeSum / total).toFixed(3)}`)
    console.log(`  radial dist ${rMin.toFixed(1)}..${rMax.toFixed(1)}  y ${yMin.toFixed(1)}..${yMax.toFixed(1)}`)
    console.log(`  distinct uv corners sample:`, [...uvsSet].slice(0, 12).join(' '))
  })
  // sprite texture
  const img = j.images[0]
  const bv = j.bufferViews[img.bufferView]
  const texBytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
  fs.writeFileSync('/tmp/star_sprite.png', texBytes)
  console.log('sprite png:', texBytes.length, 'bytes ->', '/tmp/star_sprite.png')
  console.log('emissive per mesh:', j.meshes.map((m, i) => JSON.stringify(j.materials[m.primitives[0].material].emissiveFactor)).join(' '))
}
