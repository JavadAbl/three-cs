// Task 134: inspect the 4 uploaded palm GLBs — node tree, mesh stats, materials, textures, bbox
import { readFileSync } from 'fs'

const files = [
  'upload/realistic_hd_windmill_palm_125.glb',
  'upload/low_poly_palm_tree.glb',
  'upload/burned_palm_tree.glb',
  'upload/plant_series__palm_tree.glb',
]

function parseGLB(p: string) {
  const buf = readFileSync(p)
  const magic = buf.readUInt32LE(0), ver = buf.readUInt32LE(4), len = buf.readUInt32LE(8)
  if (magic !== 0x46546c67) throw new Error('not glb')
  // chunk 0 = JSON
  const jlen = buf.readUInt32LE(12), jtype = buf.readUInt32LE(16)
  const json = JSON.parse(buf.slice(20, 20 + jlen).toString('utf8'))
  let off = 20 + jlen
  const chunks: any[] = []
  while (off + 8 <= len) {
    const clen = buf.readUInt32LE(off), ctype = buf.readUInt32LE(off + 4)
    chunks.push({ type: ctype.toString(16), start: off + 8, len: clen })
    off += 8 + clen + ((clen % 4) ? (4 - (clen % 4)) : 0)
  }
  const bin = chunks.find(c => c.type === '004e4942')
  return { json, buf, bin }
}

function accessorStats(j: any, i: number, buf: Buffer, bin: any) {
  const a = j.accessors[i]
  const bv = j.bufferViews[a.bufferView]
  const base = (bin ? bin.start : 0) + (bv.byteOffset || 0)
  const comp = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[a.componentType as number]
  const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as string]
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9]
  if (a.min && a.max) { min = a.min.slice(0, 3); max = a.max.slice(0, 3) }
  return { count: a.count, min, max, comp, nComp }
}

for (const f of files) {
  const { json, buf, bin } = parseGLB(f)
  console.log(`\n=== ${f}`)
  console.log(`generator: ${json.asset?.generator || '?'} | version ${json.asset?.version}`)
  const meshes = json.meshes || []
  const mats = json.materials || []
  const imgs = json.images || []
  console.log(`meshes:${meshes.length} materials:${mats.length} images:${imgs.length} textures:${(json.textures || []).length} skins:${(json.skins||[]).length} animations:${(json.animations||[]).length}`)
  let tris = 0, verts = 0
  const meshReport: string[] = []
  for (const n of (json.nodes || [])) {
    if (n.mesh === undefined) continue
    const m = meshes[n.mesh]
    for (const pr of m.primitives) {
      const ia = pr.attributes?.POSITION
      if (ia === undefined) continue
      const st = accessorStats(json, ia, buf, bin)
      verts += st.count
      const idxA = pr.indices
      const tri = idxA !== undefined ? json.accessors[idxA].count / 3 : st.count / 3
      tris += tri
      const matName = pr.material !== undefined ? (mats[pr.material]?.name || `mat#${pr.material}`) : '-'
      const texMode = pr.material !== undefined && (mats[pr.material]?.pbrMetallicRoughness?.baseColorTexture !== undefined ||
        mats[pr.material]?.normalTexture !== undefined) ? 'tex' : 'plain'
      meshReport.push(`${n.name || 'node'}: ${st.count}v ${tri | 0}t mat=${matName}(${texMode}) mode=${pr.mode ?? 4} bbox=${JSON.stringify(st.min)}..${JSON.stringify(st.max)}`)
    }
  }
  console.log(`TOTAL verts:${verts} tris:${tris | 0}`)
  meshReport.slice(0, 14).forEach(l => console.log('  ' + l))
  if (meshReport.length > 14) console.log(`  ... +${meshReport.length - 14} nodes`)
  mats.forEach((m: any) => {
    const bct = m.pbrMetallicRoughness?.baseColorTexture?.index
    const nt = m.normalTexture?.index
    console.log(`  mat "${m.name}": baseColorTex=${bct ?? '-'} normalTex=${nt ?? '-'} alphaMode=${m.alphaMode ?? 'OPAQUE'} doubleSided=${m.doubleSided}`)
  })
  for (let i = 0; i < imgs.length; i++) {
    const im = imgs[i]
    const src = im.bufferView !== undefined ? 'embedded ' + json.bufferViews[im.bufferView].byteLength + 'B' : 'ext'
    const uri = (im.uri || '').slice(0, 40)
    console.log('  img#' + i + ' ' + (im.name || '') + ' mime=' + im.mimeType + ' uri=' + uri + ' src=' + src)
  }
}
