// Trace the f849 (west ramp upper) edge walk sim frame by frame
import { AIMHEAD } from '/home/z/my-project/src/game/map-aimhead.ts'

const PLAYER_R = 0.4, STAND_H = 1.8, STEP_UP = 0.55, GRAVITY = 22, WALK_SPEED = 4.6
interface Box { x: number; y: number; z: number; w: number; h: number; d: number }
const boxes = AIMHEAD.boxes as Box[]
interface Col { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
const cols: Col[] = boxes.map(b => ({
  min: { x: b.x - b.w / 2, y: b.y - b.h / 2, z: b.z - b.d / 2 },
  max: { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 },
}))
function overlapsAt(x: number, y: number, z: number): Col | null {
  for (const c of cols) {
    if (x + PLAYER_R > c.min.x && x - PLAYER_R < c.max.x && y + STAND_H > c.min.y && y < c.max.y && z + PLAYER_R > c.min.z && z - PLAYER_R < c.max.z) return c
  }
  return null
}
function collisionFloor(px: number, pz: number, belowY: number): number {
  let best = -999
  for (const c of cols) {
    if (px + PLAYER_R > c.min.x && px - PLAYER_R < c.max.x && pz + PLAYER_R > c.min.z && pz - PLAYER_R < c.max.z) {
      if (c.max.y <= belowY && c.max.y > best) best = c.max.y
    }
  }
  return best
}

// f849 sim: start 1m east of low edge (game x -27.33), z offset -0.98 (south edge, z -5.42)
const sx = -27.333, sz = -5.42
let feet = collisionFloor(sx, sz, 4.56 + 1.0)
if (feet < -99) feet = 2.4
const p = { x: sx, y: feet + 0.05, z: sz, vx: 0, vy: 0, vz: 0 }
console.log(`start: x ${sx} z ${sz} feet ${feet.toFixed(2)} y ${p.y.toFixed(2)}`)
const dt = 1 / 60
let lastLog = -99
for (let f = 0; f < 160; f++) {
  p.vx += (-WALK_SPEED - p.vx) * Math.min(1, 12 * dt)
  p.vy -= GRAVITY * dt
  if (p.vy < -35) p.vy = -35
  p.x += p.vx * dt
  // resolveHorizontal x
  for (const c of cols) {
    if (p.x + PLAYER_R > c.min.x && p.x - PLAYER_R < c.max.x &&
      p.y + STAND_H > c.min.y && p.y < c.max.y &&
      p.z + PLAYER_R > c.min.z && p.z - PLAYER_R < c.max.z) {
      const rise = c.max.y - p.y
      if (rise > 0.01 && rise <= STEP_UP && p.vy <= 0.1) {
        const blocker = overlapsAt(p.x, c.max.y + 0.02, p.z)
        if (!blocker) { p.y = c.max.y + 0.02; continue }
        if (f - lastLog > 2) {
          lastLog = f
          console.log(`f${f}: STEPUP DENIED onto y ${c.max.y.toFixed(2)} (rise ${rise.toFixed(2)}) — headroom blocked by box y[${blocker.min.y.toFixed(2)},${blocker.max.y.toFixed(2)}] x[${blocker.min.x.toFixed(2)},${blocker.max.x.toFixed(2)}] z[${blocker.min.z.toFixed(2)},${blocker.max.z.toFixed(2)}] at p.x ${p.x.toFixed(3)} p.y ${p.y.toFixed(2)}`)
        }
      }
      // push out
      const wasX = p.x
      p.x = p.x > (c.min.x + c.max.x) / 2 ? c.max.x + PLAYER_R + 0.001 : c.min.x - PLAYER_R - 0.001
      p.vx = 0
      if (f - lastLog > 4 && Math.abs(wasX - p.x) > 0.01) {
        lastLog = f
        console.log(`f${f}: PUSHED x ${wasX.toFixed(2)}→${p.x.toFixed(2)} (y ${p.y.toFixed(2)}) by box y[${c.min.y.toFixed(2)},${c.max.y.toFixed(2)}] x[${c.min.x.toFixed(2)},${c.max.x.toFixed(2)}] z[${c.min.z.toFixed(2)},${c.max.z.toFixed(2)}]`)
      }
    }
  }
  const prevFeet = p.y
  p.y += p.vy * dt
  let landed = ''
  for (const c of cols) {
    const feetNow = p.y
    if (p.x + PLAYER_R > c.min.x && p.x - PLAYER_R < c.max.x &&
      feetNow + STAND_H > c.min.y && feetNow < c.max.y + Math.max(0, prevFeet - feetNow) &&
      p.z + PLAYER_R > c.min.z && p.z - PLAYER_R < c.max.z) {
      if (p.vy <= 0.01 && (feetNow > c.max.y - 0.3 || prevFeet >= c.max.y - 0.001)) {
        if (c.max.y > p.y + 0.05 || (f >= 18 && f <= 22)) landed += `→top ${c.max.y.toFixed(4)} (x[${c.min.x.toFixed(2)},${c.max.x.toFixed(2)}] z[${c.min.z.toFixed(2)},${c.max.z.toFixed(2)}]) `
        p.y = c.max.y; p.vy = 0
      }
    }
  }
  if (f >= 18 && f <= 22) console.log(`f${f}: x ${p.x.toFixed(4)} y ${p.y.toFixed(4)} vy ${p.vy.toFixed(3)} LAND: ${landed || '(none)'}`)
  if (f % 20 === 0) console.log(`f${f}: x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} vx ${p.vx.toFixed(2)}`)
  if (p.y < -6) { console.log('FELL'); break }
}
console.log(`final: x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} — net walked ${(Math.abs(p.x - sx)).toFixed(2)}m`)
