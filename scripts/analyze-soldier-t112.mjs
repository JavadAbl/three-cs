// Task 112 — evaluate the uploaded soldier_character.glb as the CT character
// model: parse (no deps) and report meshes/verts/skin/animations/textures/bbox.
import fs from 'node:fs'

function parseGLB(path) {
  const b = fs.readFileSync(path)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path)
  const jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString())
  let off = 20 + jsonLen
  if (off % 4) off += 4 - (off % 4)
  const binLen = b.readUInt32LE(off)
  const binStart = off + 8
  return { json, bin: b.slice(binStart, binStart + binLen), fileSize: b.length }
}

const p = parseGLB('upload/soldier_character.glb')
const j = p.json
console.log('=== soldier_character.glb —', (p.fileSize / 1048576).toFixed(2), 'MB ===')
console.log('generator:', j.asset?.generator ?? '(none)')
console.log('scenes:', j.scenes?.length ?? 0, '| nodes:', j.nodes?.length ?? 0, '| meshes:', j.meshes?.length ?? 0)

// meshes + vertex/tri counts + primitive modes + materials
let totV = 0, totI = 0
const compN = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
for (const [mi, m] of (j.meshes ?? []).entries()) {
  let v = 0, t = 0, mats = [], draco = false
  for (const prim of m.primitives) {
    const pa = j.accessors[prim.attributes.POSITION]
    v += pa.count
    if (prim.indices) {
      const ia = j.accessors[prim.indices]
      t += ia.count / 3
    } else t += pa.count / 3
    if (prim.extensions?.KHR_draco_mesh_compression) draco = true
    if (prim.material !== undefined) mats.push(j.materials[prim.material]?.name ?? `mat#${prim.material}`)
  }
  totV += v; totI += t
  console.log(`mesh[${mi}] "${m.name ?? ''}" verts=${v.toLocaleString()} tris=${Math.round(t).toLocaleString()}${draco ? ' [draco]' : ''} mats=[${mats.join(', ')}]`)
}
console.log(`TOTAL: verts=${totV.toLocaleString()} tris=${Math.round(totI).toLocaleString()}`)

// skins
for (const s of j.skins ?? []) {
  console.log(`skin "${s.name ?? ''}": ${s.joints?.length ?? 0} joints`)
}

// animations
for (const a of j.animations ?? []) {
  console.log(`animation "${a.name ?? ''}": ${a.channels?.length ?? 0} channels`)
}

// materials
console.log('--- materials:', j.materials?.length ?? 0)
for (const m of (j.materials ?? []).slice(0, 12)) {
  const texRefs = Object.values(m.pbrMetallicRoughness ?? {}).filter((x) => x?.index !== undefined).length
    + (m.normalTexture?.index !== undefined ? 1 : 0) + (m.occlusionTexture?.index !== undefined ? 1 : 0)
  console.log(`  "${m.name ?? ''}" texRefs=${texRefs} alpha=${m.alphaMode ?? 'OPAQUE'} doubleSided=${!!m.doubleSided}`)
}

// images
console.log('--- images:', j.images?.length ?? 0)
for (const im of (j.images ?? []).slice(0, 15)) {
  const bv = j.bufferViews[im.bufferView]
  const mime = im.mimeType ?? 'image/unknown'
  const fourcc = p.bin.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + 4).toString('latin1')
  console.log(`  ${im.name ?? im.uri ?? '(embedded)'} ${mime} ${bv.byteLength.toLocaleString()}B magic=${JSON.stringify(fourcc)}`)
}

// textures
console.log('--- textures:', j.textures?.length ?? 0)

// world bbox across all POSITION accessors
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
for (const mesh of (j.meshes ?? [])) for (const prim of mesh.primitives) {
  const a = j.accessors[prim.attributes.POSITION]
  if (a.min) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min[k]); mx[k] = Math.max(mx[k], a.max[k]) }
}
console.log('bbox min:', mn.map((x) => x.toFixed(3)).join(', '), ' max:', mx.map((x) => x.toFixed(3)).join(', '))
console.log('size (m):', (mx[0] - mn[0]).toFixed(3), 'x', (mx[1] - mn[1]).toFixed(3), 'x', (mx[2] - mn[2]).toFixed(3))

// root nodes
console.log('--- root nodes:')
for (const ni of (j.scenes?.[0]?.nodes ?? [])) {
  const n = j.nodes[ni]
  const scale = n.scale ? ` scale=${n.scale.join(',')}` : ''
  console.log(`  [${ni}] "${n.name ?? ''}" mesh=${n.mesh ?? '-'} skin=${n.skin ?? '-'}${scale}`)
}

// compare with current accepted human.glb if present
try {
  const h = parseGLB('public/assets/models/human.glb')
  let hv = 0, ht = 0
  for (const m of (h.json.meshes ?? [])) for (const prim of m.primitives) {
    hv += h.json.accessors[prim.attributes.POSITION].count
    ht += (prim.indices ? h.json.accessors[prim.indices].count : h.json.accessors[prim.attributes.POSITION].count) / 3
  }
  let hmn = [Infinity, Infinity, Infinity], hmx = [-Infinity, -Infinity, -Infinity]
  for (const mesh of (h.json.meshes ?? [])) for (const prim of mesh.primitives) {
    const a = h.json.accessors[prim.attributes.POSITION]
    if (a.min) for (let k = 0; k < 3; k++) { hmn[k] = Math.min(hmn[k], a.min[k]); hmx[k] = Math.max(hmx[k], a.max[k]) }
  }
  console.log('=== current human.glb: ', (h.fileSize / 1048576).toFixed(2), 'MB, verts=' + hv.toLocaleString(), 'tris=' + Math.round(ht).toLocaleString())
  console.log('    skins:', (h.json.skins ?? []).map((s) => `${s.joints?.length} joints`).join(', ') || 'none',
    '| anims:', (h.json.animations ?? []).map((a) => a.name).join(', ') || 'none',
    '| size:', (hmx[1] - hmn[1]).toFixed(2) + 'm tall')
} catch { console.log('=== current human.glb: not present') }
