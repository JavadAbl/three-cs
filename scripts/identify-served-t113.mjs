// Task 113 — identify WHAT the dev server is actually serving for /api/assets/human
// vs the current staged file. Dumps the glTF node tree (names + TRS/matrix) and
// mesh accessor bbox for: the served stale body, the staged v2 file, and (if
// present) the original upload. This pins down which bake the user saw.
import fs from 'node:fs'
import crypto from 'node:crypto'

function parseGLB(path) {
  const b = fs.readFileSync(path)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path)
  const jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString())
  return { json, raw: b, size: b.length, sha: crypto.createHash('sha1').update(b).digest('hex').slice(0, 12) }
}

function dump(path) {
  const p = parseGLB(path)
  const j = p.json
  console.log(`\n=== ${path}`)
  console.log(`    size=${p.size} sha1[:12]=${p.sha} generator=${j.asset?.generator ?? '-'}`)
  for (const [i, n] of (j.nodes ?? []).entries()) {
    const trs = []
    if (n.matrix) trs.push(`matrix=[${n.matrix.map((x) => +x.toFixed(3)).join(',')}]`)
    if (n.translation) trs.push(`t=[${n.translation.map((x) => +x.toFixed(2)).join(',')}]`)
    if (n.rotation) trs.push(`r=[${n.rotation.map((x) => +x.toFixed(3)).join(',')}]`)
    if (n.scale) trs.push(`s=[${n.scale.map((x) => +x.toFixed(3)).join(',')}]`)
    if (n.mesh !== undefined) trs.push(`mesh=${n.mesh}`)
    console.log(`  node[${i}] "${n.name ?? ''}" ${trs.join(' ')}`)
  }
  // accessor-level bbox (no node transforms)
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (const mesh of (j.meshes ?? [])) for (const prim of mesh.primitives) {
    const a = j.accessors[prim.attributes.POSITION]
    if (a.min) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min[k]); mx[k] = Math.max(mx[k], a.max[k]) }
  }
  console.log(`    raw accessor bbox min=[${mn.map((x) => +x.toFixed(2))}] max=[${mx.map((x) => +x.toFixed(2))}]`)
  console.log(`    raw size ${(mx[0] - mn[0]).toFixed(2)} x ${(mx[1] - mn[1]).toFixed(2)} x ${(mx[2] - mn[2]).toFixed(2)}`)
}

dump('/tmp/served-human.glb')                       // what the user's browser got
dump('public/staging/models/human.glb')             // current staged v2 (arm surgery)
for (const f of ['upload/soldier_character.glb', 'public/assets/models/human.glb']) {
  if (fs.existsSync(f)) dump(f)
}
