// ============================================================
// Dust2-inspired map data v4 (shared: server LOS/bots + client render/collision)
// Coordinate system: X = east(+), Z = south(+), Y = up. CT side = north (-Z), T side = south (+Z).
//
// v4 changes:
// - B doors corridor now actually connects CT side -> B (was a dead stub in v3)
// - Window room: mid/CT-mid -> B rotation with a crouch-vault window
// - Dead void west of tunnels sealed (SW city block)
// - Catwalk stairs entry opened (north wall shortened), under-stairs pocket sealed
// - Long A narrowed to a real corridor (12m), pit stairs x 30..42
// - Mid doors widened to double doors, panels slid to jambs
// - Waypoint graph fixed: no more paths through solid geometry
// ============================================================

export interface Box {
  x: number; y: number; z: number   // center
  w: number; h: number; d: number   // full sizes (X, Y, Z)
  tex: 'sand' | 'wall' | 'crate' | 'metal' | 'dark' | 'plank' | 'door'
}

export interface Vec3 { x: number; y: number; z: number }

const boxes: Box[] = []

function box(x: number, z: number, w: number, d: number, h: number, tex: Box['tex'], y0 = 0): Box {
  const b: Box = { x, y: y0 + h / 2, z, w, h, d, tex }
  boxes.push(b)
  return b
}
// wall segment from (x1,z1) to (x2,z2) with thickness t
function wall(x1: number, z1: number, x2: number, z2: number, h = 4, tex: Box['tex'] = 'wall', t = 0.9, y0 = 0): void {
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
  const w = Math.abs(x2 - x1) || t
  const d = Math.abs(z2 - z1) || t
  box(cx, cz, Math.max(w, t) === w ? w : t, Math.max(d, t) === d ? d : t, h, tex, y0)
}
// ascending stairs from (xS,zS) low edge to (xN,zN) high edge, steps of `step` height
function stairs(x1: number, x2: number, zLow: number, zHigh: number, topY: number, dir: 'z' | 'x', tex: Box['tex'] = 'plank', step = 0.25): void {
  const steps = Math.ceil(topY / step)
  for (let i = 0; i < steps; i++) {
    const yTop = (i + 1) * step
    if (dir === 'z') {
      const z0 = zLow + (zHigh - zLow) * (i / steps)
      const z1 = zLow + (zHigh - zLow) * ((i + 1) / steps)
      box((x1 + x2) / 2, (z0 + z1) / 2, x2 - x1, z1 - z0, yTop, tex)
    } else {
      const x0 = x1 + (x2 - x1) * (i / steps)
      const xA = x1 + (x2 - x1) * ((i + 1) / steps)
      box((x0 + xA) / 2, (zLow + zHigh) / 2, xA - x0, zHigh - zLow, yTop, tex)
    }
  }
}

// ---------------- ground ----------------
box(-1, 0, 98, 92, 0.2, 'sand', -0.2) // full floor

// ---------------- perimeter ----------------
wall(-50, -46, 48, -46, 6)
wall(48, -46, 48, 46, 6)
wall(48, 46, -50, 46, 6)
wall(-50, 46, -50, -46, 6)

// ---------------- T spawn (south, open) ----------------
wall(-6, 30, 2, 30, 4)       // T spawn wall west of mid entrance (gap x 2..8 = mid entrance)
box(14, 19, 12, 22, 4, 'wall')          // T NE building mass x 8..20 z 8..30 (mid east boundary)
wall(20, 44, 20, 34, 4)       // T spawn east wall (south piece), gap z 30..34 = exit to outside long
box(-4, 36, 1.6, 1.6, 1.6, 'crate')
box(-1.8, 36, 1.6, 1.6, 1.6, 'crate')
box(-2.9, 36, 1.6, 1.6, 1.6, 'crate', 1.6)
box(-10, 42, 2, 2, 2, 'crate')
box(16, 37, 1.8, 1.8, 1.8, 'crate')

// ---------------- mid lane ----------------
wall(-6, 30, -6, -9, 4)       // mid west wall (to T spawn line)
wall(8, 30, 8, -6, 4)         // mid east wall (upper) — cat gap at z -13..-6
wall(8, -13, 8, -26, 4)       // mid east wall (lower/CT-mid side)
wall(-6, -9, 0, -9, 3)        // mid doors wall (west part) — gap x 0..4.2 = double doors
wall(4.2, -9, 8, -9, 3)       // mid doors wall (east part)
wall(0, -9, 4.2, -9, 0.6, 'metal', 0.6, 2.4) // door lintel
box(0.15, -9, 0.3, 1.2, 2.4, 'door', 0)      // door panel west (slid against jamb)
box(4.05, -9, 0.3, 1.2, 2.4, 'door', 0)      // door panel east (slid against jamb)
box(2, 4, 1.4, 1.4, 1.4, 'crate')            // "xbox" mid cover
box(-3, -3, 1.4, 1.4, 1.4, 'crate')

// ---------------- catwalk / short A ----------------
wall(8, -6, 15, -6, 4)        // cat south wall (z=-6, from mid wall to x 15)
wall(8, -13, 12, -13, 4)      // cat north wall — x 8..12 only, stairs entry open east of x12
wall(17, -13, 17, -18, 4)     // cat stairs east wall
stairs(12, 17, -13, -18, 2, 'z')          // cat stairs 0 -> 2 climbing north
box(14.5, -20, 5, 4, 2, 'wall', 0)       // cat top platform x12..17 z -22..-18 (top y=2)
box(14.5, -24, 5, 4, 2, 'wall', 0)       // cat neck x12..17 z -26..-22 (top y=2)
box(10.5, -6.9, 1, 1, 1, 'crate')         // short boost box (south side, off the bot path)
box(12.5, -17, 1.2, 1.2, 1.2, 'crate', 1.75) // crate tucked against stairs west edge
box(10.2, -19.5, 3.5, 13, 4, 'wall')      // under-cat fill x 8.45..11.95 z -26..-13 (seals dead pocket)

// ---------------- A site platform ----------------
box(30, -33, 36, 14, 2, 'wall')            // main platform x12..48 z -40..-26 (top y=2)
box(30, -33, 36, 14, 0.05, 'sand', 2)      // platform sandy top layer
box(21, -33, 18, 8, 0.04, 'plank', 2.01)   // plank deck detail (x 12..30 — never overhang the ramp)
// pit stairs: long (y0) up to platform south edge (y2), x 30..42
stairs(30, 42, -18, -26, 2, 'z', 'plank')
// A site props
box(24, -30, 2.2, 2.2, 2.2, 'crate', 2)    // default plant crate (north of goose path)
box(24, -30, 1.6, 1.6, 1.6, 'crate', 4.2)
box(39, -31, 1.8, 1.8, 1.8, 'crate', 2)    // pit-top crate
box(40, -37, 2, 2, 2, 'crate', 2)          // goose corner
box(19.5, -38, 1.5, 1.5, 1.5, 'crate', 2)  // goose crates
box(44, -28, 2.2, 2.2, 2.2, 'crate', 2)    // A car/corner crates
box(31, -20, 1.6, 1.6, 1.6, 'crate')       // pit crate (on stairs)
box(38, -11, 2, 2, 2, 'crate')             // long corner crate
box(38.5, -3, 1.4, 1.4, 1.4, 'crate')        // long crate cover (east side, off the lane)

// ---------------- A ramp from CT ----------------
stairs(8, 12, -34, -28, 2, 'x', 'plank')   // ramp 0 -> 2 climbing east (x8..12)
wall(8, -40, 8, -34, 4, 'wall')            // block F west face piece
box(10, -40, 4, 12, 4, 'wall')            // block F x8..12 z -46..-34
box(10, -27, 4, 2, 4, 'wall')              // block G x8..12 z -28..-26
box(10, -24, 4, 4, 4, 'wall')              // pocket fill x8..12 z -26..-22

// ---------------- CT spawn plaza ----------------
box(-7, -44, 1.8, 1.8, 1.8, 'crate')
box(5, -42, 1.8, 1.8, 1.8, 'crate')
box(-11, -44, 2.2, 2.2, 1.2, 'crate')
wall(-14, -46, -14, -27, 4)                // CT spawn west wall

// ---------------- B doors corridor (CT -> B) ----------------
wall(-22, -27, -14, -27, 3.5)   // corridor south wall
wall(-22, -21, -14, -21, 3.5)   // corridor north wall
box(-21.4, -26.2, 0.3, 1.6, 2.6, 'door', 0)   // door panel slid open (flush south wall)

// ---------------- B site ----------------
box(-35, -29, 26, 26, 0.04, 'sand', 0.02)  // B ground detail z -42..-16
box(-44, -37, 8, 10, 1.5, 'wall')          // back platform x -48..-40 z -42..-32 (top 1.5)
stairs(-38, -40, -42, -32, 1.5, 'x', 'plank', 0.25) // stairs climb west up to plat
box(-29.5, -24.5, 4, 2, 1.3, 'metal', 0)       // "the car" (B entrance cover)
box(-33, -35, 2, 2, 2, 'crate')            // double stack
box(-33, -35, 1.6, 1.6, 1.6, 'crate', 2)
box(-27, -32, 1.6, 1.6, 1.6, 'crate')
box(-37, -23, 1.8, 1.8, 1.8, 'crate')      // plant zone crates
box(-44, -22, 2, 2, 2, 'crate')            // window-side boxes
box(-24, -36, 2, 2, 2, 'crate')            // "new box" site entrance
box(-24, -34.5, 4, 15, 4, 'wall')          // solid fill x -26..-22 z -42..-27 (B east, south of doors exit)

// ---------------- window room / corridor (mid -> B rotation) ----------------
// corridor z -19..-16 runs from CT-mid (window at x -7..-6) west into B site (exit x=-26)
box(-16, -20, 20, 2, 4, 'wall')            // south mass x -26..-6 z -21..-19
box(-16, -12.5, 20, 7, 4, 'wall')          // north mass x -26..-6 z -16..-9
box(-16, -17.5, 19, 3, 0.5, 'dark', 3.2)   // corridor ceiling (room feel)
box(-6.5, -18.8, 1, 0.4, 4, 'wall')        // window jamb south (z -19..-18.6)
box(-6.5, -16.2, 1, 0.4, 4, 'wall')        // window jamb north (z -16.4..-16)
box(-6.5, -17.5, 1, 2.2, 1, 'wall')        // window sill (y 0..1.0 — jump onto it)
box(-6.5, -17.5, 1, 2.2, 1.4, 'wall', 2.6) // window lintel (y 2.6..4) — opening y 1..2.6, crouch through

// ---------------- tunnels (T -> B) ----------------
wall(-34, 24, -34, -16, 4, 'dark')         // tunnel west wall (z -16..24)
wall(-26, 24, -26, -16, 4, 'dark')         // tunnel east wall
box(-30, 4, 8, 40, 0.5, 'dark', 3.2)       // tunnel ceiling (z -16..24)
wall(-34, 30, -34, 24, 4, 'dark')          // entrance west piece
box(-16, 27, 20, 6, 4, 'wall')              // solid block A x -26..-6 z 24..30 (upper tunnel mass)
box(-16, 16.5, 20, 15, 4, 'wall')          // solid block A2 x -26..-6 z 9..24
box(-16, 0, 20, 18, 4, 'wall')             // solid fill x -26..-6 z -9..9
box(-18, -34.5, 8, 15, 4, 'wall')          // solid block C x -22..-14 z -42..-27
box(-42, 3, 16, 42, 6, 'wall')             // SW city block x -50..-34 z -18..24 (seals void west of tunnels)

// ---------------- long A ----------------
wall(30, 2, 30, -18, 4)                    // long west wall
wall(20, 8, 30, 8, 4)                      // z=8 wall west of doors gap (gap x 30..38)
wall(38, 8, 48, 8, 4)                      // z=8 wall east of doors gap
wall(30, 8, 30, 2, 4)                      // doors side wall west
wall(38, 8, 38, 2, 4)                      // doors side wall east
box(37.8, 5.5, 0.3, 1.4, 2.6, 'door', 0)   // long doors panel (slid east against jamb)
box(30.5, 4, 1.4, 1.4, 1.4, 'crate')       // blue container-ish cover in doors
box(23.5, -16, 13, 20, 4, 'wall')          // solid block D x 17..30 z -26..-6 (under A / right of cat)
box(19, 1, 22, 14, 4, 'wall')              // cat corner fill x 8..30 z -6..8
box(44, 21, 8, 26, 4, 'wall')              // east shoulder (x 40..48) of outside long
box(34, 41, 28, 10, 4, 'wall')             // south-east corner mass x 20..48 z 36..46
box(45, -9, 6, 34, 4, 'wall')              // long east block x 42..48 z -26..8 (narrows long to a corridor)

// ---------------- big building masses (skyline / fillers) ----------------
box(-42, 35, 16, 22, 4, 'wall')            // block K SW x -50..-34 z 24..46
box(-30, 41, 8, 10, 6, 'wall')             // T spawn back decor
box(30, -43, 36, 6, 5, 'wall')             // block H behind A x 12..48 z -46..-40
box(-35, -44, 26, 4, 5, 'wall')            // block I behind B x -48..-22 z -46..-42

// decor skyline towers outside map (visual only)
box(-58, -20, 10, 10, 12, 'wall', 0)
box(-58, 10, 8, 8, 9, 'wall', 0)
box(56, 0, 10, 10, 11, 'wall', 0)
box(-20, 54, 12, 8, 10, 'wall', 0)
box(10, 54, 10, 8, 8, 'wall', 0)

export const MAP_BOXES = boxes
export const MAP_VERSION = 4

// ---------------- spawns ----------------
export const SPAWNS: { CT: Vec3[]; T: Vec3[] } = {
  CT: [
    { x: -6, y: 0, z: -40 }, { x: -2, y: 0, z: -42 }, { x: 2, y: 0, z: -41 },
    { x: -4, y: 0, z: -37 }, { x: 4, y: 0, z: -37 },
  ],
  T: [
    { x: -4, y: 0, z: 38 }, { x: 0, y: 0, z: 40 }, { x: 4, y: 0, z: 38 },
    { x: -8, y: 0, z: 41 }, { x: 8, y: 0, z: 41 },
  ],
}

// ---------------- bomb sites ----------------
export const SITES = {
  A: { x: 27, z: -33, r: 8.5, y: 2 },
  B: { x: -34, z: -29, r: 8, y: 0 },
}

// ---------------- waypoints (bot navigation) ----------------
export interface WP { id: string; x: number; z: number; y: number }
export const WAYPOINTS: WP[] = [
  { id: 'tspawn', x: 0, z: 40, y: 0 },
  { id: 'tE', x: 24, z: 31, y: 0 },
  { id: 'outLong', x: 34, z: 20, y: 0 },
  { id: 'longDoors', x: 34, z: 5, y: 0 },
  { id: 'longS', x: 36, z: -6, y: 0 },
  { id: 'longN', x: 36, z: -14, y: 0 },
  { id: 'pitStairs', x: 36, z: -22, y: 1.3 },
  { id: 'aPit', x: 36, z: -30, y: 2 },
  { id: 'aDefault', x: 28, z: -33, y: 2 },
  { id: 'aGoose', x: 17, z: -36, y: 2 },
  { id: 'aRampTop', x: 12.5, z: -31, y: 2 },
  { id: 'aRampBot', x: 5, z: -31, y: 0 },
  { id: 'ctSpawn', x: 0, z: -37, y: 0 },
  { id: 'ctMid', x: 1, z: -16, y: 0 },
  { id: 'doorsGap', x: 2.1, z: -8, y: 0 },
  { id: 'midS', x: 0, z: -2, y: 0 },
  { id: 'midTop', x: 1, z: 10, y: 0 },
  { id: 'midIn', x: 1, z: 24, y: 0 },
  { id: 'midEnt', x: 5, z: 32, y: 0 },
  { id: 'catGap', x: 9, z: -8, y: 0 },
  { id: 'catCor', x: 12, z: -10, y: 0 },
  { id: 'catStairs', x: 14, z: -16.5, y: 1.7 },
  { id: 'catTop', x: 14, z: -20, y: 2 },
  { id: 'aShort', x: 14, z: -24, y: 2 },
  { id: 'aSiteNW', x: 14, z: -29, y: 2 },
  { id: 'ctW', x: -10, z: -36, y: 0 },
  { id: 'ctGap', x: -10, z: -24, y: 0 },
  { id: 'bDoors', x: -18, z: -23, y: 0 },
  { id: 'bSite', x: -34, z: -29, y: 0 },
  { id: 'bCar', x: -27.5, z: -19.5, y: 0 },
  { id: 'bPlatSt', x: -37, z: -37, y: 0 },
  { id: 'bStair', x: -39, z: -37, y: 1.2 },
  { id: 'bPlat', x: -44, z: -37, y: 1.5 },
  { id: 'tunN', x: -30, z: -13, y: 0 },
  { id: 'tunMid', x: -30, z: 4, y: 0 },
  { id: 'tunS', x: -30, z: 20, y: 0 },
  { id: 'tAppr', x: -30, z: 27, y: 0 },
  { id: 'tunM', x: -30, z: 32, y: 0 },
  { id: 'tW', x: -14, z: 34, y: 0 },
]

export const WAYPOINT_EDGES: Array<[string, string]> = [
  ['tspawn', 'tW'], ['tW', 'tunM'], ['tunM', 'tAppr'], ['tAppr', 'tunS'], ['tunS', 'tunMid'], ['tunMid', 'tunN'],
  ['tunN', 'bSite'], ['bSite', 'bPlatSt'], ['bPlatSt', 'bStair'], ['bStair', 'bPlat'], ['tunN', 'bCar'],
  ['tspawn', 'midEnt'], ['midEnt', 'midIn'], ['midIn', 'midTop'], ['midTop', 'midS'], ['midS', 'doorsGap'],
  ['doorsGap', 'ctMid'], ['ctMid', 'ctSpawn'],
  ['midS', 'catGap'], ['catGap', 'catCor'], ['catCor', 'catStairs'], ['catStairs', 'catTop'],
  ['catTop', 'aShort'], ['aShort', 'aSiteNW'], ['aSiteNW', 'aDefault'],
  ['tspawn', 'tE'], ['tE', 'outLong'], ['outLong', 'longDoors'], ['longDoors', 'longS'],
  ['longS', 'longN'], ['longN', 'pitStairs'], ['pitStairs', 'aPit'], ['aPit', 'aDefault'],
  ['aDefault', 'aGoose'], ['aGoose', 'aRampTop'], ['aRampTop', 'aRampBot'], ['aRampBot', 'ctSpawn'],
  ['ctSpawn', 'ctW'], ['ctW', 'ctGap'], ['ctGap', 'bDoors'], ['bDoors', 'bSite'],
  ['ctSpawn', 'ctMid'],
]

// ---------------- ray vs AABB (server line of sight) ----------------
export function rayHitsBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: Box, maxT: number
): boolean {
  const inv = (v: number) => (v === 0 ? 1e9 : 1 / v)
  const ix = inv(dx), iy = inv(dy), iz = inv(dz)
  let tmin = 0, tmax = maxT
  const hx = b.w / 2, hy = b.h / 2, hz = b.d / 2
  // X slab
  let t1 = (b.x - hx - ox) * ix, t2 = (b.x + hx - ox) * ix
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
  // Y slab
  t1 = (b.y - hy - oy) * iy; t2 = (b.y + hy - oy) * iy
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
  // Z slab
  t1 = (b.z - hz - oz) * iz; t2 = (b.z + hz - oz) * iz
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
  return tmax >= tmin && tmax > 0 && tmin < maxT
}

// solid boxes for LOS checks (exclude decor skyline)
const DECOR = boxes.filter(b => Math.abs(b.x) > 52 || b.z > 50 || b.z < -48)
export const LOS_BOXES = boxes.filter(b => !DECOR.includes(b))
