// ============================================================
// weapongltf.ts — staged weapon GLB loading (the "weapon GLB branch"
// from the Task 46 plan), following the human-model pattern
// (usermodel.ts): preload once, procedural builders stay as fallback.
//
// Scope (user-approved 2026-10-19): the staged CC0 Quaternius pack
// (33 Draco GLBs, scripts/stage-guns-pack.sh) is used for
//   1. REMOTE guns — what other players hold (static models are perfect
//      there; the procedural remote guns had no part animation anyway)
//   2. the KNIFE viewmodel — a bayonet has no moving parts, so the GLB
//      replaces the procedural knife vm wholesale
// All other first-person viewmodels stay procedural: the pack has no
// named mag/slide/bolt/pump part nodes, and the procedural vms carry the
// engine's parts animations (reload/bolt-cycle/pump) that the pack would
// silently lose.
//
// Loading: every id is fetched via the extensionless POST route
// /api/assets/weapon/<id> (download-manager evasion, see the route file),
// parsed with the shared Draco-aware GLTFLoader, and cached as a prototype
// scene. Missing files (fresh clone) 404 → that id simply stays procedural.
// ============================================================
import * as THREE from 'three'
import { sharedGLTFLoader } from './gltf'
import { buildGloves, type ViewModel } from './weaponmodels'
import type { TeamId } from './weapons'

/** staged weapon ids + per-id mount flags (mirrors scripts/stage-guns-pack.ts ROUTES) */
const ROUTES: Partial<Record<string, { dual?: boolean }>> = {
  knife: {},
  glock: {}, usp: {}, p250: {}, cz75: {}, fiveseven: {}, tec9: {}, hkp2000: {},
  deagle: {}, elites: { dual: true }, revolver: {},
  mp5: {}, mp9: {}, mac10: {}, mp7: {}, ump45: {}, p90: {}, bizon: {},
  nova: {}, xm1014: {}, mag7: {}, sawedoff: {},
  ak47: {}, m4: {}, m4a1s: {}, galil: {}, sg553: {}, famas: {}, aug: {},
  awp: {}, ssg08: {}, scar20: {}, g3sg1: {},
}

type State = 'idle' | 'loading' | 'ready' | 'failed'

interface WeaponAsset {
  state: State
  proto: THREE.Group | null
}

const assets = new Map<string, WeaponAsset>()
let waiter: Promise<void> | null = null

for (const id of Object.keys(ROUTES)) assets.set(id, { state: 'idle', proto: null })

function loadOne(id: string): Promise<void> {
  const a = assets.get(id)!
  a.state = 'loading'
  return fetch(`/api/assets/weapon/${id}`, { method: 'POST' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.arrayBuffer()
    })
    .then((buf) => new Promise<void>((resolve) => {
      sharedGLTFLoader().parse(
        buf,
        '',
        (gltf) => {
          try {
            const scene = gltf.scene as THREE.Group
            scene.traverse((o) => {
              const m = o as THREE.Mesh
              if (m.isMesh) {
                m.castShadow = true
                m.frustumCulled = false // small objects, cheap to draw; avoids stale-bounds culling
              }
            })
            a.proto = scene
            a.state = 'ready'
          } catch (e) {
            console.warn(`[weapongltf] ${id}: bad scene, keeping procedural`, e)
            a.state = 'failed'
          }
          resolve()
        },
        (err) => {
          console.warn(`[weapongltf] ${id}: parse failed, keeping procedural`, err)
          a.state = 'failed'
          resolve()
        },
      )
    }))
    .catch(() => {
      // 404 = not staged on this machine → procedural fallback is the design
      a.state = 'failed'
    })
}

/** Preload every staged weapon GLB (lobby warm-up; memoized — safe to re-call). */
export function preloadWeaponModels(): Promise<void> {
  if (waiter) return waiter
  waiter = Promise.all([...assets.keys()].map(loadOne)).then(() => undefined)
  return waiter
}

export function weaponModelReady(id: string): boolean {
  return assets.get(id)?.state === 'ready'
}

/** debug/testing hook state (mirrors usermodel.userModelState) */
export function weaponModelsState(): Record<string, State> {
  const out: Record<string, State> = {}
  for (const [id, a] of assets) out[id] = a.state
  return out
}

// ---------------------------------------------------------------- remote guns

/** Clone a prototype (no skins in the pack → plain clone shares materials). */
function cloneProto(id: string): THREE.Group | null {
  const a = assets.get(id)
  if (a?.state !== 'ready' || !a.proto) return null
  return a.proto.clone(true)
}

/**
 * Remote-player gun from the staged GLB (origin at grip, muzzle −Z — the
 * files are pre-baked to the engine's gun-stub contract, so the group drops
 * straight into the same hand anchor the procedural stubs use).
 * Returns null when the id has no staged GLB (or it failed to load).
 */
export function buildGLBRemoteGun(weaponId: string): THREE.Group | null {
  const route = ROUTES[weaponId]
  if (!route) return null
  const g = new THREE.Group()
  if (route.dual) {
    // dual berettas: two pistols mirrored like the procedural stub
    for (const side of [1, -1]) {
      const c = cloneProto(weaponId)
      if (!c) return null
      c.position.x = side * 0.045
      g.add(c)
    }
  } else {
    const c = cloneProto(weaponId)
    if (!c) return null
    g.add(c)
  }
  return g
}

// ---------------------------------------------------------------- knife vm

/**
 * First-person knife viewmodel from the staged GLB (Quaternius bayonet —
 * no moving parts, so the GLB replaces the procedural blade wholesale).
 * Gloves are the same procedural pair every vm uses. Returns null while
 * the GLB is not ready → caller falls back to the procedural knife.
 */
export function buildGLBKnifeVM(team: TeamId): ViewModel | null {
  const c = cloneProto('knife')
  if (!c) return null
  const g = new THREE.Group()
  g.add(c)
  // same glove rig as the procedural knife (grip at origin, blade forward)
  buildGloves(g, team, { x: 0, y: 0, z: 0.02, rx: 0.12 })
  // staged knife bbox: z −0.230 (tip) .. +0.050 (pommel), blade on y 0
  return { group: g, tip: new THREE.Vector3(0, 0.012, -0.23) }
}
