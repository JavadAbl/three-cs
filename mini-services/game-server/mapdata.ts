// ============================================================
// Shared map data registry (client render/collision + server LOS/bots)
// Coordinate system: X = east(+), Z = south(+), Y = up. CT = north (-Z), T = south (+Z).
//
// Maps:
//   dust  — the original layout (previously mislabeled "dust2"), v5 geometry
//   dust2 — faithful Dust II layout: T spawn south, CT spawn north,
//           long A + pit + goose, A site plateau, catwalk/short from mid,
//           mid doors + xbox, window room (mid -> B), upper/lower tunnels, B site
// ============================================================

export type MapId = 'dust' | 'dust2' | 'aimhead' | 'aimdepot' | 'island' | 'twin'

export interface Box {
  x: number; y: number; z: number   // center
  w: number; h: number; d: number   // full sizes (X, Y, Z)
  tex: 'sand' | 'wall' | 'crate' | 'metal' | 'dark' | 'plank' | 'door' | 'doorBlue' | 'brick' | 'concrete'
    | 'isand' | 'igrass' | 'irock' | 'bark' | 'leaf'   // Task 131 island families
  decor?: boolean                   // visual skyline only — excluded from LOS
}

export interface Vec3 { x: number; y: number; z: number }
export interface WP { id: string; x: number; z: number; y: number }
export interface SiteDef { x: number; z: number; r: number; y: number }

export interface MapDef {
  id: MapId
  name: string
  version: number
  boxes: Box[]
  losBoxes: Box[]                   // collision/LOS boxes (decor excluded)
  spawns: { CT: Vec3[]; T: Vec3[] }
  spawnYaw?: { CT: number; T: number } // team facing at spawn (default: T 0 / CT π)
  sites: { A: SiteDef; B: SiteDef }
  bomb?: boolean                    // defuse objective (default true). aim/DM maps set false:
                                    // no C4, no site decals, elimination-only rounds
  waypoints: WP[]
  waypointEdges: Array<[string, string]>
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

// ---------------- builder helpers ----------------
interface Builder {
  boxes: Box[]
  box: (x: number, z: number, w: number, d: number, h: number, tex: Box['tex'], y0?: number, decor?: boolean) => Box
  wall: (x1: number, z1: number, x2: number, z2: number, h?: number, tex?: Box['tex'], t?: number, y0?: number) => void
  stairs: (x1: number, x2: number, zLow: number, zHigh: number, topY: number, dir: 'z' | 'x', tex?: Box['tex'], step?: number) => void
}

function newBuilder(): Builder {
  const boxes: Box[] = []
  const box: Builder['box'] = (x, z, w, d, h, tex, y0 = 0, decor = false) => {
    // abs(): stairs() emits negative w/d when climbing north/west — a negative scale
    // would MIRROR the geometry (inside-out faces, inverted normals, swapped AABBs)
    const b: Box = { x, y: y0 + h / 2, z, w: Math.abs(w), h: Math.abs(h), d: Math.abs(d), tex }
    if (decor) b.decor = true
    boxes.push(b)
    return b
  }
  // wall segment from (x1,z1) to (x2,z2) with thickness t
  const wall: Builder['wall'] = (x1, z1, x2, z2, h = 4, tex: Box['tex'] = 'wall', t = 0.9, y0 = 0) => {
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
    const w = Math.abs(x2 - x1) || t
    const d = Math.abs(z2 - z1) || t
    box(cx, cz, Math.max(w, t) === w ? w : t, Math.max(d, t) === d ? d : t, h, tex, y0)
  }
  // ascending stairs from (xS,zS) low edge to (xN,zN) high edge, steps of `step` height
  const stairs: Builder['stairs'] = (x1, x2, zLow, zHigh, topY, dir, tex: Box['tex'] = 'plank', step = 0.25) => {
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
  return { boxes, box, wall, stairs }
}

function finishMap(
  id: MapId, name: string, version: number, b: Builder,
  spawns: MapDef['spawns'], sites: MapDef['sites'],
  waypoints: WP[], waypointEdges: Array<[string, string]>,
  bounds: MapDef['bounds']
): MapDef {
  return {
    id, name, version,
    boxes: b.boxes,
    losBoxes: b.boxes.filter(x => !x.decor),
    spawns, sites, waypoints, waypointEdges, bounds,
  }
}

// ---------------- ray vs AABB (server line of sight) ----------------
export function rayHitsBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  bx: number, by: number, bz: number, hw: number, hh: number, hd: number,
  maxT: number
): boolean {
  const inv = (v: number) => (v === 0 ? 1e9 : 1 / v)
  const ix = inv(dx), iy = inv(dy), iz = inv(dz)
  let tmin = 0, tmax = maxT
  // X slab
  let t1 = (bx - hw - ox) * ix, t2 = (bx + hw - ox) * ix
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
  // Y slab
  t1 = (by - hh - oy) * iy; t2 = (by + hh - oy) * iy
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
  // Z slab
  t1 = (bz - hd - oz) * iz; t2 = (bz + hd - oz) * iz
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
  return tmax >= tmin && tmax > 0 && tmin < maxT
}

// ray vs Box object
export function rayHitsAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: Box, maxT: number
): boolean {
  return rayHitsBox(ox, oy, oz, dx, dy, dz, b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2, maxT)
}

// ============================================================
// DUST — the original layout (v5 geometry, unchanged)
// ============================================================
function buildDust(): MapDef {
  const { boxes, box, wall, stairs } = newBuilder()

  // ---------------- ground ----------------
  box(-1, 0, 98, 92, 0.2, 'sand', -0.2) // full floor

  // ---------------- perimeter ----------------
  wall(-50, -46, 48, -46, 6)
  wall(48, -46, 48, 46, 6)
  wall(48, 46, -50, 46, 6)
  wall(-50, 46, -50, -46, 6)

  // ---------------- T spawn (south, open) ----------------
  wall(-5.55, 30, 2, 30, 4)  // T spawn wall west of mid entrance (butts mid west wall; gap = entrance)
  box(14, 19, 12, 22, 4, 'wall')          // T NE building mass x 8..20 z 8..30 (mid east boundary)
  wall(20, 44, 20, 34, 4)       // T spawn east wall (south piece), gap z 30..34 = exit to outside long
  box(-4, 36, 1.6, 1.6, 1.6, 'crate')
  box(-1.8, 36, 1.6, 1.6, 1.6, 'crate')
  box(-2.9, 36, 1.6, 1.6, 1.6, 'crate', 1.6)
  box(-10, 42, 2, 2, 2, 'crate')
  box(16, 37, 1.8, 1.8, 1.8, 'crate')

  // ---------------- mid lane ----------------
  wall(-6, 30.45, -6, -9, 4)  // mid west wall (laps past the T-spawn wall junction)
  wall(8, 30.45, 8, -6, 4)    // mid east wall (upper) — cat gap at z -13..-6 (laps T NE corner)
  wall(8, -13, 8, -26, 4)       // mid east wall (lower/CT-mid side)
  wall(-6, -9, 0, -9, 3)        // mid doors wall (west part) — gap x 0..4.2 = double doors
  wall(4.2, -9, 8, -9, 3)       // mid doors wall (east part)
  wall(0, -9, 4.2, -9, 0.6, 'metal', 0.6, 2.4) // door lintel
  box(0.15, -9, 0.3, 1.2, 2.4, 'doorBlue', 0)    // door panel west (slid against jamb)
  box(4.05, -9, 0.3, 1.2, 2.4, 'doorBlue', 0)    // door panel east (slid against jamb)
  box(2, 4, 1.4, 1.4, 1.4, 'crate')            // "xbox" mid cover
  box(-3, -3, 1.4, 1.4, 1.4, 'crate')

  // ---------------- catwalk / short A ----------------
  wall(8, -6, 15, -6, 4)        // cat south wall (z=-6, from mid wall to x 15)
  wall(8, -13, 12, -13, 4)      // cat north wall — x 8..12 only, stairs entry open east of x12
  wall(17, -13, 17, -18, 4)     // cat stairs east wall
  stairs(12, 16.55, -13, -18, 2, 'z')       // cat stairs 0 -> 2 climbing north (stop at east wall)
  box(14.5, -20, 5, 4, 2, 'wall', 0)       // cat top platform x12..17 z -22..-18 (top y=2)
  box(14.5, -24, 5, 4, 2, 'wall', 0)       // cat neck x12..17 z -26..-22 (top y=2)
  box(10.5, -7.05, 1, 1, 1, 'crate')         // short boost box (south side, clear of cat south wall)
  box(15.8, -10.5, 1.2, 1.2, 1.2, 'crate')   // crate in cat entry corridor (east side, off bot path)
  box(10.2, -19.5, 3.5, 13, 4, 'wall')      // under-cat fill x 8.45..11.95 z -26..-13 (seals dead pocket)

  // ---------------- A site platform ----------------
  box(30, -33, 36, 14, 2, 'wall')            // main platform x12..48 z -40..-26 (top y=2)
  box(30, -33, 36, 14, 0.05, 'sand', 2)      // platform sandy top layer (the walking surface, y 2..2.05)
  // pit stairs: long (y0) up to platform south edge (y2), x 30..42
  stairs(30, 42, -18, -26, 2, 'z', 'plank')
  // A site props (all y0=2.05 = sand layer top, no sinking)
  box(24, -30, 2.2, 2.2, 2.2, 'crate', 2.05)    // default plant crate (north of goose path)
  box(24, -30, 1.6, 1.6, 1.6, 'crate', 4.25)
  box(39, -31, 1.8, 1.8, 1.8, 'crate', 2.05)    // pit-top crate
  box(40, -37, 2, 2, 2, 'crate', 2.05)          // goose corner
  box(19.5, -38, 1.5, 1.5, 1.5, 'crate', 2.05)  // goose crates
  box(44, -28, 2.2, 2.2, 2.2, 'crate', 2.05)    // A car/corner crates
  box(40, -14, 1.6, 1.6, 1.6, 'crate')       // long lane crate (near pit stairs foot, off bot path)
  box(38, -11, 2, 2, 2, 'crate')             // long corner crate
  box(38.5, -3, 1.4, 1.4, 1.4, 'crate')        // long crate cover (east side, off the lane)

  // ---------------- A ramp from CT ----------------
  stairs(8, 12, -34, -28, 2, 'x', 'plank')   // ramp 0 -> 2 climbing east (x8..12)
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
  box(-21.4, -25.7, 0.3, 1.6, 2.6, 'doorBlue', 0) // door panel slid open (flush inside south wall face)

  // ---------------- B site ----------------
  box(-34.9, -29, 25.8, 26, 0.04, 'sand', 0.02)  // B ground detail z -42..-16 (west tip tucks into platform)
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
  wall(-26, 24, -26, -16.45, 4, 'dark')      // tunnel east wall (juts past window-room mass face)
  box(-30, 4, 8, 40.9, 0.5, 'dark', 3.2)     // tunnel ceiling (z -16.45..24.45, laps past mouths)
  wall(-34, 30, -34, 24, 4, 'dark')          // entrance west piece
  box(-16, 27, 20, 6, 4, 'wall')              // solid block A x -26..-6 z 24..30 (upper tunnel mass)
  box(-16, 16.5, 20, 15, 4, 'wall')          // solid block A2 x -26..-6 z 9..24
  box(-16, 0, 20, 18, 4, 'wall')             // solid fill x -26..-6 z -9..9
  box(-18, -34.5, 8, 15, 4, 'wall')          // solid block C x -22..-14 z -42..-27
  box(-42, 3, 16, 42, 6, 'wall')             // SW city block x -50..-34 z -18..24 (seals void west of tunnels)

  // ---------------- long A ----------------
  wall(30, -6, 30, -18, 4)                // long west wall (z -18..-6; north part = cat corner fill)
  wall(20, 8, 29.55, 8, 4)                // z=8 wall west of doors gap (stops at side wall)
  wall(38.45, 8, 48, 8, 4)                // z=8 wall east of doors gap (starts at side wall)
  wall(38, 8, 38, 2, 4)                      // doors side wall east (west jamb = cat corner fill face)
  box(37.3, 5.5, 0.3, 1.4, 2.6, 'door', 0)   // long doors panel (slid east, flush against jamb inside)
  box(31.6, 4, 1.4, 1.4, 1.4, 'crate')       // blue container-ish cover in doors (clear of side walls)
  box(23.5, -16, 13, 20, 4, 'wall')          // solid block D x 17..30 z -26..-6 (under A / right of cat)
  box(19.225, 1, 22.45, 14, 4, 'wall')       // cat corner fill x 8..30.45 z -6..8 (east face = doors jamb)
  box(44, 21, 8, 26, 4, 'wall')              // east shoulder (x 40..48) of outside long
  box(34, 41, 28, 10, 4, 'wall')             // south-east corner mass x 20..48 z 36..46
  box(45, -9, 6, 34, 4, 'wall')              // long east block x 42..48 z -26..8 (narrows long to a corridor)

  // ---------------- big building masses (skyline / fillers) ----------------
  box(-42, 35, 16, 22, 4, 'wall')            // block K SW x -50..-34 z 24..46
  box(-30, 41, 8, 10, 6, 'wall')             // T spawn back decor
  box(30, -43, 36, 6, 5, 'wall')             // block H behind A x 12..48 z -46..-40
  box(-35, -44, 26, 4, 5, 'wall')            // block I behind B x -48..-22 z -46..-42

  // decor skyline towers outside map (visual only)
  box(-58, -20, 10, 10, 12, 'wall', 0, true)
  box(-58, 10, 8, 8, 9, 'wall', 0, true)
  box(56, 0, 10, 10, 11, 'wall', 0, true)
  box(-20, 54, 12, 8, 10, 'wall', 0, true)
  box(10, 54, 10, 8, 8, 'wall', 0, true)

  return finishMap('dust', 'Dust', 5, { boxes, box, wall, stairs } as Builder, {
    CT: [
      { x: -6, y: 0, z: -40 }, { x: -2, y: 0, z: -42 }, { x: 2, y: 0, z: -41 },
      { x: -4, y: 0, z: -37 }, { x: 4, y: 0, z: -37 },
    ],
    T: [
      { x: -4, y: 0, z: 38 }, { x: 0, y: 0, z: 40 }, { x: 4, y: 0, z: 38 },
      { x: -8, y: 0, z: 41 }, { x: 8, y: 0, z: 41 },
    ],
  }, {
    A: { x: 27, z: -33, r: 8.5, y: 2 },
    B: { x: -34, z: -29, r: 8, y: 0 },
  }, [
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
  ], [
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
  ], { minX: -50, maxX: 50, minZ: -48, maxZ: 48 })
}

// ============================================================
// DUST II — faithful layout
//   T spawn (south) -> { long A (east), mid (center), upper tunnels (west) }
//   CT spawn (north) -> { A ramp, CT-mid, B doors }
//   Rotations: catwalk (CT-mid -> A short), window room (CT-mid -> B),
//              lower tunnels (mid -> B tunnels), pit (below long/A)
// ============================================================
function buildDust2(): MapDef {
  const { boxes, box, wall, stairs } = newBuilder()

  // ---------------- ground (split around the pit hole x 26..34 z -20..-10) ----------------
  box(-11.5, 0, 75, 96, 0.2, 'sand', -0.2)   // west piece x -49..26
  box(41.5, 0, 15, 96, 0.2, 'sand', -0.2)   // east piece x 34..49
  box(30, -34, 8, 28, 0.2, 'sand', -0.2)    // middle-north x 26..34 z -48..-20
  box(30, 19, 8, 58, 0.2, 'sand', -0.2)     // middle-south x 26..34 z -10..48

  // ---------------- perimeter ----------------
  // north/south walls own the corners (full x span); east/west walls butt at z ±47.55 — no corner overlap
  wall(-48.45, -48, 48.45, -48, 6)
  wall(48, -47.55, 48, 47.55, 6)
  wall(-48.45, 48, 48.45, 48, 6)
  wall(-48, -47.55, -48, 47.55, 6)

  // ---------------- T spawn (south, open) x -26..20 z 30..44 ----------------
  box(-37, 37, 22, 14, 4, 'wall')           // SW block x -48..-26 z 30..44
  box(0, 46, 96, 4, 5, 'wall')              // T-back strip z 44..48
  box(-11, 28, 14, 4, 4, 'wall')            // west top-mid building x -18..-4 z 26..30
  box(15, 20, 14, 12, 4, 'wall')            // top-mid east building x 8..22 z 14..26
  // T spawn props
  box(-12, 38, 1.8, 1.8, 1.8, 'crate')
  box(-10, 40, 2, 2, 2, 'crate')
  box(-10, 40, 1.5, 1.5, 1.5, 'crate', 2)
  box(10, 38, 1.8, 1.8, 1.8, 'crate')
  box(17, 42, 1.6, 1.6, 1.6, 'crate')

  // ---------------- tunnels (T -> B) ----------------
  // entrance stairs from T spawn (z 30, y0) climbing north onto tunnel floor (y1)
  stairs(-26, -18, 30, 26, 1, 'z', 'dark', 0.25)
  // upper tunnel floor mass x -26..-18 z -14..26 (top y1)
  box(-22, 6, 8, 40, 1, 'dark')
  // exit stairs down into B site (z -18 y0 -> z -14 y1 climbing north = descending south)
  stairs(-26, -18, -18, -14, 1, 'z', 'dark', 0.25)
  box(-22, 6, 8, 40, 0.5, 'dark', 3.2)      // tunnel ceiling
  // junction stairs: lower tunnel (y0) up to upper tunnel floor (y1), climbing west
  stairs(-16, -18, 2, 8, 1, 'x', 'dark', 0.2)
  // big masses between mid and tunnels
  box(-11, -5, 14, 14, 4, 'wall')           // north mass x -18..-4 z -12..2
  box(-16, -15, 4, 6, 4, 'wall')            // pocket-side fill x -18..-14 z -18..-12
  box(-11, 17, 14, 18, 4, 'wall')           // south mass x -18..-4 z 8..26
  box(-37, 8, 22, 44, 4, 'wall')            // SW city mass x -48..-26 z -14..30
  box(-35, -16, 18, 4, 4, 'wall')           // SW strip x -44..-26 z -18..-14

  // ---------------- mid lane ----------------
  // CT-mid x 0..8 z -28..-12; mid proper x -4..8 z -12..26
  box(2, 2, 2.4, 2.4, 2.4, 'crate')         // "xbox" mid cover
  box(6, 16, 1.6, 1.6, 1.6, 'crate')        // mid single crate (east side)
  // mid doors (double) at z -12, gap x 1.5..6.5
  wall(-4, -12, 1.5, -12, 3)
  wall(6.5, -12, 8, -12, 3)
  box(4, -12, 5, 0.6, 0.6, 'metal', 2.4)    // door lintel
  box(1.8, -12, 0.3, 1.4, 2.4, 'doorBlue', 0) // door panel west (slid to jamb)
  box(6.2, -12, 0.3, 1.4, 2.4, 'doorBlue', 0) // door panel east

  // ---------------- window room (CT-mid -> B) ----------------
  // room x -14..0 z -26..-18, floor y0; window vault on east wall (x 0) facing CT-mid
  box(-7, -22, 13.5, 8, 0.5, 'dark', 3.2)   // room ceiling (clear of lintel)
  box(-5, -27, 10, 2, 4, 'wall')           // north fill x -10..0 z -28..-26
  box(-7, -15, 14, 6, 4, 'wall')            // south fill x -14..0 z -18..-12
  wall(0, -26, 0, -23, 4)                   // CT-mid west wall (north piece)
  wall(0, -21, 0, -18, 4)                   // CT-mid west wall (south piece)
  box(0, -22, 0.9, 2, 1, 'wall', 0)         // window sill (y 0..1)
  box(0, -22, 0.9, 2, 1.4, 'wall', 2.6)     // window lintel (y 2.6..4, opening y 1..2.6)

  // ---------------- catwalk (CT-mid -> A short) ----------------
  // cat stairs climb east from CT-mid (x 8, y0) to cat level (x 16, y2.8)
  stairs(8, 16, -18, -14, 2.8, 'x', 'plank', 0.23)
  box(12, -23, 8, 10, 4, 'wall')            // cat-stairs building x 8..16 z -28..-18
  box(12, -13, 8, 2, 4, 'wall')             // fill x 8..16 z -14..-12
  box(12, 0, 8, 28, 4, 'wall')              // suicide mass west x 8..16 z -14..14 (mid east boundary)
  box(19, -14, 6, 8, 2.8, 'wall')           // cat platform x 16..22 z -18..-10 (top 2.8)
  box(19, -25, 6, 14, 2.8, 'wall')          // cat neck x 16..22 z -32..-18 (top 2.8)
  box(19, 2, 6, 24, 4, 'wall')              // under-cat fill x 16..22 z -10..14
  box(28, 1, 12, 26, 4, 'wall')             // suicide building east x 22..34 z -12..14
  box(28, 16, 12, 4, 4, 'wall')             // outside-long north fill x 22..34 z 14..18

  // ---------------- A site plateau (x 22..44 z -42..-20, top y2) ----------------
  box(33, -31, 22, 22, 2, 'wall')           // main platform
  box(33, -31, 22, 22, 0.05, 'sand', 2)     // sandy walking surface (top 2.05)
  // long ramp: from long corridor (z -10, y0) climbing north onto site (z -20, y2)
  stairs(34, 44, -10, -20, 2, 'z', 'plank', 0.25)
  // CT ramp: from CT plaza (x 16, y0) climbing east onto site west edge (x 22, y2)
  stairs(16, 22, -40, -34, 2, 'x', 'plank', 0.25)
  box(19, -42, 6, 4, 4, 'wall')             // CT ramp north jamb x 16..22 z -44..-40
  box(19, -33, 6, 2, 4, 'wall')             // CT ramp south jamb x 16..22 z -34..-32
  // short-drop steps (cat y2.8 -> site y2.05), on the site surface hugging cat neck east face
  box(24, -28, 0.8, 4, 0.2, 'plank', 2.05)    // step 1 (top 2.25) x 23.6..24.4
  box(23.2, -28, 0.8, 4, 0.2, 'plank', 2.25)  // step 2 (top 2.45) x 22.8..23.6
  box(22.4, -28, 0.8, 4, 0.2, 'plank', 2.45)  // step 3 (top 2.65) x 22..22.8
  // A site props (y0 2.05 = sand surface)
  box(41, -27, 4.5, 2.2, 1.3, 'doorBlue', 2.05) // "the car" (blue container, NE of ramp top, off bot paths)
  box(24.5, -33.5, 2.2, 2.2, 2.2, 'crate', 2.05)      // default plant crate
  box(24.5, -33.5, 1.6, 1.6, 1.6, 'crate', 4.25)
  box(23.5, -40.5, 2, 2, 2, 'crate', 2.05)          // goose corner
  box(24.2, -41.2, 1.6, 1.6, 1.6, 'crate', 2.05)
  box(27, -21, 1.8, 1.8, 1.8, 'crate', 2.05)        // pit-top crate (south edge)
  box(41, -38, 2, 2, 2, 'crate', 2.05)              // NE corner crates
  box(42.5, -36, 1.6, 1.6, 1.6, 'crate', 2.05)
  // big fills around A
  box(46, -26, 4, 32, 4, 'wall')            // east shoulder x 44..48 z -42..-10
  box(46, 4, 4, 28, 4, 'wall')              // long east fill x 44..48 z -10..18
  box(33, -45, 22, 6, 5, 'wall')            // block behind A z -48..-42
  box(24, -16, 4, 8, 4, 'wall')             // mass between cat neck and pit x 22..26 z -20..-12

  // ---------------- pit (sunken nook below long, x 26..34 z -20..-10) ----------------
  box(30, -15, 8, 10, 0.2, 'dark', -1.6)    // pit floor (top -1.4)
  box(30, -19.9, 8, 0.2, 1.4, 'dark', -1.4) // north rim
  box(30, -10.1, 8, 0.2, 1.4, 'dark', -1.4) // south rim
  box(26.1, -15, 0.2, 10, 1.4, 'dark', -1.4)// west rim
  box(33.9, -15, 0.2, 10, 1.4, 'dark', -1.4)// east rim
  // exit steps (SE corner, 0.28 rises climbing south)
  box(32, -15, 2, 1, 0.28, 'dark', -1.4)
  box(32, -14, 2, 1, 0.28, 'dark', -1.12)
  box(32, -13, 2, 1, 0.28, 'dark', -0.84)
  box(32, -12, 2, 1, 0.28, 'dark', -0.56)
  box(32, -11, 2, 1, 0.28, 'dark', -0.28)
  box(29, -17, 1.4, 1.4, 1.4, 'crate', -1.4) // pit crate cover

  // ---------------- long A (east lane) x 34..44 ----------------
  // corridor z -10..18; long doors (double) at z 18, gap x 36..42
  wall(34, 18, 36, 18, 4)
  wall(42, 18, 44, 18, 4)
  box(39, 18, 6, 0.6, 0.6, 'metal', 2.4)    // door lintel
  box(36.3, 18, 0.3, 1.4, 2.6, 'door', 0)   // door panel west (slid to jamb)
  box(41.7, 18, 0.3, 1.4, 2.6, 'door', 0)   // door panel east
  box(46, 31, 4, 26, 4, 'wall')             // east shoulder south x 44..48 z 18..44
  // long lane props (off the bot line x 39)
  box(42.5, 4, 1.6, 1.6, 1.6, 'crate')
  box(36, -4, 1.4, 1.4, 1.4, 'crate')
  // outside-long props
  box(30, 36, 2, 2, 2, 'crate')
  box(36, 40, 1.8, 1.8, 1.8, 'crate')

  // ---------------- CT spawn plaza (x -10..16 z -44..-28) ----------------
  box(10, -32, 1.8, 1.8, 1.8, 'crate')
  box(12, -40, 1.8, 1.8, 1.8, 'crate')
  box(-6, -42, 2.2, 2.2, 1.2, 'crate')

  // ---------------- B doors corridor (CT -> B) x -20..-10 z -36..-30 ----------------
  box(-15, -39, 10, 6, 4, 'wall')           // north fill x -20..-10 z -42..-36
  box(-15, -28, 10, 4, 4, 'wall')           // south fill x -20..-10 z -30..-26
  box(-15, -45, 10, 6, 5, 'wall')           // NW void fill x -20..-10 z -48..-42
  box(-16, -35.3, 0.3, 1.4, 2.4, 'doorBlue', 0) // B doors panel north (slid to jamb)
  box(-16, -30.7, 0.3, 1.4, 2.4, 'doorBlue', 0) // B doors panel south
  box(-16, -33, 0.3, 6, 0.6, 'metal', 2.4)  // B doors lintel

  // ---------------- B site (x -44..-20 z -42..-18) ----------------
  box(-39, -38, 10, 8, 1.5, 'wall')         // back platform x -44..-34 z -42..-34 (top 1.5)
  stairs(-42, -34, -26, -34, 1.5, 'z', 'plank', 0.25) // plat stairs (climb north from z -26)
  box(-46, -30, 4, 24, 4, 'wall')           // west shoulder x -48..-44 z -42..-18
  box(-32, -45, 24, 6, 5, 'wall')           // block behind B z -48..-42
  // B props
  box(-28, -34, 2, 2, 2, 'crate')           // double stack (off the doors->site diagonal)
  box(-28, -34, 1.6, 1.6, 1.6, 'crate', 2)
  box(-22, -24, 2, 2, 2, 'crate')           // "new box" near tunnel mouth
  box(-26.5, -20.5, 4, 2, 1.3, 'metal', 0)  // "the car" (entrance cover, off tunnel exit path)
  box(-33, -31, 1.8, 1.8, 1.8, 'crate')     // plant zone crates
  box(-34.5, -32, 1.6, 1.6, 1.6, 'crate')
  box(-42.5, -39.5, 2, 2, 2, 'crate', 1.55) // plat crates
  box(-42, -20, 2, 2, 2, 'crate')           // window-side boxes

  // decor skyline towers outside map (visual only)
  box(-56, -30, 8, 8, 10, 'wall', 0, true)
  box(-56, 10, 10, 10, 8, 'wall', 0, true)
  box(54, 20, 8, 8, 12, 'wall', 0, true)
  box(-30, 54, 10, 8, 9, 'wall', 0, true)
  box(20, 54, 12, 8, 11, 'wall', 0, true)

  return finishMap('dust2', 'Dust II', 1, { boxes, box, wall, stairs } as Builder, {
    CT: [
      { x: 4, y: 0, z: -38 }, { x: 0, y: 0, z: -40 }, { x: 8, y: 0, z: -40 },
      { x: 2, y: 0, z: -36 }, { x: 12, y: 0, z: -38 },
    ],
    T: [
      { x: -6, y: 0, z: 38 }, { x: -2, y: 0, z: 40 }, { x: 2, y: 0, z: 40 },
      { x: 6, y: 0, z: 38 }, { x: -10, y: 0, z: 36 },
    ],
  }, {
    A: { x: 30, z: -30, r: 8.5, y: 2 },
    B: { x: -32, z: -27, r: 8, y: 0 },
  }, [
    { id: 'tspawn', x: 0, z: 38, y: 0 },
    { id: 'tE', x: 14, z: 34, y: 0 },
    { id: 'outLong', x: 30, z: 28, y: 0 },
    { id: 'longDoorsN', x: 39, z: 21, y: 0 },
    { id: 'longDoorsS', x: 39, z: 15, y: 0 },
    { id: 'longMid', x: 39, z: 2, y: 0 },
    { id: 'longN', x: 39, z: -8, y: 0 },
    { id: 'aRamp', x: 39, z: -14, y: 0.8 },
    { id: 'aRampTop', x: 39, z: -21, y: 2 },
    { id: 'aCar', x: 36, z: -23, y: 2 },
    { id: 'aNE', x: 40, z: -35, y: 2 },
    { id: 'aDefault', x: 28, z: -31, y: 2 },
    { id: 'aGoose', x: 25, z: -39, y: 2 },
    { id: 'ctRampBot', x: 14, z: -37, y: 0 },
    { id: 'ctRampTop', x: 20, z: -37, y: 2 },
    { id: 'topMid', x: 2, z: 24, y: 0 },
    { id: 'midS', x: 4, z: 10, y: 0 },
    { id: 'xboxE', x: 5, z: 2, y: 0 },
    { id: 'midDoors', x: 4, z: -12, y: 0 },
    { id: 'ctMid', x: 4, z: -20, y: 0 },
    { id: 'ctMidN', x: 4, z: -27, y: 0 },
    { id: 'ctSpawn', x: 4, z: -34, y: 0 },
    { id: 'ctW', x: -6, z: -33, y: 0 },
    { id: 'catBase', x: 9, z: -16, y: 0.35 },
    { id: 'catTop', x: 15.5, z: -16, y: 2.8 },
    { id: 'catPlat', x: 19, z: -14, y: 2.8 },
    { id: 'catNeck', x: 19, z: -24, y: 2.8 },
    { id: 'shortStep', x: 23, z: -28, y: 2.35 },
    { id: 'aSW', x: 26, z: -28, y: 2 },
    { id: 'tunEnt', x: -22, z: 31, y: 0 },
    { id: 'tunTop', x: -22, z: 25, y: 1 },
    { id: 'tunMid', x: -22, z: 6, y: 1 },
    { id: 'tunN', x: -22, z: -12, y: 1 },
    { id: 'tunExit', x: -23, z: -16, y: 0.5 },
    { id: 'bSE', x: -24, z: -23, y: 0 },
    { id: 'bSite', x: -31, z: -28, y: 0 },
    { id: 'bPlatBot', x: -38.5, z: -26.5, y: 0.25 },
    { id: 'bPlatMid', x: -39, z: -30, y: 0.75 },
    { id: 'bPlatTop', x: -39, z: -36, y: 1.5 },
    { id: 'bNW', x: -41, z: -40, y: 1.5 },
    { id: 'bDoorsE', x: -11, z: -33, y: 0 },
    { id: 'bDoorsW', x: -18, z: -33, y: 0 },
    { id: 'lowTunE', x: -3, z: 5, y: 0 },
    { id: 'lowTunMid', x: -10, z: 5, y: 0 },
    { id: 'lowJn', x: -17, z: 5, y: 0.5 },
  ], [
    // T -> long A
    ['tspawn', 'tE'], ['tE', 'outLong'], ['outLong', 'longDoorsN'], ['longDoorsN', 'longDoorsS'],
    ['longDoorsS', 'longMid'], ['longMid', 'longN'], ['longN', 'aRamp'], ['aRamp', 'aRampTop'],
    ['aRampTop', 'aCar'],
    // A site web
    ['aCar', 'aDefault'], ['aCar', 'aNE'], ['aNE', 'aGoose'], ['aGoose', 'ctRampTop'],
    ['aDefault', 'aSW'], ['aGoose', 'aDefault'],
    // T -> mid
    ['tspawn', 'topMid'], ['topMid', 'midS'], ['midS', 'xboxE'], ['xboxE', 'midDoors'],
    ['midDoors', 'ctMid'], ['ctMid', 'ctMidN'], ['ctMidN', 'ctSpawn'],
    // T-side rotation top-mid <-> outside long
    ['topMid', 'tE'],
    // catwalk (CT-mid -> A)
    ['ctMid', 'catBase'], ['catBase', 'catTop'], ['catTop', 'catPlat'], ['catPlat', 'catNeck'],
    ['catNeck', 'shortStep'], ['shortStep', 'aSW'],
    // T -> tunnels -> B
    ['tspawn', 'tunEnt'], ['tunEnt', 'tunTop'], ['tunTop', 'tunMid'], ['tunMid', 'tunN'],
    ['tunN', 'tunExit'], ['tunExit', 'bSE'], ['bSE', 'bSite'],
    // B site web
    ['bSite', 'bPlatBot'], ['bPlatBot', 'bPlatMid'], ['bPlatMid', 'bPlatTop'], ['bPlatTop', 'bNW'],
    // CT -> B doors
    ['ctSpawn', 'ctW'], ['ctW', 'bDoorsE'], ['bDoorsE', 'bDoorsW'], ['bDoorsW', 'bSite'],
    // CT ramp
    ['ctSpawn', 'ctRampBot'], ['ctRampBot', 'ctRampTop'],
    // lower tunnels (mid -> B)
    ['midS', 'lowTunE'], ['lowTunE', 'lowTunMid'], ['lowTunMid', 'lowJn'], ['lowJn', 'tunMid'],
  ], { minX: -48, maxX: 48, minZ: -48, maxZ: 48 })
}

// ============================================================
// AIM DEPOT — classic crate-yard aim arena (Task 87, reworked 99)
// Rifle-duel counterpart to aim_headshot's pistol shoebox: flat sandy
// yard 64 x 44, CT north / T south (standard orientation), three lanes
// split by two LOW LANE WALLS (Task 99: the floating window upper bands
// + parapet caps are gone — 1.2 m duck cover, clean open sightlines for
// standing duels), symmetric crate cover, a mid monolith stack.
// Registered bomb:false — pure elimination rounds, no C4 anywhere
// (Task 85 semantics).
// ============================================================
function buildAimDepot(): MapDef {
  const { boxes, box, wall } = newBuilder()

  // ---------------- ground (top y = 0) ----------------
  box(0, 0, 64, 44, 0.2, 'sand', -0.2)        // x -32..32 · z -22..22

  // ---------------- perimeter (N/S own the corners) ----------------
  wall(-32.45, -22, 32.45, -22, 6)
  wall(-32.45, 22, 32.45, 22, 6)
  wall(32, -21.55, 32, 21.55, 6)
  wall(-32, -21.55, -32, 21.55, 6)
  // (Task 99) parapet caps REMOVED — user: they read as two floating
  // rectangles from the yard (thin 1.3 m slabs at y 5.75 above the 6 m
  // walls; wall occluded by crates/window walls -> 'floating beam' look.
  // VLM t99 confirmed cap end-faces/side-faces were the shapes). Clean
  // wall-top edge restored. Mirrors src/game/mapdata.ts.

  // ---------------- lane-split walls — the three-lane split ----------------
  // (Task 99) UPPER BANDS REMOVED — user: the two floating brick slabs
  // (3.0..5.2 with the open window gap below) read as 'two rectangles in
  // the air'; VLM t99 color evidence (tan/brick, 1 big per side from
  // spawn) identified THEM as the prominent pair. Walls are now clean
  // 1.2 m duck-cover sightlines — classic aim-map lanes: duckers hide,
  // standing duels shoot straight over the top. Mirrors src/game/mapdata.ts.
  box(-10, 0, 0.8, 18, 1.2, 'brick')          // west low band
  box(10, 0, 0.8, 18, 1.2, 'brick')         // east low band

  // ---------------- spawn shields (forward spawn cover) ----------------
  // Center gap x -2..2 stays open; sides open past x +/-10.
  box(-6, -14, 8, 0.8, 1.4, 'wall')          // CT west shield x -10..-2
  box(6, -14, 8, 0.8, 1.4, 'wall')           // CT east shield x 2..10
  box(-6, 14, 8, 0.8, 1.4, 'wall')           // T west shield
  box(6, 14, 8, 0.8, 1.4, 'wall')            // T east shield

  // ---------------- crate cover ----------------
  // center monolith (the aim_map landmark)
  box(0, 0, 2.2, 2.2, 2.2, 'crate')
  box(0.35, -0.35, 1.6, 1.6, 1.6, 'crate', 2.2)
  // ring crates around the monolith (1.8 cubes)
  box(-7, -5.5, 1.8, 1.8, 1.8, 'crate')
  box(7, -5.5, 1.8, 1.8, 1.8, 'crate')
  box(-7, 5.5, 1.8, 1.8, 1.8, 'crate')
  box(7, 5.5, 1.8, 1.8, 1.8, 'crate')
  // lane cover: singles near lane entries + one stack per lane
  box(-23, -8, 1.8, 1.8, 1.8, 'crate')
  box(-23, 8, 1.8, 1.8, 1.8, 'crate')
  box(23, -8, 1.8, 1.8, 1.8, 'crate')
  box(23, 8, 1.8, 1.8, 1.8, 'crate')
  box(-26, 0, 2, 2, 2, 'crate')
  box(-26, 0, 1.5, 1.5, 1.5, 'crate', 2)
  box(26, 0, 2, 2, 2, 'crate')
  box(26, 0.35, 1.5, 1.5, 1.5, 'crate', 2)
  // corner crates (2.0 cubes)
  box(-27, -16, 2, 2, 2, 'crate')
  box(27, -16, 2, 2, 2, 'crate')
  box(-27, 16, 2, 2, 2, 'crate')
  box(27, 16, 2, 2, 2, 'crate')

  // ---------------- skyline (decor — visual only, no LOS/collision) ----------------
  box(-38, -12, 12, 16, 8, 'wall', 6, true)
  box(-39, 11, 14, 16, 6, 'brick', 6, true)
  box(38, -13, 12, 14, 7, 'wall', 6, true)
  box(39, 12, 10, 16, 9, 'brick', 6, true)
  box(-13, 26, 18, 8, 5, 'wall', 6, true)
  box(12, 26, 16, 8, 4, 'wall', 6, true)
  box(-10, -26, 16, 8, 4, 'brick', 6, true)
  box(14, -26, 18, 8, 5, 'brick', 6, true)

  // CT north (z -18/-20.5), T south — default team yaw (T faces north, CT south)
  return finishMap('aimdepot', 'Aim Depot', 3, { boxes, box, wall } as Builder, {
    CT: [
      { x: 0, y: 0, z: -17.5 }, { x: -3, y: 0, z: -17.5 }, { x: 3, y: 0, z: -17.5 },
      { x: -6, y: 0, z: -17.5 }, { x: 6, y: 0, z: -17.5 }, { x: -9, y: 0, z: -17.5 },
      { x: 9, y: 0, z: -17.5 }, { x: 0, y: 0, z: -20.5 }, { x: -4.5, y: 0, z: -20.5 },
      { x: 4.5, y: 0, z: -20.5 },
    ],
    T: [
      { x: 0, y: 0, z: 17.5 }, { x: -3, y: 0, z: 17.5 }, { x: 3, y: 0, z: 17.5 },
      { x: -6, y: 0, z: 17.5 }, { x: 6, y: 0, z: 17.5 }, { x: -9, y: 0, z: 17.5 },
      { x: 9, y: 0, z: 17.5 }, { x: 0, y: 0, z: 20.5 }, { x: -4.5, y: 0, z: 20.5 },
      { x: 4.5, y: 0, z: 20.5 },
    ],
  }, {
    // strategic anchors for bots on a no-bomb map (sites carry no objective)
    A: { x: 0, z: -14, r: 5, y: 0 },
    B: { x: 0, z: 14, r: 5, y: 0 },
  }, [
    // CT side
    { id: 'ctSpawn', x: 0, z: -18, y: 0 },
    { id: 'ctL', x: -20, z: -18, y: 0 },
    { id: 'ctR', x: 20, z: -18, y: 0 },
    { id: 'ctMid', x: 0, z: -12, y: 0 },
    { id: 'ctWJ', x: -10, z: -13, y: 0 },     // west junction (window wall ends at z -9)
    { id: 'ctEJ', x: 10, z: -13, y: 0 },      // east junction
    { id: 'ctWL', x: -21, z: -10, y: 0 },     // west lane entry
    { id: 'ctER', x: 21, z: -10, y: 0 },      // east lane entry
    // lanes (outside the low lane walls)
    { id: 'laneWN', x: -21, z: -4, y: 0 },
    { id: 'laneWS', x: -21, z: 4, y: 0 },
    { id: 'laneEN', x: 21, z: -4, y: 0 },
    { id: 'laneES', x: 21, z: 4, y: 0 },
    // mid corridor
    { id: 'midN', x: 0, z: -8, y: 0 },
    { id: 'midS', x: 0, z: 8, y: 0 },
    { id: 'midW', x: -4.5, z: 0, y: 0 },
    { id: 'midE', x: 4.5, z: 0, y: 0 },
    // hub ring around the monolith
    { id: 'hNW', x: -4, z: -4, y: 0 },
    { id: 'hNE', x: 4, z: -4, y: 0 },
    { id: 'hSW', x: -4, z: 4, y: 0 },
    { id: 'hSE', x: 4, z: 4, y: 0 },
    // T side
    { id: 'tMid', x: 0, z: 12, y: 0 },
    { id: 'tWJ', x: -10, z: 13, y: 0 },
    { id: 'tEJ', x: 10, z: 13, y: 0 },
    { id: 'tWL', x: -21, z: 10, y: 0 },
    { id: 'tER', x: 21, z: 10, y: 0 },
    { id: 'tL', x: -20, z: 18, y: 0 },
    { id: 'tR', x: 20, z: 18, y: 0 },
    { id: 'tSpawn', x: 0, z: 18, y: 0 },
  ], [
    // spawn web
    ['ctSpawn', 'ctMid'], ['ctSpawn', 'ctL'], ['ctSpawn', 'ctR'],
    ['tSpawn', 'tMid'], ['tSpawn', 'tL'], ['tSpawn', 'tR'],
    ['tL', 'tWL'], ['tR', 'tER'], ['ctL', 'ctWL'], ['ctR', 'ctER'],
    // CT approach
    ['ctMid', 'ctWJ'], ['ctMid', 'ctEJ'], ['ctWJ', 'ctWL'], ['ctEJ', 'ctER'],
    ['ctWJ', 'midN'], ['ctEJ', 'midN'],
    // lanes run north-south
    ['ctWL', 'laneWN'], ['ctER', 'laneEN'],
    ['laneWN', 'laneWS'], ['laneEN', 'laneES'],
    ['laneWS', 'tWL'], ['laneES', 'tER'],
    // T approach (mirror)
    ['tMid', 'tWJ'], ['tMid', 'tEJ'], ['tWJ', 'tWL'], ['tEJ', 'tER'],
    ['tWJ', 'midS'], ['tEJ', 'midS'],
    // mid corridor + hub ring around the monolith
    ['midN', 'hNW'], ['midN', 'hNE'], ['midS', 'hSW'], ['midS', 'hSE'],
    ['hNW', 'hNE'], ['hSW', 'hSE'], ['hNW', 'hSW'], ['hNE', 'hSE'],
    ['hNW', 'midW'], ['hSW', 'midW'], ['hNE', 'midE'], ['hSE', 'midE'],
  ], { minX: -32, maxX: 32, minZ: -22, maxZ: 22 })
}

// ============================================================
// TWIN VILLAS — two facing multi-storey villas, one per side (Task 153)
//   user: "there are 2 Multi-story building In front of each other. each
//   one for each side. players can shot each other through windows. also
//   players can go basement and go to other building. there is no bomb in
//   this map."
//   West villa = CT home, east villa = T home — the east copy is the west
//   build rotated 180° about Y, so both street facades (and every window
//   lane) stay perfectly aligned across the 16 m street. L0 windows
//   (sill 1.0, opening 1.0..2.6) control the street; L1/L2 windows duel
//   each other through the aligned openings (floor+1.0..+2.6 — stand and
//   shoot, crouch-vault through). Ground double doors open onto the
//   street; a switchback stair core (0.243 risers) climbs L0->L1->L2;
//   each villa has a basement, and a 4 m tunnel under the street joins
//   them (the safe rotate). bomb:false — elimination-only rounds.
// ============================================================
function buildTwin(): MapDef {
  const { boxes, box } = newBuilder()

  // One villa emitted in the WEST frame; the east villa is the same build
  // rotated 180° about Y (mx=mz=-1 flips every box center).
  const villa = (mx: 1 | -1, mz: 1 | -1) => {
    const B = (x: number, z: number, w: number, d: number, h: number, tex: Box['tex'], y0 = 0) =>
      box(x * mx, z * mz, w, d, h, tex, y0)
    // straight flight along Z: n = ceil(rise/0.25) risers climbing from
    // yBase at zFrom to yBase+rise at zTo (either direction; solid riser
    // masses like the dust stairs)
    const flightZ = (xc: number, w: number, zFrom: number, zTo: number, yBase: number, rise: number, tex: Box['tex']) => {
      const n = Math.ceil(rise / 0.25)
      for (let i = 0; i < n; i++) {
        const z0 = zFrom + ((zTo - zFrom) * i) / n, z1 = zFrom + ((zTo - zFrom) * (i + 1)) / n
        B(xc, (z0 + z1) / 2, w, Math.abs(z1 - z0), (rise * (i + 1)) / n, tex, yBase)
      }
    }
    // straight flight along X (the basement descent in the south room)
    const flightX = (zc: number, d: number, xFrom: number, xTo: number, yBase: number, rise: number, tex: Box['tex']) => {
      const n = Math.ceil(rise / 0.25)
      for (let i = 0; i < n; i++) {
        const x0 = xFrom + ((xTo - xFrom) * i) / n, x1 = xFrom + ((xTo - xFrom) * (i + 1)) / n
        B((x0 + x1) / 2, zc, Math.abs(x1 - x0), d, (rise * (i + 1)) / n, tex, yBase)
      }
    }

    // ---- shell (basement -3.5 .. roofline 10.2) ----
    B(-27.55, 0, 0.9, 40, 13.7, 'wall', -3.5)       // back wall
    B(-18, -19.55, 18.2, 0.9, 13.7, 'wall', -3.5)   // north wall
    B(-18, 19.55, 18.2, 0.9, 13.7, 'wall', -3.5)    // south wall

    // ---- street facade (x -8.9..-8, center -8.45) ----
    // ground floor: double door (z -2..2) + 2 windows (z +/-12); piers run
    // down to the basement, under-window bands seal below the sills
    for (const [zc, d] of [[-16.625, 6.75], [-6.375, 8.75], [6.375, 8.75], [16.625, 6.75]] as const)
      B(-8.45, zc, 0.9, d, 13.4, 'wall', -3.5)
    for (const zw of [-12, 12]) {
      B(-8.45, zw, 0.9, 2.5, 1.0, 'concrete', 0)     // sill y 0..1.0
      B(-8.45, zw, 0.9, 2.5, 0.5, 'concrete', 2.6)   // lintel y 2.6..3.1
      B(-8.45, zw, 0.9, 2.5, 3.5, 'wall', -3.5)      // basement band below the sill
    }
    B(-8.45, 0, 0.9, 4, 0.5, 'concrete', 2.6)       // door lintel (opening 0..2.4)
    B(-8.45, 0, 0.9, 4, 0.3, 'wall', -0.3)          // threshold over the tunnel mouth
    B(-8.45, -1.4, 0.3, 1.2, 2.4, 'doorBlue', 0)    // door panels, slid to the jambs
    B(-8.45, 1.4, 0.3, 1.2, 2.4, 'doorBlue', 0)
    // upper floors: 3 windows each (z -12 / 0 / +12), opening floor+1.0..+2.6
    for (const [y0, lh] of [[3.4, 6.0], [6.8, 9.4]] as const) {
      for (const [zc, d] of [[-16.625, 6.75], [-6, 9.5], [6, 9.5], [16.625, 6.75]] as const)
        B(-8.45, zc, 0.9, d, 3.1, 'wall', y0)
      for (const zw of [-12, 0, 12]) {
        B(-8.45, zw, 0.9, 2.5, 1.0, 'concrete', y0)  // sill
        B(-8.45, zw, 0.9, 2.5, 0.5, 'concrete', lh)  // lintel
      }
    }
    B(-8.45, 0, 0.9, 40, 0.3, 'wall', 9.9)          // parapet band (flush with roof slab)

    // ---- floor slabs ----
    B(-18, -3.55, 18.2, 31.1, 0.3, 'plank', -0.3)   // L0 north of the basement-stair hole
    B(-18, 17.55, 18.2, 3.1, 0.3, 'plank', -0.3)    // L0 south of it
    B(-24.6, 14, 5, 4, 0.3, 'plank', -0.3)          // L0 west of the hole
    B(-11.5, 14, 5.2, 4, 0.3, 'plank', -0.3)        // L0 east of the hole
    B(-14, 0, 10.2, 38.2, 0.3, 'plank', 3.1)        // L1 (top 3.4)
    B(-14, 0, 10.2, 38.2, 0.3, 'plank', 6.5)        // L2 (top 6.8)
    B(-14, 0, 10.2, 38.2, 0.3, 'concrete', 9.9)     // roof (top 10.2)
    B(-18, 0, 18.2, 38.2, 0.3, 'dark', -3.5)        // basement floor (top -3.2)

    // ---- switchback stair core (back-west, z -6..6) ----
    flightZ(-25.1, 4, 4, -4, 0, 3.4, 'plank')        // flight A: L0 -> L1 (climbs north)
    B(-23.1, -5, 8, 2, 3.4, 'wall', 0)              // north landing (top 3.4)
    flightZ(-21.1, 4, -4, 4, 3.4, 3.4, 'plank')     // flight B: L1 -> L2 (climbs south, over the hall)
    B(-23.1, 5, 8, 2, 6.8, 'wall', 0)               // south landing (top 6.8)
    flightX(14, 4, -22.1, -14.1, -3.2, 3.2, 'plank')// flight C: basement -> L0 south room

    // ---- L0 partitions (window rooms vs stair/entry halls, gap x -21..-18) ----
    B(-24.05, -6.45, 6.1, 0.9, 3.1, 'wall', 0)
    B(-13.45, -6.45, 9.1, 0.9, 3.1, 'wall', 0)
    B(-19.5, -6.45, 3, 0.9, 0.5, 'wall', 2.6)       // gap lintel
    B(-24.05, 6.45, 6.1, 0.9, 3.1, 'wall', 0)
    B(-13.45, 6.45, 9.1, 0.9, 3.1, 'wall', 0)
    B(-19.5, 6.45, 3, 0.9, 0.5, 'wall', 2.6)

    // ---- basement pillars ----
    for (const [px, pz] of [[-24, -12], [-16, -12], [-24, -4], [-16, -4]] as const)
      B(px, pz, 0.9, 0.9, 2.9, 'brick', -3.2)

    // ---- props ----
    B(-12.5, -14.5, 1.8, 1.8, 1.8, 'crate')         // L0 north window room
    B(-24, -16, 2, 2, 2, 'crate')
    B(-25, 6.5, 1.8, 1.8, 1.8, 'crate')             // L0 south window room
    B(-11, 17.5, 2, 2, 2, 'crate')
    B(-10.5, -4.5, 1.6, 1.6, 1.6, 'crate')          // entry hall
    B(-12, -14.5, 1.8, 1.8, 1.8, 'crate', 3.4)      // L1 loft
    B(-12, 14.5, 1.8, 1.8, 1.8, 'crate', 3.4)
    B(-17.5, 2, 1.6, 1.6, 1.6, 'crate', 3.4)
    B(-12, -14.5, 1.8, 1.8, 1.8, 'crate', 6.8)      // L2 loft
    B(-12, 14.5, 1.8, 1.8, 1.8, 'crate', 6.8)
    B(-17.5, 6, 1.6, 1.6, 1.6, 'crate', 6.8)
    B(-12, -14, 1.8, 1.8, 1.8, 'crate', -3.2)       // basement
    B(-22.5, 18, 2, 2, 2, 'crate', -3.2)
    B(-11.5, 6.5, 1.6, 1.6, 1.6, 'crate', -3.2)
  }
  villa(1, 1)    // west villa (CT)
  villa(-1, -1)  // east villa (T) — same build rotated 180°

  // ---- shared: street canyon + the tunnel beneath it ----
  box(0, -19.55, 16, 0.9, 13.7, 'wall', -3.5)       // street north end wall
  box(0, 19.55, 16, 0.9, 13.7, 'wall', -3.5)        // street south end wall
  box(0, 0, 16, 40, 0.3, 'dark', -0.3)              // street surface (doubles as tunnel ceiling)
  box(0, 0, 17.8, 5.8, 0.3, 'dark', -3.5)           // tunnel floor (top -3.2)
  box(0, -2.45, 17.8, 0.9, 2.9, 'dark', -3.2)       // tunnel wall north
  box(0, 2.45, 17.8, 0.9, 2.9, 'dark', -3.2)        // tunnel wall south
  box(0, -18, 1.8, 1.8, 1.8, 'crate')               // street cover, north end
  box(0, 18, 1.8, 1.8, 1.8, 'crate')                // street cover, south end
  box(-2.5, -2.5, 1.6, 1.6, 1.6, 'crate')           // street cover, mid (off the bot lines)
  box(2.5, 2.5, 1.6, 1.6, 1.6, 'crate')

  // ---- waypoints: the west set mirrored to the east (tspawn = east spawn) ----
  const W: Array<[string, number, number, number]> = [
    ['ctspawn', -14, 0, 0], ['hall', -11, 0, 0], ['door', -8.45, 0, 0], ['stair', -21, 0, 0],
    ['strS', -21, 3.4, 0], ['strSE', -18.5, 3.4, 0],
    ['chan', -18.55, 5.5, 0], ['chanS', -18.55, 7.5, 0],
    ['chanN', -18.55, -5.5, 0], ['chanNs', -18.55, -7.5, 0],
    ['gapN', -19.5, -7.5, 0], ['gapS', -19.5, 7.5, 0],
    ['nMid', -18, -12, 0], ['nWin', -10.5, -12, 0], ['cornerN', -24, -12, 0],
    ['sMid', -18, 9, 0], ['sWin', -11, 12, 0], ['cornerS', -24, 9, 0],
    ['cTop', -12.5, 14, 0], ['c1', -16.25, 14, -0.74], ['c2', -18.7, 14, -1.72], ['cBot', -23.5, 14, -3.2],
    ['baseS', -20, 10, -3.2], ['baseM', -16, 2, -3.2], ['baseN', -20, -8, -3.2], ['tunW', -11, 0, -3.2],
    ['aEn', -25.1, 3.6, 0.25], ['a0', -25.1, 2.57, 0.73], ['a1', -25.1, 0.86, 1.46],
    ['a2', -25.1, -0.86, 2.19], ['a3', -25.1, -2.57, 2.92], ['landN', -23.1, -5, 3.4],
    ['b0', -21.1, -2.57, 4.12], ['b1', -21.1, -0.86, 4.86], ['b2', -21.1, 0.85, 5.59],
    ['b3', -21.1, 2.57, 6.32], ['landS', -23.1, 5, 6.8],
    ['l1h', -15, 0, 3.4], ['l1w', -17, -5, 3.4], ['l1n', -15, -12, 3.4], ['l1s', -15, 12, 3.4],
    ['l1nw', -10.5, -12, 3.4], ['l1mw', -10.5, 0, 3.4], ['l1sw', -10.5, 12, 3.4],
    ['l2h', -15, 0, 6.8], ['l2n', -15, -12, 6.8], ['l2s', -15, 12, 6.8],
    ['l2nw', -10.5, -12, 6.8], ['l2mw', -10.5, 0, 6.8], ['l2sw', -10.5, 12, 6.8],
  ]
  const waypoints: WP[] = []
  for (const [id, x, z, y] of W) waypoints.push({ id: 'w' + id, x, y, z })
  for (const [id, x, z, y] of W) waypoints.push({ id: id === 'ctspawn' ? 'tspawn' : 'e' + id, x: -x, y, z: -z })
  waypoints.push(
    { id: 'stW', x: -5, y: 0, z: 0 }, { id: 'stC', x: 0, y: 0, z: 0 }, { id: 'stE', x: 5, y: 0, z: 0 },
    { id: 'stWN', x: -5, y: 0, z: -12 }, { id: 'stEN', x: 5, y: 0, z: -12 },
    { id: 'stWS', x: -5, y: 0, z: 12 }, { id: 'stES', x: 5, y: 0, z: 12 },
    { id: 'stN', x: 0, y: 0, z: -16 }, { id: 'stS', x: 0, y: 0, z: 16 },
    { id: 'tW', x: -4, y: -3.2, z: 0 }, { id: 'tE', x: 4, y: -3.2, z: 0 },
  )
  // west edges on short ids; the east set is the 180° mirror
  const WE: Array<[string, string]> = [
    ['ctspawn', 'hall'], ['hall', 'door'], ['hall', 'stair'], ['stair', 'ctspawn'],
    ['stair', 'strS'], ['strS', 'aEn'], ['strS', 'strSE'], ['strSE', 'chan'],
    ['chan', 'chanS'], ['chanS', 'gapS'], ['strSE', 'chanN'], ['chanN', 'chanNs'],
    ['chanNs', 'gapN'], ['strSE', 'hall'], ['chanS', 'sMid'], ['chanNs', 'nMid'],
    ['gapN', 'nMid'], ['gapN', 'cornerN'], ['nMid', 'nWin'],
    ['gapS', 'sMid'], ['gapS', 'cornerS'], ['sMid', 'sWin'], ['sMid', 'cTop'], ['sWin', 'cTop'],
    ['cTop', 'c1'], ['c1', 'c2'], ['c2', 'cBot'], ['cBot', 'baseS'], ['baseS', 'baseM'],
    ['baseM', 'baseN'], ['baseM', 'tunW'],
    ['aEn', 'a0'], ['a0', 'a1'], ['a1', 'a2'], ['a2', 'a3'], ['a3', 'landN'],
    ['landN', 'b0'], ['b0', 'b1'], ['b1', 'b2'], ['b2', 'b3'], ['b3', 'landS'],
    ['landN', 'l1w'], ['l1w', 'l1h'], ['landS', 'l2h'],
    ['l1h', 'l1n'], ['l1h', 'l1s'], ['l1h', 'l1mw'], ['l1n', 'l1nw'], ['l1s', 'l1sw'], ['l1n', 'l1s'],
    ['l2h', 'l2n'], ['l2h', 'l2s'], ['l2h', 'l2mw'], ['l2n', 'l2nw'], ['l2s', 'l2sw'], ['l2n', 'l2s'],
  ]
  const ed: Array<[string, string]> = []
  for (const [a, b] of WE) ed.push(['w' + a, 'w' + b])
  for (const [a, b] of WE) {
    const A = a === 'ctspawn' ? 'tspawn' : 'e' + a
    const B2 = b === 'ctspawn' ? 'tspawn' : 'e' + b
    ed.push([A, B2])
  }
  ed.push(
    ['wdoor', 'stW'], ['edoor', 'stE'], ['stW', 'stC'], ['stC', 'stE'],
    ['stW', 'stWN'], ['stWN', 'stEN'], ['stEN', 'stE'], ['stW', 'stWS'], ['stWS', 'stES'], ['stES', 'stE'],
    ['stWN', 'stN'], ['stN', 'stC'], ['stS', 'stC'], ['stWS', 'stS'],
    ['wtunW', 'tW'], ['tW', 'tE'], ['tE', 'etunW'],
  )

  return {
    ...finishMap('twin', 'Twin Villas', 1, { boxes, box } as Builder, {
      CT: [
        { x: -16, y: 0, z: -3 }, { x: -16, y: 0, z: 3 }, { x: -12, y: 0, z: -3 },
        { x: -12, y: 0, z: 3 }, { x: -14, y: 0, z: 0 },
      ],
      T: [
        { x: 16, y: 0, z: 3 }, { x: 16, y: 0, z: -3 }, { x: 12, y: 0, z: 3 },
        { x: 12, y: 0, z: -3 }, { x: 14, y: 0, z: 0 },
      ],
    }, {
      // no-bomb map: sites are strategic anchors only (bots push/hold these)
      A: { x: -14, z: 0, r: 6, y: 0 },
      B: { x: 14, z: 0, r: 6, y: 0 },
    }, waypoints, ed, { minX: -28, maxX: 28, minZ: -20, maxZ: 20 }),
    // CTs (west villa) face east across the street; Ts (east villa) face west
    spawnYaw: { CT: -Math.PI / 2, T: Math.PI / 2 },
  }
}

// ============================================================
// registry
// ============================================================
import { AIMHEAD } from './map-aimhead'
import { ISLAND } from './map-island'

export const MAPS: Record<MapId, MapDef> = {
  dust: buildDust(),
  dust2: buildDust2(),
  aimhead: { ...AIMHEAD, bomb: false },   // aim map — pure aim duels, no bomb objective
  aimdepot: { ...buildAimDepot(), bomb: false },   // aim map — crate-yard arena, no bomb objective
  island: { ...ISLAND },   // Task 131: tropical island — bomb defusal (A radar / B dock)
  twin: { ...buildTwin(), bomb: false },   // Task 153: two facing villas — window duels + basement tunnel, elimination-only
}

export const MAP_LIST: Array<{ id: MapId; name: string; desc: string }> = [
  { id: 'dust', name: 'Dust', desc: 'The original three-lane classic layout' },
  { id: 'dust2', name: 'Dust II', desc: 'Long, mid, tunnels · catwalk · pit · window room' },
  { id: 'aimhead', name: 'Aim Headshot', desc: 'CS 1.6 BSP import · slit-wall aim arena' },
  { id: 'aimdepot', name: 'Aim Depot', desc: 'Crate-yard aim arena · low lane walls · moonlit night' },
  { id: 'island', name: 'Island', desc: 'Tropical island · day · bomb defusal · radar A / dock B' },
  { id: 'twin', name: 'Twin Villas', desc: 'Two facing villas · window duels · basement tunnel · no bomb' },
]
