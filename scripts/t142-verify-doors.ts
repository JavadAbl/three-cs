// Task 142 FINAL: numeric passability proof.
//   Doors B (x12.4,z-23.2) and C (x31.2,z22.4) — REAL doorways (floor both
//     sides, live-verified) → must be OPEN (zero box overlap).
//   Doors A (x2.4,z-9.2) and D (x-13.4,z38) — decor doors closing voids
//     (lightwell / office-wing wall) → must stay BLOCKED (their leaf boxes
//     present; removing them = players fall into the shaft, live-proven).
import { OFFICE } from '../mini-services/game-server/map-office'

type Box = { x: number; y: number; z: number; w: number; h: number; d: number; tex?: string }

const R = 0.4, H = 1.8
function overlaps(boxes: Box[], cx: number, floorY: number, cz: number): Box[] {
  const y0 = floorY, y1 = floorY + H
  return boxes.filter(b => {
    const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2
    const by0 = b.y - b.h / 2, by1 = b.y + b.h / 2
    const bz0 = b.z - b.d / 2, bz1 = b.z + b.d / 2
    return cx + R > bx0 && cx - R < bx1 && y1 > by0 && y0 < by1 && cz + R > bz0 && cz - R < bz1
  })
}

const nb: Box[] = (OFFICE as unknown as { boxes: Box[] }).boxes
console.log(`boxes: ${nb.length}`)

let ok = true
const OPEN: Array<[string, number, number, number]> = [
  ['B office-wing S door (x12.4 z-23.2)', 12.4, 10.45, -23.2],
  ['C paper-room door (x31.2 z22.4)', 31.2, 10.45, 22.4],
]
const BLOCKED: Array<[string, number, number, number]> = [
  ['A decor door (x2.4 z-9.2, void behind)', 2.4, 10.45, -9.2],
  ['D decor door (x-13.4 z38, lightwell behind)', -13.4, 8.45, 38.0],
]
for (const [n, x, y, z] of OPEN) {
  const hits = overlaps(nb, x, y, z)
  const open = hits.length === 0
  if (!open) ok = false
  console.log(`${open ? 'OPEN ✓  ' : 'BLOCKED ✗'} ${n} — overlap=${hits.length}`)
}
for (const [n, x, y, z] of BLOCKED) {
  const hits = overlaps(nb, x, y, z)
  const blocked = hits.length > 0
  if (!blocked) ok = false
  console.log(`${blocked ? 'CLOSED ✓ (decor, by design)' : 'OPEN ✗ (death pit!)'} ${n} — overlap=${hits.length}`)
}
console.log(ok ? 'FINAL STATE CORRECT ✓ (B+C passable, A+D safely closed)' : 'STATE WRONG ✗')
process.exit(ok ? 0 : 1)
