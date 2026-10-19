// ============================================================
// Seeded deterministic pellet fan (Phase 6: multi-pellet ballistics)
// ============================================================
// One pattern, three consumers, all reading the SAME numbers:
//  * CLIENT prediction — the shooter samples the fan, raycasts each pellet
//    (tracers + hit claims) and sends {seed, dir} with the 'shoot' event.
//  * REMOTE clients — the server relays the seed in the 'shot' broadcast so
//    everyone renders the IDENTICAL tracer fan (no resampling drift).
//  * SERVER validation — the shot's seeded cone bounds which victims a
//    pellet-hit claim can credit (cone + count + LOS gates in index.ts).
//
// Determinism contract: mulberry32 uses only uint32 ops + one float divide,
// so client (browser V8) and server (bun/jsc) produce bit-identical streams.
// NEVER touch the arithmetic here without bumping the pattern version —
// old seeds would silently map to different cones.

export interface PelletDir { x: number; y: number; z: number }

/** mulberry32 — 32-bit seeded PRNG, stable across JS runtimes. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Sample `count` pellet unit-vectors fanned around the aim direction.
 *
 * Geometry rules (match the engine's existing spread model):
 *  - pellet 0 rides the bore: EXACTLY the aim direction (CS shotguns always
 *    send one pellet down the center — reward precise aim)
 *  - the remaining pellets fill the cone with a sqrt() radial distribution
 *    (uniform over the disc, not bunched at the rim) out to `spreadDeg`
 *    half-angle, in a plane basis orthogonal to the aim direction
 *
 * @param seed     uint32 client seed (sent with 'shoot')
 * @param count    pellet count (w.pellets)
 * @param spreadDeg cone half-angle, degrees (w.pelletSpread)
 * @param aim      aim direction (unit vector; need not be perfectly normalized)
 */
export function pelletDirs(seed: number, count: number, spreadDeg: number, aim: PelletDir): PelletDir[] {
  const rand = mulberry32(seed)
  // normalize aim
  const al = Math.hypot(aim.x, aim.y, aim.z) || 1
  const ax = aim.x / al, ay = aim.y / al, az = aim.z / al
  // orthonormal basis (right, up) — pick the least-aligned world axis for stability
  const wx = Math.abs(ax) < 0.9 ? 0 : 1, wy = Math.abs(ax) < 0.9 ? 1 : 0
  // right = normalize(world × aim)
  let rx = wy * az - 0 * ay, ry = 0 * ax - wx * az, rz = wx * ay - wy * ax
  const rl = Math.hypot(rx, ry, rz) || 1
  rx /= rl; ry /= rl; rz /= rl
  // up = right × aim
  const ux = ry * az - rz * ay, uy = rz * ax - rx * az, uz = rx * ay - ry * ax

  const out: PelletDir[] = [{ x: ax, y: ay, z: az }]
  for (let i = 1; i < count; i++) {
    const ang = (spreadDeg * Math.sqrt(rand())) * (Math.PI / 180)
    const theta = rand() * Math.PI * 2
    const tan = Math.tan(ang)
    const ox = tan * Math.cos(theta), oy = tan * Math.sin(theta)
    let dx = ax + rx * ox + ux * oy
    let dy = ay + ry * ox + uy * oy
    let dz = az + rz * ox + uz * oy
    const dl = Math.hypot(dx, dy, dz) || 1
    dx /= dl; dy /= dl; dz /= dl
    out.push({ x: dx, y: dy, z: dz })
  }
  return out
}

/** Angle between two vectors, degrees — server-side cone validation helper. */
export function angleDeg(a: PelletDir, b: PelletDir): number {
  const al = Math.hypot(a.x, a.y, a.z) || 1
  const bl = Math.hypot(b.x, b.y, b.z) || 1
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (al * bl)
  return Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI)
}
