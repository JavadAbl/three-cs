// Measures per-family UV density (meters per UV unit) of the office geom.json
// — the PBR tile spec must be calibrated with it (Task 77 aimhead lesson):
//   tile = 2.86 * target_world_m / m_per_uv
import { readFileSync } from 'fs'

const g = JSON.parse(readFileSync('/home/z/my-project/public/staging/maps/office/geom.json', 'utf8'))
const TARGET: Record<string, number> = {
  // desired real-world size of ONE texture repeat, meters
  carpet: 2.0, offwall: 3.0, ceiling: 2.4, snow: 6.0, tile: 1.2,
  glass: 1.5, fence: 1.2,
  concrete: 3.0, brick: 2.0, metal: 1.5, plank: 1.2, dark: 4.0, crate: 1.2,
}
console.log('family   m/UV   tris   PBR tile (2.86*target/mPerUV)   bump-normal guesses')
for (const grp of g.groups as Array<{ tex: string; pos: number[]; uv: number[]; idx: number[] }>) {
  let worldA = 0, uvA = 0
  const p = grp.pos, uv = grp.uv
  for (let i = 0; i < grp.idx.length; i += 3) {
    const [a, b, c] = [grp.idx[i], grp.idx[i + 1], grp.idx[i + 2]]
    // world area
    const ax = p[a * 3] - p[c * 3], ay = p[a * 3 + 1] - p[c * 3 + 1], az = p[a * 3 + 2] - p[c * 3 + 2]
    const bx = p[b * 3] - p[c * 3], by = p[b * 3 + 1] - p[c * 3 + 1], bz = p[b * 3 + 2] - p[c * 3 + 2]
    worldA += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2
    // uv area
    const du1 = uv[a * 2] - uv[c * 2], dv1 = uv[a * 2 + 1] - uv[c * 2 + 1]
    const du2 = uv[b * 2] - uv[c * 2], dv2 = uv[b * 2 + 1] - uv[c * 2 + 1]
    uvA += Math.abs(du1 * dv2 - du2 * dv1) / 2
  }
  const mPerUV = uvA > 1e-9 ? Math.sqrt(worldA / uvA) : 0
  const t = TARGET[grp.tex] ?? 2
  const tile = +(2.86 * t / (mPerUV || 2.86)).toFixed(2)
  console.log(`${grp.tex.padEnd(9)} ${mPerUV.toFixed(2).padStart(5)}  ${String(grp.idx.length / 3).padStart(5)}   tile=${tile}`)
}
