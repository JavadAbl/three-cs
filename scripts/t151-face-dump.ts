// Task 151: dump the actual vertex polygons of suspicious faces (sliver diagnosis)
import { readFileSync } from 'fs'
const SRC = '/home/z/my-project/upload/cs_office.bsp'
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const L = (i: number) => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(L)
const nVerts = lumps[3].len / 12
const nEdges = lumps[12].len / 4
const nFaces = lumps[7].len / 20
const nTexinfo = lumps[6].len / 40
const nSurfedges = lumps[13].len / 4
const miptexs: Array<{ name: string }> = []
{
  const base = lumps[2].off
  const num = dv.getInt32(base, true)
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(base + 4 + i * 4, true)
    if (rel === -1) { miptexs.push({ name: `wad${i}` }); continue }
    const p = base + rel
    miptexs.push({ name: buf.toString('latin1', p, p + 16).replace(/\0.*$/, '') })
  }
}
for (const fi of [1280, 4250, 4256, 3968, 6405, 1279, 1278, 2424, 2425, 1668, 1669]) {
  const o = lumps[7].off + fi * 20
  const f = { firstedge: dv.getInt32(o + 4, true), numedges: dv.getUint16(o + 8, true), texinfo: dv.getInt16(o + 10, true) }
  const name = f.texinfo >= 0 && f.texinfo < nTexinfo ? miptexs[dv.getInt32(lumps[6].off + f.texinfo * 40 + 32, true)]?.name : '?'
  const vs: number[][] = []
  for (let k = 0; k < f.numedges && f.numedges <= 32; k++) {
    const se = dv.getInt32(lumps[13].off + (f.firstedge + k) * 4, true)
    if (Math.abs(se) >= nEdges) { vs.length = 0; break }
    const e = lumps[12].off + Math.abs(se) * 4
    const v = dv.getUint16(se >= 0 ? e : e + 2, true)
    if (v >= nVerts) { vs.length = 0; break }
    vs.push([dv.getFloat32(lumps[3].off + v * 12, true), dv.getFloat32(lumps[3].off + v * 12 + 4, true), dv.getFloat32(lumps[3].off + v * 12 + 8, true)])
  }
  console.log(`\nface ${fi} (${name}, ${f.numedges} edges):`)
  for (const v of vs) console.log(`  (${v[0]}, ${v[1]}, ${v[2]})`)
  if (vs.length >= 3) {
    const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
    console.log(`  aabb x[${Math.min(...xs)},${Math.max(...xs)}] y[${Math.min(...ys)},${Math.max(...ys)}] z[${Math.min(...zs)},${Math.max(...zs)}]`)
    // area on the face plane
    let a2 = 0
    for (let i = 0; i < vs.length; i++) { const p = vs[i], q = vs[(i + 1) % vs.length]; a2 += p[1] * q[2] - q[1] * p[2] }
    console.log(`  area2(yz)=${Math.abs(a2 / 2)}u² (bbox yz=${Math.abs((Math.max(...ys) - Math.min(...ys)) * (Math.max(...zs) - Math.min(...zs)))}u²)`)
  }
}
