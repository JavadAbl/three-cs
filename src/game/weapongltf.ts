// ============================================================
// weapongltf.ts — staged weapon GLB loading (the "weapon GLB branch"
// from the Task 46 plan), following the human-model pattern
// (usermodel.ts): preload once, procedural builders stay as fallback.
//
// STATUS (2026-10-20): DORMANT. The CC0 Quaternius "Ultimate Guns Pack"
// staged 2026-10-19 (33 Draco GLBs) was REJECTED by the user ("wipe all
// weapon models. they are not good, il find new models") — every staged
// GLB and raw-pack copy was deleted (mirror included) and the
// pack-specific staging scripts were removed from the tree (pattern
// preserved in git history, commit 544f32e). Nothing may restore the
// rejected pack.
//
// This module stays as the drop-in pipeline for the NEXT models the user
// sources. When a GLB for a wired id below exists at
// public/staging/models/weapons/<id>.glb (gitignored, evaluative) or
// public/assets/models/weapons/<id>.glb (accepted), it lights up for:
//   1. REMOTE guns — what other players hold (static is fine there)
//   2. FIRST-PERSON viewmodels — knife AND guns
// Files must be baked to the weapon GLB contract (grip anchor at the
// origin, muzzle pointing −Z, real-meter scale — see
// public/assets/models/README.md). Named part nodes are wired into the
// engine's parts animations by name (the engine guards everything with
// `if (vm.X)`, so parts a model lacks simply skip): /magaz/i → vm.mag
// reload swap (Task 62, AK bm_magazine*), /dustcover/i → vm.slide blowback
// on fire (Task 64, AK u_dustcover* — the game-AK reciprocating-top
// proxy; r_barrel* stays fixed: real AKs don't recoil the barrel, and the
// muzzle-flash tip is measured from static geometry). bolt/pump have no
// name contract yet. Whole-vm motion (bob/sway/recoil/reload dip/draw)
// is group-level and always runs. Weapons without a staged GLB stay
// procedural.
//
// Loading: every id is fetched via the extensionless POST route
// /api/assets/weapon/<id> (download-manager evasion, see the route file),
// parsed with the shared Draco-aware GLTFLoader, and cached as a prototype
// scene. Missing files (current state: ALL of them) 404 → every id stays
// procedural — identical to a fresh clone.
// ============================================================
import * as THREE from 'three'
import { sharedGLTFLoader } from './gltf'
import { buildGloves, type ViewModel } from './weaponmodels'
import { WEAPONS } from './weapons'
import type { TeamId, WeaponId } from './weapons'

/** wired weapon ids + per-id mount flags — drop <id>.glb files for these to go live */
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
  g.userData.glbVm = 'knife' // debug/test marker: this vm came from the GLB branch
  g.add(c)
  // same glove rig as the procedural knife (grip at origin, blade forward)
  buildGloves(g, team, { x: 0, y: 0, z: 0.02, rx: 0.12 })
  // staged knife bbox: z −0.230 (tip) .. +0.050 (pommel), blade on y 0
  return { group: g, tip: new THREE.Vector3(0, 0.012, -0.23) }
}

// ---------------------------------------------------------------- gun vms

// First-person GLB gun vms render at 90% of the real-meter model
// (user 2026-10-20: "its position is good now. can reduce its size a
// little now?" — after the 0.20 pull-back the full-size gun read large on
// screen). Scale applies to the GUN CLONE ONLY: the procedural gloves keep
// real hand size, the classic CS viewmodel trick — measureGun() then
// re-derives tip/eject from the scaled geometry, and remote guns
// (buildGLBRemoteGun) stay real-size for other players. Live-tunable via
// __eng.vmScale(f) (multiplier on this constant).
export const GLB_VM_SCALE = 0.90

/**
 * Measure a freshly assembled vm group (identity transform): overall bbox
 * plus the average height of the muzzle slice (z < min.z + 4cm) so the muzzle
 * flash and shell ejection sit on the barrel line, not the bbox center.
 */
function measureGun(g: THREE.Group): { box: THREE.Box3; tipY: number } {
  g.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(g)
  let sum = 0, n = 0
  const mz = box.min.z + 0.04
  const v = new THREE.Vector3()
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.getAttribute('position')
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
      if (v.z < mz) { sum += v.y; n++ }
    }
  })
  return { box, tipY: n > 0 ? sum / n : (box.min.y + box.max.y) / 2 }
}

/**
 * Topmost nodes under `root` whose name matches `re` (ancestor filter —
 * e.g. the AK's bm_magazine* assembly nodes each carry a MESH child whose
 * name also matches; only the topmost node is collected so the whole
 * subtree moves as one part).
 */
function topmostMatching(root: THREE.Object3D, re: RegExp): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  root.traverse((o) => {
    if (!re.test(o.name)) return
    let p = o.parent
    while (p && p !== root) {
      if (re.test(p.name)) return // a matched ancestor handles it
      p = p.parent
    }
    out.push(o)
  })
  return out
}

/**
 * First-person GUN viewmodel from the staged GLB. The staged files are baked
 * to the vm contract (grip anchor at origin, muzzle −Z, real-meter length),
 * so the group drops onto the same vmBase the procedural vms use. Gloves are
 * the same procedural pair every vm carries: trigger hand on the grip,
 * support hand out on the handguard for long guns (slot 1). NAMED PART
 * nodes are reparented into pivots that are DIRECT children of the vm group
 * (meter space — the engine's envelopes are metric):
 *   - /magaz/i (bm_magazine* in the AK — Task 62, user: "ok do magazine
 *     works") → vm.mag: hidden 18–72% of the reload (a falling copy spawns
 *     via dropMag) then slides in from 5cm below; the pivot is centered on
 *     the mag geometry so the slide-in + dropped copy anchor correctly.
 *   - /dustcover/i (u_dustcover* + ul_dustcoverScroll* + u_dustcoverHolder*
 *     in the AK — Task 64, user: "wiring the AK's dust cover/barrel nodes
 *     for a slide-back animation on fire") → vm.slide: the engine's 34mm
 *     120ms blowback per shot (600 RPM keeps it vibrating through sustained
 *     fire). The dust cover is the standard game-AK proxy for the bolt
 *     carrier cycle (this model has no separate carrier/charging-handle
 *     node; the procedural AK's cover was fully static — this beats it).
 *     The r_barrel* cluster is deliberately NOT wired: real AKs keep the
 *     barrel + gas tube fixed (long-stroke piston), and the muzzle-flash
 *     tip is measured from static geometry — a sliding muzzle would leave
 *     the flash floating ahead. No recenter needed for the slide (the
 *     engine records homeZ and adds the kick on top).
 * Other parts (bolt/pump) are still not returned — those animations simply
 * skip for GLB vms. Returns null while the GLB is not ready → caller falls
 * back to procedural.
 */
export function buildGLBGunVM(weaponId: string, team: TeamId, scaleMul = 1): ViewModel | null {
  const route = ROUTES[weaponId]
  if (!route) return null
  const g = new THREE.Group()
  g.userData.glbVm = weaponId // debug/test marker: this vm came from the GLB branch
  const gs = GLB_VM_SCALE * scaleMul

  if (route.dual) {
    // dual berettas: two pistols in two gloved hands, canted slightly inward
    // (same layout as the procedural elites vm / remote dual stub)
    for (const side of [1, -1]) {
      const c = cloneProto(weaponId)
      if (!c) return null
      c.scale.setScalar(gs)
      c.position.x = side * 0.07
      c.rotation.y = -side * 0.06
      g.add(c)
    }
    const { box, tipY } = measureGun(g)
    buildGloves(g, team, { x: 0.07, y: -0.06, z: 0.03, rx: 0.3 })
    buildGloves(g, team, { x: -0.07, y: -0.06, z: 0.03, rx: 0.3 }, undefined, true)
    return {
      group: g,
      tip: new THREE.Vector3(0.07, tipY, box.min.z),
      eject: new THREE.Vector3(0.1, tipY, box.min.z * 0.4),
    }
  }

  const c = cloneProto(weaponId)
  if (!c) return null
  c.scale.setScalar(gs)
  g.add(c)

  // ---- named-part wiring (Task 62 mag, Task 64 slide) -------------------
  // Pivots are DIRECT children of the vm group so their local space is
  // meters; attach() preserves world transforms, and the engine's envelopes
  // (mag slide-in 5cm, slide blowback 34mm) move the real parts in true
  // meters with no unit conversion.
  c.updateWorldMatrix(true, true)

  // magazine: recenter on the mag geometry so dropMag spawns the falling
  // copy at the visible mag (staged AK: 5 sibling assembly nodes)
  const magNodes = topmostMatching(c, /magaz/i)
  let mag: THREE.Group | null = null
  if (magNodes.length) {
    mag = new THREE.Group()
    mag.name = 'glbMagPivot'
    g.add(mag)
    for (const n of magNodes) mag.attach(n)
    // recenter on the mag geometry: children shift -center, pivot takes +center
    mag.updateWorldMatrix(true, true)
    const mb = new THREE.Box3().setFromObject(mag)
    const ctr = mb.getCenter(new THREE.Vector3())
    for (const n of magNodes) n.position.sub(ctr)
    mag.position.copy(ctr)
    g.userData.glbMagNodes = magNodes.length
  }

  // dust cover (or any /dustcover/i top unit): the reciprocating top on
  // fire. No recenter — the engine records homeZ and adds k*0.034 per shot.
  const slideNodes = topmostMatching(c, /dustcover/i)
  let slide: THREE.Group | null = null
  if (slideNodes.length) {
    slide = new THREE.Group()
    slide.name = 'glbSlidePivot'
    g.add(slide)
    for (const n of slideNodes) slide.attach(n)
    g.userData.glbSlideNodes = slideNodes.length
  }

  const { box, tipY } = measureGun(g)
  if (WEAPONS[weaponId as WeaponId]?.slot === 1) {
    // long gun: support hand ~42% of the way out to the muzzle
    buildGloves(g, team, { x: 0, y: -0.05, z: 0.025, rx: 0.3 },
      { x: 0, y: -0.04, z: box.min.z * 0.42, rx: 0.28 })
  } else {
    buildGloves(g, team, { x: 0, y: -0.05, z: 0.025, rx: 0.3 })
  }
  return {
    group: g,
    tip: new THREE.Vector3(0, tipY, box.min.z),
    // shell port: right side, roughly receiver height a short way ahead of grip
    eject: new THREE.Vector3(0.035, tipY, box.min.z * 0.28),
    ...(mag ? { mag } : {}),
    ...(slide ? { slide } : {}),
  }
}
