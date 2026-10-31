// scripts/island/hill-climb-probe-t145.ts — user report: "in island there
// some problems when climbing the hill". Three measurements:
//
//  A. STATIC climb-line profile — 16 radial lines onto the A-hill (14,20):
//     visible terrain (height()) vs the collider top actually underfoot
//     (point-in-box over shipped colBoxes). Reports per-line max sink
//     (visible - colliderTop = how deep the camera is inside the ground)
//     and any UNCLIMBABLE step (consecutive collider tops rising > 0.95,
//     the stair step-up limit in engine.ts).
//
//  B. DYNAMIC faithful client sim — replicates engine.ts movePlayer
//     collision EXACTLY (X/Z resolve + step-up + landing Y-sweep, same
//     constants PLAYER_R .4 / STAND_H 1.8 / GRAVITY 22 / STEP_UP .55 /
//     STAIR_CLIMB .95, same array-order iteration) against the SHIPPED
//     src/game/map-island-data.json. Walks up from a 34 m ring at 16
//     angles (ak47 moveSpeed 4.35) and back DOWN from the pad. Metrics:
//     reached?, un-steppable push-outs (invisible wall), stuck seconds,
//     max sink/float vs visible terrain, per-tick |dy| spikes (launch),
//     fall-through.
//
//  C. SERVER bot groundFollow sim — Task 144 groundAt()/groundFollow()
//     (highest box top <= feet+1.25, 50%/tick ease) walked up the same
//     lines at 10 Hz (BOT_MS=100): max vertical speed, hover above the
//     visible terrain (flying up the hill), sink below it.
//
// Run: bun scripts/island/hill-climb-probe-t145.ts
import { readFileSync } from 'fs'
import { height } from './gen'   // side effect: deterministic regen (byte-identical)

const HILL = { x: 14, z: 20 }
const PAD_R = 6.5          // "on the pad" when this close to hill centre
const RING = 34            // climb start ring (base of the hill)
const SPD = 4.35           // ak47 moveSpeed
const ANGLES = 16

type JBox = { x: number; y: number; z: number; w: number; h: number; d: number; stair?: boolean }
const data = JSON.parse(readFileSync('src/game/map-island-data.json', 'utf8')) as { boxes: JBox[] }
const boxes: JBox[] = data.boxes

// ---------------------------------------------------------------- collider index
interface Col { x: number; z: number; minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number; stair: boolean; tex: string; idx: number }
const cols: Col[] = boxes.map((b, i) => ({
  x: b.x, z: b.z,
  minx: b.x - b.w / 2, maxx: b.x + b.w / 2,
  miny: b.y - b.h / 2, maxy: b.y + b.h / 2,
  minz: b.z - b.d / 2, maxz: b.z + b.d / 2,
  stair: !!b.stair, tex: (b as { tex?: string }).tex ?? '?', idx: i,
}))
const CELL = 2.5
const grid = new Map<string, Col[]>()
for (const c of cols) {
  for (let cx = Math.floor(c.minx / CELL); cx <= Math.floor(c.maxx / CELL); cx++)
    for (let cz = Math.floor(c.minz / CELL); cz <= Math.floor(c.maxz / CELL); cz++) {
      const k = cx + ',' + cz
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k)!.push(c)
    }
}
// candidates whose XZ AABB overlaps [x0,x1]x[z0,z1], in shipped array order
function gather(x0: number, z0: number, x1: number, z1: number): Col[] {
  const out: Col[] = []
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++)
      for (const c of grid.get(cx + ',' + cz) ?? []) out.push(c)
  out.sort((a, b) => a.idx - b.idx)
  return out
}

// ---------------------------------------------------------------- A. static profile
console.log('== A. STATIC climb-line profile (visible terrain vs collider top underfoot) ==')
let anyBlockedStep = false
const sinkStats: number[] = []
for (let a = 0; a < ANGLES; a++) {
  const ang = (a / ANGLES) * Math.PI * 2
  const dx = Math.cos(ang), dz = Math.sin(ang)
  let prevTop: number | null = null
  let maxSink = 0, maxStep = 0, blockedStep = 0
  let worstSinkAt = ''
  for (let r = RING; r >= PAD_R; r -= 0.25) {
    const x = HILL.x + dx * r, z = HILL.z + dz * r
    const vis = height(x, z)
    let top: number | null = null
    for (const c of gather(x, z, x, z)) {
      if (x >= c.minx && x <= c.maxx && z >= c.minz && z <= c.maxz) {
        if (top === null || c.maxy > top) top = c.maxy
      }
    }
    if (top !== null) {
      const sink = vis - top
      if (sink > maxSink) { maxSink = sink; worstSinkAt = `r=${r.toFixed(1)} vis=${vis.toFixed(2)} top=${top.toFixed(2)}` }
      if (prevTop !== null) {
        const step = top - prevTop
        if (step > maxStep) maxStep = step
        if (step > 0.95) blockedStep++
      }
      prevTop = top
    }
    sinkStats.push(maxSink)
  }
  if (blockedStep > 0) anyBlockedStep = true
  console.log(`  ang ${a.toString().padStart(2)} (${dx.toFixed(2)},${dz.toFixed(2)}): maxSink ${maxSink.toFixed(2)}m @ ${worstSinkAt}  maxStep ${maxStep.toFixed(2)}m  blockedSteps(>0.95) ${blockedStep}`)
}
console.log(`  => ${anyBlockedStep ? '!! UNCLIMBABLE steps present' : 'no unclimbable steps (all <= 0.95 stair limit)'}`)

// ---------------------------------------------------------------- B. faithful client sim
const PLAYER_R = 0.4, STAND_H = 1.8, GRAVITY = 22, STEP_UP = 0.55, STAIR_CLIMB = 0.95
const DT = 1 / 60

interface SimState { x: number; y: number; z: number; vx: number; vy: number; vz: number; onGround: boolean }

function overlapsAt(s: SimState, x: number, y: number, z: number): boolean {
  for (const c of gather(x - PLAYER_R, z - PLAYER_R, x + PLAYER_R, z + PLAYER_R)) {
    if (x + PLAYER_R > c.minx && x - PLAYER_R < c.maxx && y + STAND_H > c.miny && y < c.maxy &&
      z + PLAYER_R > c.minz && z - PLAYER_R < c.maxz) return true
  }
  return false
}

// Task 145 fix replica: stair cells <= target+0.95 are not blockers
function stairClearAt(x: number, y: number, z: number): boolean {
  for (const c of gather(x - PLAYER_R, z - PLAYER_R, x + PLAYER_R, z + PLAYER_R)) {
    if (x + PLAYER_R > c.minx && x - PLAYER_R < c.maxx && y + STAND_H > c.miny && y < c.maxy &&
      z + PLAYER_R > c.minz && z - PLAYER_R < c.maxz) {
      if (c.stair && c.maxy <= y + STAIR_CLIMB) continue
      return true
    }
  }
  return false
}

function resolveHorizontal(s: SimState, axis: 'x' | 'z', stats: { pushOuts: number; unsteppable: number; worstUnstep: number; worstUnstepVis: number; worstAt: string }, blockers: Map<string, { n: number; c: Col; rise: number; vis: number; why: string; deniedBy: string }>) {
  for (const c of gather(s.x - PLAYER_R, s.z - PLAYER_R, s.x + PLAYER_R, s.z + PLAYER_R)) {
    const feet = s.y
    if (s.x + PLAYER_R > c.minx && s.x - PLAYER_R < c.maxx && feet + STAND_H > c.miny && feet < c.maxy &&
      s.z + PLAYER_R > c.minz && s.z - PLAYER_R < c.maxz) {
      const rise = c.maxy - s.y
      if (rise <= 0.01) continue
      const stepLim = c.stair ? STAIR_CLIMB : STEP_UP
      let why = ''
      let deniedBy = ''
      if (rise <= stepLim && s.vy <= 0.1) {
        const blocked = c.stair
          ? stairClearAt(s.x, c.maxy + 0.02, s.z)
          : overlapsAt(s, s.x, c.maxy + 0.02, s.z)
        if (!blocked) {
          s.y = c.maxy + 0.02
          s.onGround = true
          continue
        }
        why = 'stepup-denied-overlap'
        // forensics: WHICH box overlaps the step-up target height?
        for (const o of gather(s.x - PLAYER_R, s.z - PLAYER_R, s.x + PLAYER_R, s.z + PLAYER_R)) {
          if (s.x + PLAYER_R > o.minx && s.x - PLAYER_R < o.maxx && c.maxy + 0.02 + STAND_H > o.miny && c.maxy + 0.02 < o.maxy && s.z + PLAYER_R > o.minz && s.z - PLAYER_R < o.maxz) {
            deniedBy = `deniedBy box[${o.minx.toFixed(1)}..${o.maxx.toFixed(1)}]x[${o.minz.toFixed(1)}..${o.maxz.toFixed(1)}] top=${o.maxy.toFixed(2)}${o.stair ? ' STAIR' : ' PROP'} dx=${(s.x - Math.max(o.minx - PLAYER_R, Math.min(o.maxx + PLAYER_R, s.x))).toFixed(2)}`
            break
          }
        }
      } else if (rise > stepLim) why = `rise${rise > stepLim ? '>lim' : ''}${s.vy > 0.1 ? '+vy' : ''}`
      else why = 'vy>0.1'
      // blocked push-out
      stats.pushOuts++
      if (rise > stepLim) {
        stats.unsteppable++
        const vis = height(s.x, s.z)
        if (rise > stats.worstUnstep) {
          stats.worstUnstep = rise
          stats.worstUnstepVis = rise - (vis > 0 ? vis - s.y : 0)
          stats.worstAt = `(${s.x.toFixed(1)}, ${s.z.toFixed(1)}) rise=${rise.toFixed(2)} vis=${vis.toFixed(2)}`
        }
      }
      const k = `${c.minx.toFixed(1)},${c.minz.toFixed(1)},${c.w_ ?? ''}${c.stair ? 's' : 'p'}${c.maxy.toFixed(1)}`
      const e = blockers.get(k)
      if (e) e.n++
      else blockers.set(k, { n: 1, c, rise, vis: height(s.x, s.z), why, deniedBy })
      if (axis === 'x') {
        s.x = s.x > c.x ? c.maxx + PLAYER_R + 0.001 : c.minx - PLAYER_R - 0.001
        s.vx = 0
      } else {
        s.z = s.z > c.z ? c.maxz + PLAYER_R + 0.001 : c.minz - PLAYER_R - 0.001
        s.vz = 0
      }
    }
  }
}

interface RouteStats {
  reached: boolean; time: number; stuckSec: number; pushOuts: number; unsteppable: number
  worstUnstep: number; worstAt: string; worstUnstepVis: number
  maxSink: number; maxFloat: number; launches: number; fallThrough: boolean; maxDy: number
  failsafes?: number; endX?: number; endZ?: number
}

function simRoute(sx: number, sz: number, tx: number, tz: number, stopR: number, maxSec: number, blockers?: Map<string, { n: number; c: Col; rise: number; vis: number; why: string }>): RouteStats {
  const s: SimState = { x: sx, y: height(sx, sz) - 0.22 + 0.5, z: sz, vx: 0, vy: 0, vz: 0, onGround: false }
  const st: RouteStats = {
    reached: false, time: 0, stuckSec: 0, pushOuts: 0, unsteppable: 0, worstUnstep: 0, worstAt: '', worstUnstepVis: 0,
    maxSink: 0, maxFloat: 0, launches: 0, fallThrough: false, maxDy: 0,
  }
  const hs: { pushOuts: number; unsteppable: number; worstUnstep: number; worstUnstepVis: number; worstAt: string } = { pushOuts: 0, unsteppable: 0, worstUnstep: 0, worstUnstepVis: 0, worstAt: '' }
  // settle onto the ground first
  for (let i = 0; i < 120; i++) {
    s.vy -= GRAVITY * DT
    const prevFeet = s.y
    s.y += s.vy * DT
    s.onGround = false
    let landY: number | null = null
    for (const c of gather(s.x - PLAYER_R, s.z - PLAYER_R, s.x + PLAYER_R, s.z + PLAYER_R)) {
      if (s.x + PLAYER_R > c.minx && s.x - PLAYER_R < c.maxx && s.y + STAND_H > c.miny && s.y < c.maxy + Math.max(0, prevFeet - s.y) && s.z + PLAYER_R > c.minz && s.z - PLAYER_R < c.maxz) {
        if (s.vy <= 0.01 && (s.y > c.maxy - 0.3 || prevFeet >= c.maxy - 0.001)) landY = landY === null ? c.maxy : Math.max(landY, c.maxy)
      }
    }
    if (landY !== null) { s.y = landY; s.vy = 0; s.onGround = true }
  }
  const dx = tx - sx, dz = tz - sz
  const len = Math.hypot(dx, dz)
  const wx = (dx / len) * SPD, wz = (dz / len) * SPD
  let windowStart = 0, windowDist = 0, windowT = 0
  let lastX = s.x, lastZ = s.z
  const ticks = Math.ceil(maxSec / DT)
  for (let t = 0; t < ticks; t++) {
    st.time = t * DT
    // steer straight at target
    const acc = s.onGround ? 12 : 2.2
    s.vx += (wx - s.vx) * Math.min(1, acc * DT)
    s.vz += (wz - s.vz) * Math.min(1, acc * DT)
    s.vy -= GRAVITY * DT
    if (s.vy < -35) s.vy = -35
    s.x += s.vx * DT
    resolveHorizontal(s, 'x', hs, blockers ?? new Map())
    s.z += s.vz * DT
    resolveHorizontal(s, 'z', hs, blockers ?? new Map())
    const prevFeet = s.y
    s.y += s.vy * DT
    s.onGround = false
    let landY: number | null = null
    let ceilY: number | null = null
    for (const c of gather(s.x - PLAYER_R, s.z - PLAYER_R, s.x + PLAYER_R, s.z + PLAYER_R)) {
      const feet = s.y
      if (s.x + PLAYER_R > c.minx && s.x - PLAYER_R < c.maxx && feet + STAND_H > c.miny && feet < c.maxy + Math.max(0, prevFeet - feet) && s.z + PLAYER_R > c.minz && s.z - PLAYER_R < c.maxz) {
        if (s.vy <= 0.01 && (feet > c.maxy - 0.3 || prevFeet >= c.maxy - 0.001)) landY = landY === null ? c.maxy : Math.max(landY, c.maxy)
        else if (s.vy > 0 && feet + STAND_H > c.miny && prevFeet + STAND_H <= c.miny + 0.001) ceilY = ceilY === null ? c.miny : Math.min(ceilY, c.miny)
      }
    }
    const wasGrounded = true   // resolveHorizontal may have set onGround
    if (landY !== null) { s.y = landY; s.vy = 0; s.onGround = true }
    else if (ceilY !== null) { s.y = ceilY - STAND_H - 0.001; s.vy = 0 }
    // engine failsafe: y < -6 yanks to this map's CT spawn
    if (s.y < -6) {
      const cts = (JSON.parse(readFileSync('src/game/map-island-data.json', 'utf8')) as { spawns: { CT: Array<{ x: number; y: number; z: number }> } }).spawns.CT[0]
      s.x = cts.x; s.y = cts.y + 0.1; s.z = cts.z; s.vx = 0; s.vy = 0; s.vz = 0
      st.failsafes = (st.failsafes ?? 0) + 1
    }
    // metrics
    const vis = height(s.x, s.z)
    const sink = vis - s.y
    if (sink > st.maxSink && vis > 0.5) st.maxSink = sink
    if (-sink > st.maxFloat && vis > 0.5) st.maxFloat = -sink
    if (s.y < vis - 1.2 && vis > 0.5) st.fallThrough = true
    const dy = s.y - prevFeet
    if (Math.abs(dy) > st.maxDy) st.maxDy = Math.abs(dy)
    if (Math.abs(dy) > 0.5 && s.onGround) st.launches++
    // stuck detection (rolling 1s windows)
    windowT += DT
    windowDist += Math.hypot(s.x - lastX, s.z - lastZ)
    lastX = s.x; lastZ = s.z
    if (windowT >= 1) {
      if (windowDist < 0.5) st.stuckSec += 1
      windowT = 0; windowDist = 0
    }
    if (Math.hypot(s.x - tx, s.z - tz) <= stopR) { st.reached = true; break }
  }
  st.pushOuts = hs.pushOuts; st.unsteppable = hs.unsteppable; st.worstUnstep = hs.worstUnstep
  st.worstAt = hs.worstAt; st.worstUnstepVis = hs.worstUnstepVis
  st.endX = s.x; st.endZ = s.z
  return st
}

console.log('\n== B. CLIENT sim — climb UP from ring 34m (ak47 walk, dt 1/60) ==')
let fails = 0
for (let a = 0; a < ANGLES; a++) {
  const ang = (a / ANGLES) * Math.PI * 2
  const sx = HILL.x + Math.cos(ang) * RING, sz = HILL.z + Math.sin(ang) * RING
  const blockers = new Map<string, { n: number; c: Col; rise: number; vis: number; why: string; deniedBy: string }>()
  const r = simRoute(sx, sz, HILL.x, HILL.z, PAD_R, 60, blockers)
  if (!r.reached || r.stuckSec > 1 || r.launches > 0 || r.fallThrough) fails++
  console.log(`  ang ${a.toString().padStart(2)}: ${r.reached ? 'REACHED' : 'FAILED '} t=${r.time.toFixed(1)}s stuck=${r.stuckSec.toFixed(0)}s pushOut=${r.pushOuts} unstep=${r.unsteppable} maxSink=${r.maxSink.toFixed(2)} float=${r.maxFloat.toFixed(2)} |dy|=${r.maxDy.toFixed(2)} launch=${r.launches} fall=${r.fallThrough}${r.worstAt ? ` worst=${r.worstAt}` : ''}`)
  if (!r.reached || r.stuckSec > 1) {
    const top = [...blockers.values()].sort((p, q) => q.n - p.n).slice(0, 3)
    for (const b of top) {
      const slope = Math.max(Math.abs(height(b.c.x + 1, b.c.z) - height(b.c.x - 1, b.c.z)), Math.abs(height(b.c.x, b.c.z + 1) - height(b.c.x, b.c.z - 1))) / 2
      console.log(`      blocker x${b.n} @ box[${b.c.minx.toFixed(1)}..${b.c.maxx.toFixed(1)}]x[${b.c.minz.toFixed(1)}..${b.c.maxz.toFixed(1)}] top=${b.c.maxy.toFixed(2)} ${b.c.stair ? 'STAIR' : 'prop'} ${b.c.tex} rise=${b.rise.toFixed(2)} terrSlope=${(Math.atan(slope) * 180 / Math.PI).toFixed(0)}deg why=${b.why}${b.deniedBy ? ' ' + b.deniedBy : ''}`)
    }
  }
}
console.log(`  => ${fails} problem routes of ${ANGLES}`)

console.log('\n== B2. CLIENT sim — walk DOWN from pad centre ==')
fails = 0
for (let a = 0; a < ANGLES; a++) {
  const ang = (a / ANGLES) * Math.PI * 2
  const tx = HILL.x + Math.cos(ang) * (RING + 2), tz = HILL.z + Math.sin(ang) * (RING + 2)
  const r = simRoute(HILL.x, HILL.z, tx, tz, 1.5, 60)
  if (!r.reached || r.stuckSec > 1 || r.launches > 0 || r.fallThrough) fails++
  console.log(`  ang ${a.toString().padStart(2)}: ${r.reached ? 'EXITED ' : 'FAILED '} t=${r.time.toFixed(1)}s stuck=${r.stuckSec.toFixed(0)}s pushOut=${r.pushOuts} maxSink=${r.maxSink.toFixed(2)} |dy|=${r.maxDy.toFixed(2)} launch=${r.launches} fall=${r.fallThrough}${(r.failsafes ?? 0) > 0 ? ` FAILSAFE x${r.failsafes}` : ''}${!r.reached ? ` end=(${(r.endX ?? 0).toFixed(1)},${(r.endZ ?? 0).toFixed(1)})` : ''}`)
}
console.log(`  => ${fails} problem routes of ${ANGLES}`)

// ---------------------------------------------------------------- C. server bot groundFollow
console.log('\n== C. SERVER bot groundFollow (Task 144: highest top <= feet+1.25, 0.5/tick @ 10Hz) ==')
const BOT_DT = 0.1
let worstHover = 0, worstSink = 0, worstVy = 0, worstAt = ''
for (let a = 0; a < ANGLES; a++) {
  const ang = (a / ANGLES) * Math.PI * 2
  const ux = Math.cos(ang), uz = Math.sin(ang)   // outward unit; we walk INWARD (-u)
  let x = HILL.x + ux * RING, z = HILL.z + uz * RING
  let y = height(x, z) - 0.22
  let prevY = y
  for (let t = 0; t < 40 / BOT_DT; t++) {
    x -= ux * SPD * BOT_DT
    z -= uz * SPD * BOT_DT
    // groundAt: highest box top at point <= y + 1.25 (+ Task 145 swallow guard)
    let g: number | null = null
    for (const c of gather(x, z, x, z)) {
      if (x >= c.minx && x <= c.maxx && z >= c.minz && z <= c.maxz) {
        const top = c.maxy
        if (top <= y + 1.25 && (g === null || top > g)) g = top
      }
    }
    if (g !== null && y - g > 3.5) g = null   // deep swallow guard (Task 145)
    if (g !== null) y += (g - y) * 0.5
    const vis = height(x, z)
    const hover = y - vis
    const vy = Math.abs(y - prevY) / BOT_DT
    if (hover > worstHover) { worstHover = hover; worstAt = `hover @ (${x.toFixed(1)},${z.toFixed(1)})` }
    if (vis - y > worstSink) worstSink = vis - y
    if (vy > worstVy) worstVy = vy
    prevY = y
    if (Math.hypot(x - HILL.x, z - HILL.z) <= PAD_R) break
  }
}
console.log(`  worst hover above visible terrain: ${worstHover.toFixed(2)}m (${worstAt})`)
console.log(`  worst sink below visible terrain: ${worstSink.toFixed(2)}m`)
console.log(`  worst vertical speed: ${worstVy.toFixed(1)} m/s`)
console.log(worstHover > 0.5 ? '  => !! bots FLY up the hill (>0.5m above ground)' : '  => bot hover within tolerance')

// ---------------------------------------------------------------- D. slope profile of the hill
console.log('\n== D. hill slope profile (max slope angle per radial band) ==')
for (let r = RING; r >= 2; r -= 2) {
  let maxSlope = 0
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * Math.PI * 2
    const x = HILL.x + Math.cos(ang) * r, z = HILL.z + Math.sin(ang) * r
    const s1 = Math.abs(height(x + 0.5, z) - height(x - 0.5, z))
    const s2 = Math.abs(height(x, z + 0.5) - height(x, z - 0.5))
    maxSlope = Math.max(maxSlope, Math.hypot(s1, s2))
  }
  console.log(`  r=${r.toString().padStart(2)}m: max slope ${maxSlope.toFixed(2)} (${(Math.atan2(maxSlope, 1) * 180 / Math.PI).toFixed(0)} deg)`)
}
