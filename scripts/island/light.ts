// scripts/island/light.ts — shared bake helpers for the island generator.
// SUN must stay in lockstep with the engine's DirectionalLight position
// (src/game/engine.ts: sun.position.set(55, 70, 18)) — the per-vertex color
// bake multiplies the same lambert term the real-time light adds, so a
// mismatch reads as double shadows.
import type { Rng } from './types'

export const SUN: number[] = (() => {
  const l = Math.hypot(55, 70, 18)
  return [55 / l, 70 / l, 18 / l]
})()

/** deterministic PRNG — identical output for identical seeds */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// terrain hook — set by gen.ts before any prop baking so hill/prop shadows
// raymarch the real heightfield
let heightAt: ((x: number, z: number) => number) | null = null
export function setTerrain(fn: (x: number, z: number) => number) { heightAt = fn }
export function terrainY(x: number, z: number): number { return heightAt ? heightAt(x, z) : 0 }

/** is the point sun-shadowed by the terrain itself? (9-step raymarch) */
export function terrainShadowed(p: number[]): boolean {
  if (!heightAt) return false
  for (let i = 1; i <= 9; i++) {
    const d = i * 1.55
    const qx = p[0] + SUN[0] * d, qy = p[1] + SUN[1] * d, qz = p[2] + SUN[2] * d
    if (heightAt(qx, qz) > qy) return true
  }
  return false
}

/** lambert + ambient bake for prop geometry; anchor = the prop's ground/base
 *  point so palm crowns / hut roofs inherit the terrain shadow with one march */
export function propLight(p: number[], n: number[], anchor?: number[]): number {
  const lam = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2])
  let v = 0.40 + 0.68 * lam
  if (anchor && terrainShadowed(anchor)) v *= 0.52
  return Math.min(v, 1.06)
}
