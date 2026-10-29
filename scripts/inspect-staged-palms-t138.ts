// Task 138 — inspect the staged island palm GLBs: node scales + POSITION
// accessor stats, to confirm/refute the quantization node-scale loss.
// Usage: bun scripts/inspect-staged-palms-t138.ts
import { readFileSync } from 'fs'

function parseGLB(path: string) {
  const b = readFileSync(path)
  let off = 12
  const jlen = b.readUInt32LE(off)
  const json = JSON.parse(b.slice(off + 8, off + 8 + jlen).toString('utf8'))
  off += 8 + jlen + ((jlen % 4) ? (4 - (jlen % 4)) : 0)
  const blen = b.readUInt32LE(off)
  const bin = b.slice(off + 8, off + 8 + blen)
  return { json, bin }
}

for (const name of ['palm-hd', 'palm-low', 'palm-burned', 'palm-series']) {
  const p = `public/staging/models/island/${name}.glb`
  try {
    const { json } = parseGLB(p)
    console.log(`\n== ${name} ==`)
    console.log('  scene nodes:', (json.nodes || []).length)
    ;(json.nodes || []).forEach((n: any, i: number) => {
      console.log(`  node[${i}] name=${JSON.stringify(n.name || '')} scale=${JSON.stringify(n.scale || null)} trans=${JSON.stringify(n.translation || null)} mesh=${n.mesh ?? '-'}`)
    })
    ;(json.meshes || []).forEach((m: any, mi: number) => {
      for (const prim of m.primitives) {
        const a = json.accessors[prim.attributes.POSITION]
        console.log(`  mesh[${mi}] "${m.name || ''}" POS: compType=${a.componentType} normalized=${!!a.normalized} count=${a.count} min=${JSON.stringify(a.min)} max=${JSON.stringify(a.max)}`)
      }
    })
  } catch (e) {
    console.log(`\n== ${name} == ERROR: ${(e as Error).message}`)
  }
}
