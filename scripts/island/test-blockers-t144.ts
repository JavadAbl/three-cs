// Task 144 gate — hidden-blocker fix, verified against the CLIENT map data:
// a player-sized AABB swept through the previously-blocked spots must find
// no collision: (1) the radar-mast interior on the A pad (old: one solid
// 2.1×2.1×8.2 box — the reported "hidden object"), (2) tight circles around
// every palm trunk (old: uniform 0.9 colliders around ~0.4 m visual trunks),
// (3) the generator shed must now BE solid (was walk-through).
import islandData from '../../src/game/map-island-data.json'

type Box = { x: number; y: number; z: number; w: number; h: number; d: number }
const boxes = (islandData as any).boxes as Box[]
const props = (islandData as any).props as Array<{ m: string; x: number; z: number; y: number; h: number }>

// player AABB (engine scale): 0.6 wide, 1.8 tall
const PW = 0.6, PH = 1.8
function overlaps(x: number, y: number, z: number): boolean {
  for (const b of boxes) {
    if (x + PW / 2 > b.x - b.w / 2 && x - PW / 2 < b.x + b.w / 2 &&
        z + PW / 2 > b.z - b.d / 2 && z - PW / 2 < b.z + b.d / 2 &&
        y + PH > b.y - b.h / 2 && y < b.y + b.h / 2) return true
  }
  return false
}

let fails = 0
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL ***'} — ${name} · ${detail}`)
  if (!ok) fails++
}

// --- radar site: pad center (14, 20), pad top y≈12.93 ---
const PAD = { x: 14, z: 20, y: 12.43 + 0.5 }
// 1. mast interior walkable: sweep player AABB across the pad through the mast center
let blockedPts: string[] = []
for (let t = -3; t <= 3; t += 0.25) {
  const x = PAD.x + t, z = PAD.z
  if (overlaps(x, PAD.y, z)) blockedPts.push(`(${x.toFixed(2)},${z.toFixed(2)})`)
}
check('mast interior swept W→E at pad level', blockedPts.length === 0,
  blockedPts.length ? `blocked at ${blockedPts.slice(0, 4).join(' ')}` : 'clear through the lattice center (old: solid 2.1×2.1 box)')
// legs still block (cover on the pad)
const legHits = [[13.1, 19.1], [14.9, 19.1], [13.1, 20.9], [14.9, 20.9]].filter(([lx, lz]) => overlaps(lx, PAD.y, lz))
check('mast legs remain solid cover', legHits.length === 4, `${legHits.length}/4 legs collide`)
// 2. shed solid now: (14-3.4, 20+2.4) = (10.6, 22.4), ground ~12.43
const shedBlocked = overlaps(10.6, 12.43, 22.4)
check('generator shed is solid', shedBlocked, 'player AABB collides (old: walk-through)')

// --- palms: ring around each trunk at chest height ---
const PALM_TRUNK_D: Record<string, number> = { 'palm-low': 0.15, 'palm-series': 0.10, 'palm-hd': 0.55, 'palm-burned': 0.60 }
let worstRing = 0, worstAt = ''
for (const p of props) {
  const d = PALM_TRUNK_D[p.m] ?? 0.5
  const w = Math.min(1.3, Math.max(0.45, d * p.h))
  // farthest point from trunk center that still collides = phantom reach
  // (probe at 4 diagonals just outside the visual trunk radius)
  const vis = w / 2            // collider now ~= visual width
  const ringR = vis + 0.05     // just outside the collider should be FREE
  const chestY = p.y + 1.0
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const px = p.x + dx * ringR * Math.SQRT1_2, pz = p.z + dz * ringR * Math.SQRT1_2
    if (overlaps(px, chestY, pz)) {
      const reach = Math.hypot(px - p.x, pz - p.z) - (d * p.h) / 2  // beyond visual trunk edge
      if (reach > worstRing) { worstRing = reach; worstAt = `${p.m} @(${p.x.toFixed(1)},${p.z.toFixed(1)})` }
    }
  }
}
check('palm phantom rings gone', worstRing <= 0.15,
  worstRing <= 0.15 ? `worst invisible reach beyond visual trunk = ${worstRing.toFixed(2)}m (old: up to ~0.25m ring @ 0.9 boxes)` : `WORST ${worstRing.toFixed(2)}m at ${worstAt}`)

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`)
process.exit(fails === 0 ? 0 : 1)
