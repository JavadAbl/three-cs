// Auto-rigged player models — PER TEAM since Task 115:
//   CT: human.glb  — the soldier (Task 112/113/114 pipeline, bluish tint)
//   T:  rebel.glb  — the leather rebel (Task 115, rendered untinted — the
//                    model itself is the T identity). If the rebel file is
//                    missing, T falls back to the SOLDIER proto with the
//                    classic tan tint (exactly the pre-115 T look).
// Pending copies live in public/staging/models/*.glb (gitignored, evaluation);
// accepted copies at public/assets/models/*.glb. The API routes serve
// whichever is present — staging wins while it exists.
// Both GLBs are STATIC, unrigged A-pose characters (no skeleton, no clips),
// so at load time we:
//   1. bake node transforms + normalization (1.79 m, grounded, centered, facing -Z) into the geometry,
//   2. build a small skeleton (hips/torso/head/arms/forearms/thighs/shins),
//   3. assign per-vertex skin weights from spatial rules with smooth blend bands
//      (knee / hip / elbow / shoulder / neck) so limbs deform without gaps,
//   4. convert every original mesh into a SkinnedMesh sharing that skeleton.
// Everything model-specific (joint table J, weight-band thresholds, IK arm
// rig, hand anchors, tint) lives in a ModelSpec MEASURED from each model's
// geometry (scripts/measure-rebel-t115.mjs / measure-arms-t114.mjs) — the two
// figures have different proportions (soldier: armored, 1.08 m shoulder width,
// forearms 0.36; rebel: lean, 0.58 m wide, arms hug the torso) and a shared
// constant table would spike one of them (Task 112 gotcha #2).
// players.ts then drives the bones procedurally (walk / run / crouch / aim /
// death) and solves the 2-bone IK arms against each instance's own chain.
// The procedural box-soldier rig in players.ts stays as the load-fallback.
import * as THREE from 'three'
import { sharedGLTFLoader } from './gltf'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { TeamId } from './weapons'

// Served via the extensionless API routes /api/assets/{human,rebel} and
// fetched with method POST on purpose: download-manager extensions (IDM &
// friends) hook GET requests that look like downloadable files (URL extension
// / binary content type) and steal them — a POST fetch is invisible to them.
const CT_MODEL_URL = '/api/assets/human'
const T_MODEL_URL = '/api/assets/rebel'

// target silhouette height (legacy hitboxes: head sphere center 1.62, r .17 → top ~1.79)
const TARGET_HEIGHT = 1.79

/**
 * Gun stub transform on the right-hand anchor — INITIAL value only. Once the
 * player is interpolated, players.ts driveUser() overwrites the gunRig
 * transform every frame (Task 114 IK hold: grip glued to the fist, gun axis
 * locked to the carriage direction). Offset semantics: +Y toward the elbow,
 * −Z toward the muzzle side of the hand.
 */
export const GUN_HAND_POS = new THREE.Vector3(0, 0.02, 0.01)
export const GUN_HAND_ROT = new THREE.Euler(-1.92, 0.08, 0)

// ------------------------------------------------------------------ IK arm chains
/** 2-bone analytic IK chain in TORSO-LOCAL space (the frame the arm bones
 *  live in). S = shoulder pivot, E = elbow pivot, F = fist centroid. */
export interface ArmChain {
  /** shoulder pivot, torso-local */
  S: THREE.Vector3
  /** bind upper-arm direction (S→E), unit */
  e0: THREE.Vector3
  /** bind forearm direction (E→fist), unit */
  w0: THREE.Vector3
  L1: number
  L2: number
}
export function mkChain(s: readonly number[], e: readonly number[], f: readonly number[]): ArmChain {
  const S = new THREE.Vector3(s[0], s[1], s[2])
  const E = new THREE.Vector3(e[0], e[1], e[2])
  const F = new THREE.Vector3(f[0], f[1], f[2])
  return { S, e0: E.clone().sub(S).normalize(), w0: F.clone().sub(E).normalize(), L1: E.distanceTo(S), L2: F.distanceTo(E) }
}

/** IK arm rig in torso-local space: S/E/F triplets per side (see USER_ARM_RIG) */
export interface ArmRig {
  right: { S: readonly number[]; E: readonly number[]; F: readonly number[] }
  left: { S: readonly number[]; E: readonly number[]; F: readonly number[] }
}

/**
 * Task 114 IK arm chains — bind geometry in TORSO-LOCAL space (the frame the
 * arm bones live in; the torso joint sits at game-space y 1.08). S = shoulder
 * pivot, E = elbow pivot, F = fist centroid — F measured from the staged
 * soldier GLB (scripts/measure-arms-t114.mjs: right fist (0.32, 0.84, −0.02),
 * left (−0.336, 0.857, −0.019), elbows ≈ (±0.34, 1.26, −0.04) vs the J-table
 * pivots at (±0.34, 1.20, 0) — close enough that the blend band hides it).
 */
export const USER_ARM_RIG = {
  right: { S: [0.27, 0.40, 0], E: [0.34, 0.12, 0], F: [0.32, -0.24, -0.02] },
  left: { S: [-0.27, 0.40, 0], E: [-0.34, 0.12, 0], F: [-0.336, -0.223, -0.019] },
} as const

/**
 * Task 115 rebel arm chains, MEASURED from the staged rebel GLB in game space
 * (scripts/measure-rebel-t115.mjs): right fist (0.205, 0.782, −0.027), left
 * (−0.202, 0.787, −0.043), elbows (±0.21, 1.11, +0.04), shoulders
 * (±0.195, 1.47, +0.06 surface → joints pulled 1 cm medial). S/E match the
 * rebel J-table pivots exactly (IK chain vs bone pivots must agree or the
 * skin swings off the solved fist).
 */
export const REBEL_ARM_RIG = {
  right: { S: [0.185, 0.39, 0.05], E: [0.21, 0.03, 0.04], F: [0.205, -0.298, -0.027] },
  left: { S: [-0.185, 0.39, 0.05], E: [-0.21, 0.03, 0.03], F: [-0.202, -0.293, -0.043] },
} as const

// ------------------------------------------------------------------ model specs
export interface UserBones {
  hips: THREE.Bone
  torso: THREE.Bone
  head: THREE.Bone
  armL: THREE.Bone
  armR: THREE.Bone
  foreL: THREE.Bone
  foreR: THREE.Bone
  thighL: THREE.Bone
  thighR: THREE.Bone
  shinL: THREE.Bone
  shinR: THREE.Bone
}

export interface UserInstance {
  /** wrapper group: feet at origin, faces -Z, already team-tinted */
  model: THREE.Group
  bones: UserBones
  /** weapon stub container parented to the right hand anchor */
  gunRig: THREE.Group
  /** C4 charge parented to the upper back (torso bone) */
  c4: THREE.Group
  wasAlive: boolean
  /** Task 147: TRUE when this instance was built from the OTHER team's slot
   *  (a T player wearing the soldier while the 20.6 MB rebel is still
   *  streaming). PlayerManager watches this flag and re-skins the player the
   *  moment the real model lands — before it existed, fallback instances were
   *  indistinguishable from real ones and were kept for the whole session. */
  fallback: boolean
  /** Task 115: per-instance IK chains (the spec's proportions, not a global) */
  armR: ArmChain
  armL: ArmChain
}

/** joint positions in game space, keyed like BONE_ORDER */
type JointTable = Record<string, readonly [number, number, number]>

interface ModelSpec {
  /** POST-served GLB route */
  url: string
  /** per-team tint multiplied over every material (white = as authored) */
  tint: Record<TeamId, number>
  /** skeleton joint positions in game space (feet y 0, facing -Z, 1.79 m) */
  J: JointTable
  /** spatial skin-weight rule for this model's proportions */
  weights: (x: number, y: number) => Array<[BoneKey, number]>
  /** IK arm rig in torso-local space (S/E must equal J.armX/foreX pivots) */
  armRig: ArmRig
  /** right-fist anchor in foreR-local space (the gun grip point) */
  handR: readonly [number, number, number]
  /** left-fist anchor in foreL-local space (probe/support verification) */
  handL: readonly [number, number, number]
}

// ------------------------------------------------------------------ skin weights
// bone order for skinIndex (must match the order passed to new THREE.Skeleton)
const BONE_ORDER = ['hips', 'torso', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR'] as const
type BoneKey = (typeof BONE_ORDER)[number]
const BONE_INDEX: Record<BoneKey, number> = {} as never
BONE_ORDER.forEach((k, i) => { BONE_INDEX[k] = i })

/** Spatial rule: which bones influence a vertex at game-space (x, y). Returns up to 2 [key, weight]. */
function soldierWeights(x: number, y: number): Array<[BoneKey, number]> {
  const ax = Math.abs(x)
  // --- arms (hanging A-pose: |x| 0.2..0.44, y 0.78..1.66; shoulder caps reach in to |x| ~0.12 above y 1.32)
  const armX = y > 1.32 ? 0.13 : 0.20
  if (y > 0.75 && y < 1.66 && ax > armX) {
    const upper: BoneKey = x < 0 ? 'armL' : 'armR'
    const fore: BoneKey = x < 0 ? 'foreL' : 'foreR'
    if (y > 1.08 && y < 1.32) {
      // elbow blend band
      const t = (y - 1.08) / 0.24
      return [[upper, t], [fore, 1 - t]]
    }
    return y >= 1.20 ? [[upper, 1]] : [[fore, 1]]
  }
  // --- head + neck
  if (ax < 0.16) {
    if (y > 1.62) return [['head', 1]]
    if (y > 1.50) {
      const t = (y - 1.50) / 0.12
      return [['head', t], ['torso', 1 - t]]
    }
  }
  // --- legs + pelvis
  if (y < 0.48) {
    if (ax < 0.05) return [['shinL', 0.5], ['shinR', 0.5]]
    return [[x < 0 ? 'shinL' : 'shinR', 1]]
  }
  if (y < 0.62) {
    // knee blend band
    const t = (y - 0.48) / 0.14
    const thigh: BoneKey = x < 0 ? 'thighL' : 'thighR'
    const shin: BoneKey = x < 0 ? 'shinL' : 'shinR'
    if (ax < 0.05) return [['hips', t], [x < 0 ? 'shinL' : 'shinR', 1 - t]]
    return [[thigh, t], [shin, 1 - t]]
  }
  if (y < 0.94) {
    if (ax < 0.07) return [['hips', 1]] // pelvis center
    return [[x < 0 ? 'thighL' : 'thighR', 1]]
  }
  if (y < 1.10) {
    // hip blend band: thigh ↔ hips
    const t = (y - 0.94) / 0.16
    if (ax < 0.07) return [['hips', 1]]
    return [['hips', t], [x < 0 ? 'thighL' : 'thighR', 1 - t]]
  }
  // --- torso (chest/waist)
  return [['torso', 1]]
}

/**
 * Rebel spatial rule — MEASURED bands (scripts/measure-rebel-{,meshes-}t115.mjs):
 * arms hug the torso (inner edge |x| ≈ 0.195 at the sleeve beside the ribs,
 * 0.165 at the deltoid, 0.18 at the forearm/hand; y 0.72..1.52), elbow at
 * y 1.11 (blend 1.00..1.22), neck tightens above y 1.52 (head blend to 1.60),
 * knee at y 0.50 (blend 0.46..0.60 — same as the soldier). Legs are set a
 * little wider (knee ±0.14 — the model's stance splays to ±0.19 at the boots).
 */
function rebelWeights(x: number, y: number): Array<[BoneKey, number]> {
  const ax = Math.abs(x)
  // --- arms (hanging A-pose, sleeves against the jacket sides)
  if (y > 0.72 && y < 1.52) {
    const armX = y > 1.32 ? 0.165 : (y > 1.08 ? 0.195 : 0.18)
    if (ax > armX) {
      const upper: BoneKey = x < 0 ? 'armL' : 'armR'
      const fore: BoneKey = x < 0 ? 'foreL' : 'foreR'
      if (y > 1.00 && y < 1.22) {
        // elbow blend band
        const t = (y - 1.00) / 0.22
        return [[upper, t], [fore, 1 - t]]
      }
      return y >= 1.11 ? [[upper, 1]] : [[fore, 1]]
    }
  }
  // --- head + neck
  if (ax < 0.16) {
    if (y > 1.60) return [['head', 1]]
    if (y > 1.52) {
      const t = (y - 1.52) / 0.08
      return [['head', t], ['torso', 1 - t]]
    }
  }
  // --- legs + pelvis (knee 0.50 measured — soldier bands carry over)
  if (y < 0.46) {
    if (ax < 0.05) return [['shinL', 0.5], ['shinR', 0.5]]
    return [[x < 0 ? 'shinL' : 'shinR', 1]]
  }
  if (y < 0.60) {
    const t = (y - 0.46) / 0.14
    const thigh: BoneKey = x < 0 ? 'thighL' : 'thighR'
    const shin: BoneKey = x < 0 ? 'shinL' : 'shinR'
    if (ax < 0.05) return [['hips', t], [shin, 1 - t]]
    return [[thigh, t], [shin, 1 - t]]
  }
  if (y < 0.94) {
    if (ax < 0.07) return [['hips', 1]]
    return [[x < 0 ? 'thighL' : 'thighR', 1]]
  }
  if (y < 1.10) {
    const t = (y - 0.94) / 0.16
    if (ax < 0.07) return [['hips', 1]]
    return [['hips', t], [x < 0 ? 'thighL' : 'thighR', 1 - t]]
  }
  // --- torso (chest/waist)
  return [['torso', 1]]
}

/** Task 112/113/114 soldier — joint table measured from the staged human.glb. */
const SOLDIER_SPEC: ModelSpec = {
  url: CT_MODEL_URL,
  // per-team tint (multiplied over every material): one geometry, two teams
  tint: { CT: 0x9fb7d9, T: 0xd9bd92 },
  J: {
    hips: [0, 0.95, 0],
    torso: [0, 1.08, 0],
    head: [0, 1.50, 0],
    armL: [-0.27, 1.48, 0],
    armR: [0.27, 1.48, 0],
    foreL: [-0.34, 1.20, 0],
    foreR: [0.34, 1.20, 0],
    thighL: [-0.09, 0.92, 0],
    thighR: [0.09, 0.92, 0],
    shinL: [-0.09, 0.48, 0],
    shinR: [0.09, 0.48, 0],
  },
  weights: soldierWeights,
  armRig: USER_ARM_RIG,
  // Task 114: anchored at the MEASURED fist centroid of the staged soldier
  // (bind (0.32, 0.84, −0.02) game-space → local (−0.02, −0.36, −0.02) under
  // foreR). The old (0.03, −0.22, 0.03) was tuned for the retired Vanguard
  // model (0.22 forearm); this model's forearm joint→fist is 0.36.
  handR: [-0.02, -0.36, -0.02],
  handL: [0.004, -0.343, -0.019],
}

/** Task 115 leather rebel — everything measured 2025-10-25 (staged rebel.glb). */
const REBEL_SPEC: ModelSpec = {
  url: T_MODEL_URL,
  // the rebel IS the terrorist identity model — render as authored (white)
  tint: { CT: 0xffffff, T: 0xffffff },
  J: {
    hips: [0, 0.95, 0],
    torso: [0, 1.08, 0],
    head: [0, 1.52, 0],
    armL: [-0.185, 1.47, 0.05],
    armR: [0.185, 1.47, 0.05],
    foreL: [-0.21, 1.11, 0.03],
    foreR: [0.21, 1.11, 0.04],
    thighL: [-0.10, 0.92, 0],
    thighR: [0.10, 0.92, 0],
    shinL: [-0.14, 0.48, 0.05],
    shinR: [0.14, 0.48, 0.05],
  },
  weights: rebelWeights,
  armRig: REBEL_ARM_RIG,
  // measured right fist (0.205, 0.782, −0.027) − foreR joint (0.21, 1.11, 0.04);
  // forearm joint→fist 0.335 (soldier: 0.36)
  handR: [-0.005, -0.328, -0.067],
  handL: [0.008, -0.323, -0.073],
}

// ------------------------------------------------------------------ asset slots
interface Asset {
  state: 'idle' | 'loading' | 'ready' | 'failed'
  proto: THREE.Group | null
  /** original material → per-team tinted clone (shared by all players of a team) */
  teamMats: Partial<Record<TeamId, Map<THREE.Material, THREE.Material>>>
  waiter: Promise<void> | null
}
interface Slot { spec: ModelSpec; asset: Asset }

// CT = soldier; T = rebel (falls back to the soldier proto + tan tint when
// the rebel file is absent — createUserModel resolves that chain)
const slots: Record<TeamId, Slot> = {
  CT: { spec: SOLDIER_SPEC, asset: { state: 'idle', proto: null, teamMats: {}, waiter: null } },
  T: { spec: REBEL_SPEC, asset: { state: 'idle', proto: null, teamMats: {}, waiter: null } },
}

// ------------------------------------------------------------------ prototype build

function loadSlot(slot: Slot): Promise<void> {
  const a = slot.asset
  // Task 147: ONE retry on FETCH-level failures (network hiccup, the asset
  // cache's 45 s netGuard). No parse-level retry — a corrupt GLB stays
  // corrupt. The retry matters most on the first cold load of the 20.6 MB
  // rebel over a slow link: without it a single netGuard timeout marked the
  // T slot 'failed' and every terrorist rendered as the CT soldier for the
  // whole session. (From the second session on, the persistent cache serves
  // this URL without touching the network — see preloader ROUTE_RE, Task 147.)
  const attempt = (): Promise<void> =>
    fetch(slot.spec.url, { method: 'POST' })
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
              const built = buildProto(gltf.scene, slot.spec)
              a.proto = built.proto
              a.teamMats = built.teamMats
              a.state = 'ready'
            } catch (e) {
              console.warn(`[usermodel] auto-rig failed for ${slot.spec.url}, ${slot.spec.url.includes('rebel') ? 'T keeps the soldier fallback' : 'keeping procedural rig'}`, e)
              a.state = 'failed'
            }
            resolve()
          },
          (err) => {
            console.warn(`[usermodel] ${slot.spec.url} failed to load, ${slot.spec.url.includes('rebel') ? 'T keeps the soldier fallback' : 'keeping procedural rig'}`, err)
            a.state = 'failed'
            resolve()
          },
        )
      }))
  return attempt()
    .catch((err) => {
      console.warn(`[usermodel] ${slot.spec.url} fetch failed (${String(err?.message ?? err)}), retrying once…`)
      return attempt()
    })
    .catch((err) => {
      console.warn(`[usermodel] ${slot.spec.url} failed to load, ${slot.spec.url.includes('rebel') ? 'T keeps the soldier fallback' : 'keeping procedural rig'}`, err)
      a.state = 'failed'
    })
}

/** load a team's model (memoized). No arg = warm BOTH teams (page.tsx lobby
 *  warm-up; resolves once every slot has settled — success OR failure). */
export function preloadUserModel(team?: TeamId): Promise<void> {
  if (team) {
    const a = slots[team].asset
    if (a.waiter) return a.waiter
    a.state = 'loading'
    a.waiter = loadSlot(slots[team])
    return a.waiter
  }
  return Promise.all([preloadUserModel('CT'), preloadUserModel('T')]).then(() => { })
}

/** Task 147 debug/E2E (__eng.glbKick): re-attempt a team's model load. A slot
 *  that settled as 'failed' (network died mid-rebel) stays failed by design —
 *  no infinite retries — but the debug hook (and any future re-entry point)
 *  can clear the memoized waiter and try again; PlayerManager's model-lands
 *  pass then re-skins the fallback players automatically. */
export function reloadUserModel(team: TeamId): Promise<void> {
  const a = slots[team].asset
  if (a.proto) return Promise.resolve()   // already good — nothing to re-load
  a.waiter = null
  a.state = 'loading'
  return preloadUserModel(team)
}

/** true when this team has a usable proto (T counts the soldier fallback). */
export function userModelReady(team?: TeamId): boolean {
  if (team === 'CT') return !!slots.CT.asset.proto
  if (team === 'T') return !!(slots.T.asset.proto || slots.CT.asset.proto)
  return userModelState() === 'ready'
}

/** Task 147: true when this team's OWN proto is still missing (for T this is
 *  true even while the soldier fallback renders — the fallback doesn't count;
 *  PlayerManager uses it to schedule slow-link retry backoff). */
export function userModelMissing(team: TeamId): boolean {
  return !slots[team].asset.proto
}

/** E2E/debug contract: 'ready' only once EVERY slot has settled and at least
 *  one proto exists — the moment players.ts upgrades finish, matching the
 *  pre-115 single-model semantics (ab-* harnesses wait on this string). */
export function userModelState(): string {
  const ct = slots.CT.asset, t = slots.T.asset
  const pending = ct.state === 'idle' || ct.state === 'loading' || t.state === 'idle' || t.state === 'loading'
  if (pending) return (ct.state === 'idle' && t.state === 'idle') ? 'idle' : 'loading'
  return (ct.proto || t.proto) ? 'ready' : 'failed'
}

/** richer per-team detail for __eng debugging: which proto each team renders */
export function userModelStates(): Record<TeamId, string> {
  const t = slots.T.asset
  return {
    CT: slots.CT.asset.proto ? 'soldier' : slots.CT.asset.state,
    T: t.proto ? 'rebel' : (slots.CT.asset.proto ? 'soldier-fallback' : t.state),
  }
}

function buildProto(src: THREE.Group, spec: ModelSpec): { proto: THREE.Group; teamMats: Partial<Record<TeamId, Map<THREE.Material, THREE.Material>>> } {
  const J = spec.J
  // ---- 1. bake node transforms into geometries (collect meshes, flatten)
  src.updateMatrixWorld(true)
  const items: Array<{ geo: THREE.BufferGeometry; mats: THREE.Material[] }> = []
  src.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.geometry?.attributes?.position) return
    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    geo.deleteAttribute('tangent')
    items.push({ geo, mats: Array.isArray(m.material) ? [...m.material] : [m.material] })
  })
  if (items.length === 0) throw new Error('no meshes in model')

  // ---- 2. normalization: scale to 1.79 m, ground y=0, center x/z, face -Z (source faces +Z)
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const it of items) {
    const pos = it.geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i))
  }
  const size = box.getSize(new THREE.Vector3())
  const s = TARGET_HEIGHT / Math.max(0.01, size.y)
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const M = new THREE.Matrix4()
    .makeRotationY(Math.PI)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz))
  for (const it of items) it.geo.applyMatrix4(M)

  // ---- 3. skeleton (J holds WORLD positions; children get parent-relative locals — bind pose has identity rotations)
  const mk = (key: BoneKey, parentKey: BoneKey | null): THREE.Bone => {
    const b = new THREE.Bone()
    b.name = key
    const p = parentKey ? (J[parentKey] as unknown as readonly number[]) : [0, 0, 0]
    const w = J[key] as unknown as readonly number[]
    b.position.set(w[0] - p[0], w[1] - p[1], w[2] - p[2])
    ;(parentKey ? model.getObjectByName(parentKey)! : model).add(b)
    return b
  }
  const model = new THREE.Group()
  model.name = 'UserRig'
  const hips = mk('hips', null)
  const torso = mk('torso', 'hips')
  const head = mk('head', 'torso')
  const armL = mk('armL', 'torso')
  const armR = mk('armR', 'torso')
  const foreL = mk('foreL', 'armL')
  const foreR = mk('foreR', 'armR')
  mk('thighL', 'hips'); mk('thighR', 'hips')
  mk('shinL', 'thighL'); mk('shinR', 'thighR')

  const bones: UserBones = {
    hips, torso, head, armL, armR, foreL, foreR,
    thighL: model.getObjectByName('thighL') as THREE.Bone,
    thighR: model.getObjectByName('thighR') as THREE.Bone,
    shinL: model.getObjectByName('shinL') as THREE.Bone,
    shinR: model.getObjectByName('shinR') as THREE.Bone,
  }
  const boneList = BONE_ORDER.map(k => model.getObjectByName(k) as THREE.Bone)

  // right-hand anchor for the gun (child of the right forearm bone) at the
  // MEASURED fist centroid of THIS model (spec.handR); left-hand twin anchor
  // (probe/verification only — nothing parented)
  const handR = new THREE.Object3D()
  handR.name = 'HandR'
  handR.position.set(spec.handR[0], spec.handR[1], spec.handR[2])
  foreR.add(handR)
  const handL = new THREE.Object3D()
  handL.name = 'HandL'
  handL.position.set(spec.handL[0], spec.handL[1], spec.handL[2])
  foreL.add(handL)

  // C4 on the upper back (+Z is the back)
  const c4Proto = buildC4()
  c4Proto.name = 'C4Back'
  c4Proto.position.set(0, 0.30, 0.15)
  torso.add(c4Proto)

  // ---- 4. skinned meshes with this model's spatial weights
  const x = new THREE.Vector3()
  for (const it of items) {
    const pos = it.geo.attributes.position as THREE.BufferAttribute
    const n = pos.count
    const si = new Uint16Array(n * 4)
    const sw = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      x.fromBufferAttribute(pos, i)
      const w = spec.weights(x.x, x.y)
      for (let k = 0; k < 4; k++) {
        if (k < w.length) {
          si[i * 4 + k] = BONE_INDEX[w[k][0]]
          sw[i * 4 + k] = w[k][1]
        }
      }
    }
    it.geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4))
    it.geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
    const mesh = new THREE.SkinnedMesh(it.geo, it.mats.length === 1 ? it.mats[0] : it.mats)
    mesh.name = 'skin'
    mesh.frustumCulled = false // skinned bounds are unreliable; never cull
    mesh.castShadow = true
    model.add(mesh)
  }

  // ---- 5. bind (geometry and bones live in the same game space)
  model.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(boneList)
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (m.isSkinnedMesh) m.bind(skeleton, new THREE.Matrix4())
  })

  // per-team tinted material clones
  const teamMats: Partial<Record<TeamId, Map<THREE.Material, THREE.Material>>> = {}
  for (const team of ['CT', 'T'] as TeamId[]) {
    const map = new Map<THREE.Material, THREE.Material>()
    for (const it of items) {
      for (const mat of it.mats) {
        if (map.has(mat)) continue
        const c = mat.clone()
        const sm = c as THREE.MeshStandardMaterial
        if (sm.color) sm.color.multiply(new THREE.Color(spec.tint[team]))
        map.set(mat, c)
      }
    }
    teamMats[team] = map
  }
  return { proto: model, teamMats }
}

function buildC4(): THREE.Group {
  const g = new THREE.Group()
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.15, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x8a2020 }),
  )
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.03, 0.015),
    new THREE.MeshLambertMaterial({ color: 0x11ff44 }),
  )
  led.position.set(0.03, 0.05, 0.028)
  g.add(box, led)
  g.visible = false
  return g
}

/** create a per-player instance (only call when userModelReady(team)) */
export function createUserModel(team: TeamId): UserInstance {
  // primary = this team's own slot; T falls back to the soldier proto (tan
  // tint) when the rebel is unavailable — the exact pre-115 T rendering.
  // Task 147: the instance records WHICH proto built it so PlayerManager can
  // re-skin fallback instances once the real model lands (see UserInstance).
  let slot = slots[team]
  let fallback = false
  if (!slot.asset.proto && team === 'T' && slots.CT.asset.proto) { slot = slots.CT; fallback = true }
  const proto = slot.asset.proto
  const swapMap = slot.asset.teamMats[team]!
  if (!proto || !swapMap) throw new Error(`user model not ready for team ${team}`)
  const spec = slot.spec
  const model = skeletonClone(proto) as THREE.Group

  // swap in team-tinted materials (shared across all players of that team)
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.frustumCulled = false
    m.material = Array.isArray(m.material) ? m.material.map(mm => swapMap.get(mm) ?? mm) : (swapMap.get(m.material) ?? m.material)
  })

  const bone = (k: string) => model.getObjectByName(k) as THREE.Bone
  const bones: UserBones = {
    hips: bone('hips'), torso: bone('torso'), head: bone('head'),
    armL: bone('armL'), armR: bone('armR'), foreL: bone('foreL'), foreR: bone('foreR'),
    thighL: bone('thighL'), thighR: bone('thighR'), shinL: bone('shinL'), shinR: bone('shinR'),
  }

  // gun rig on the right-hand anchor
  const gunRig = new THREE.Group()
  gunRig.name = 'GunRig'
  gunRig.position.copy(GUN_HAND_POS)
  gunRig.rotation.copy(GUN_HAND_ROT)
  model.getObjectByName('HandR')!.add(gunRig)

  const c4 = model.getObjectByName('C4Back') as THREE.Group | null

  // Task 115: per-instance IK chains from the spec that actually built this
  // proto (players.ts holdWeapon solves against g.armR / g.armL)
  const armR = mkChain(spec.armRig.right.S, spec.armRig.right.E, spec.armRig.right.F)
  const armL = mkChain(spec.armRig.left.S, spec.armRig.left.E, spec.armRig.left.F)

  return { model, bones, gunRig, c4: c4 ?? buildC4(), wasAlive: true, fallback, armR, armL }
}
