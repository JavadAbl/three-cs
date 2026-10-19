// Auto-rigged player model: the user-supplied character. Pending copy lives at
// public/staging/models/human.glb (gitignored, evaluation); accepted copy at
// public/assets/models/human.glb (committed). The API route serves whichever
// is present — staging wins while it exists.
// The GLB is a STATIC, unrigged A-pose character (no skeleton, no real animation clips),
// so at load time we:
//   1. bake node transforms + normalization (1.79 m, grounded, centered, facing -Z) into the geometry,
//   2. build a small skeleton (hips/torso/head/arms/forearms/thighs/shins),
//   3. assign per-vertex skin weights from spatial rules with smooth blend bands
//      (knee / hip / elbow / shoulder / neck) so limbs deform without gaps,
//   4. convert every original mesh into a SkinnedMesh sharing that skeleton.
// players.ts then drives the bones procedurally (walk / run / crouch / aim / death).
// The procedural box-soldier rig in players.ts stays as the load-fallback.
import * as THREE from 'three'
import { sharedGLTFLoader } from './gltf'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { TeamId } from './weapons'

// Served via the extensionless API route /api/assets/human and fetched with
// method POST on purpose: download-manager extensions (IDM & friends) hook
// GET requests that look like downloadable files (URL extension / binary
// content type) and steal them — a POST fetch is invisible to them.
const MODEL_URL = '/api/assets/human'

// target silhouette height (legacy hitboxes: head sphere center 1.62, r .17 → top ~1.79)
const TARGET_HEIGHT = 1.79

// per-team tint (multiplied over every material of the model)
const TEAM_TINT: Record<TeamId, number> = { CT: 0x9fb7d9, T: 0xd9bd92 }

/** gun stub transform on the right-hand anchor (tuned against screenshots) */
export const GUN_HAND_POS = new THREE.Vector3(0.02, 0.02, -0.02)
export const GUN_HAND_ROT = new THREE.Euler(-1.62, 0, 0)

// ------------------------------------------------------------------ skeleton layout
// joint positions in game space (feet at y 0, facing -Z, 1.79 m tall) — derived from the
// measured island bounds of this specific model (arms hang at |x| 0.2..0.44, knees ~0.5)
const J = {
  hips: [0, 0.95, 0] as const,
  torso: [0, 1.08, 0] as const,
  head: [0, 1.50, 0] as const,
  armL: [-0.27, 1.48, 0] as const,
  armR: [0.27, 1.48, 0] as const,
  foreL: [-0.34, 1.20, 0] as const,
  foreR: [0.34, 1.20, 0] as const,
  thighL: [-0.09, 0.92, 0] as const,
  thighR: [0.09, 0.92, 0] as const,
  shinL: [-0.09, 0.48, 0] as const,
  shinR: [0.09, 0.48, 0] as const,
}

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
}

interface Asset {
  state: 'idle' | 'loading' | 'ready' | 'failed'
  proto: THREE.Group | null
  /** original material → per-team tinted clone (shared by all players of a team) */
  teamMats: Partial<Record<TeamId, Map<THREE.Material, THREE.Material>>>
  waiter: Promise<void> | null
}

const asset: Asset = { state: 'idle', proto: null, teamMats: {}, waiter: null }

// ------------------------------------------------------------------ skin weights
// bone order for skinIndex (must match the order passed to new THREE.Skeleton)
const BONE_ORDER = ['hips', 'torso', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR'] as const
type BoneKey = (typeof BONE_ORDER)[number]
const BONE_INDEX: Record<BoneKey, number> = {} as never
BONE_ORDER.forEach((k, i) => { BONE_INDEX[k] = i })

/** Spatial rule: which bones influence a vertex at game-space (x, y, z). Returns up to 2 [key, weight]. */
function vertexWeights(x: number, y: number): Array<[BoneKey, number]> {
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

// ------------------------------------------------------------------ prototype build

/** load the prototype once; resolves when ready (or failed → callers keep the procedural rig) */
export function preloadUserModel(): Promise<void> {
  if (asset.waiter) return asset.waiter
  asset.state = 'loading'
  asset.waiter = new Promise<void>((resolve) => {
    // POST + extensionless URL: download-manager extensions never intercept this
    fetch(MODEL_URL, { method: 'POST' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        sharedGLTFLoader().parse(
          buf,
          '',
          (gltf) => {
            try {
              asset.proto = buildProto(gltf.scene)
              asset.state = 'ready'
            } catch (e) {
              console.warn('[usermodel] auto-rig failed, keeping procedural rig', e)
              asset.state = 'failed'
            }
            resolve()
          },
          (err) => {
            console.warn('[usermodel] human.glb failed to load, keeping procedural rig', err)
            asset.state = 'failed'
            resolve()
          },
        )
      })
      .catch((err) => {
        console.warn('[usermodel] human.glb failed to load, keeping procedural rig', err)
        asset.state = 'failed'
        resolve()
      })
  })
  return asset.waiter
}

export function userModelReady(): boolean { return asset.state === 'ready' }

/** debug: current asset state (for __eng + E2E checks) */
export function userModelState(): string { return asset.state }

function buildProto(src: THREE.Group): THREE.Group {
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
  if (items.length === 0) throw new Error('no meshes in human.glb')

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

  // right-hand anchor for the gun (child of the right forearm bone)
  const handR = new THREE.Object3D()
  handR.name = 'HandR'
  handR.position.set(0.03, -0.22, 0.03)
  foreR.add(handR)

  // C4 on the upper back (+Z is the back)
  const c4Proto = buildC4()
  c4Proto.name = 'C4Back'
  c4Proto.position.set(0, 0.30, 0.15)
  torso.add(c4Proto)

  // ---- 4. skinned meshes with spatial weights
  const x = new THREE.Vector3()
  for (const it of items) {
    const pos = it.geo.attributes.position as THREE.BufferAttribute
    const n = pos.count
    const si = new Uint16Array(n * 4)
    const sw = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      x.fromBufferAttribute(pos, i)
      const w = vertexWeights(x.x, x.y)
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
  for (const team of ['CT', 'T'] as TeamId[]) {
    const map = new Map<THREE.Material, THREE.Material>()
    for (const it of items) {
      for (const mat of it.mats) {
        if (map.has(mat)) continue
        const c = mat.clone()
        const sm = c as THREE.MeshStandardMaterial
        if (sm.color) sm.color.multiply(new THREE.Color(TEAM_TINT[team]))
        map.set(mat, c)
      }
    }
    asset.teamMats[team] = map
  }
  return model
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

/** create a per-player instance (only call when userModelReady()) */
export function createUserModel(team: TeamId): UserInstance {
  const proto = asset.proto!
  const model = skeletonClone(proto) as THREE.Group

  // swap in team-tinted materials (shared across all players of that team)
  const swapMap = asset.teamMats[team]!
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

  return { model, bones, gunRig, c4: c4 ?? buildC4(), wasAlive: true }
}
