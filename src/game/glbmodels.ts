// GLB player model: Mixamo "Vanguard" soldier (from the three.js example asset set).
// One prototype load + SkeletonUtils.clone per player; Idle/Walk/Run clips driven by
// the same per-player state that animates the procedural fallback rig.
// Model faces -Z at yaw 0 (same convention as the local camera).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { TeamId } from './weapons'

const MODEL_URL = '/assets/models/Soldier.glb'

// target silhouette height (legacy hitboxes: head sphere center 1.62, r .17 → top ~1.79)
const TARGET_HEIGHT = 1.79

// per-team body tint (multiplied over the diffuse map) + visor emissive
const TEAM_BODY: Record<TeamId, number> = { CT: 0x82a6d8, T: 0xd8b98c }
const TEAM_VISOR_EMISSIVE: Record<TeamId, number> = { CT: 0x2a6fd4, T: 0xd4762a }

const BODY_MAT_NAME = 'VanguardBodyMat'
const VISOR_MAT_NAME = 'Vanguard_VisorMat'

// gun stub transform on the right-hand bone (tuned against screenshots)
export const GUN_HAND_POS = new THREE.Vector3(0.045, 0.115, 0.04)
export const GUN_HAND_ROT = new THREE.Euler(-1.45, -0.18, 0.08)

export interface GlbBones {
  hips: THREE.Object3D
  spine: THREE.Object3D
  spine1: THREE.Object3D
  spine2: THREE.Object3D
  neck: THREE.Object3D
  head: THREE.Object3D
  handR: THREE.Object3D
  thighR: THREE.Object3D
  thighL: THREE.Object3D
  calfR: THREE.Object3D
  calfL: THREE.Object3D
}

export interface GlbInstance {
  /** wrapper group: feet at origin, faces -Z, already team-tinted */
  model: THREE.Group
  mixer: THREE.AnimationMixer
  actions: { idle: THREE.AnimationAction; walk: THREE.AnimationAction; run: THREE.AnimationAction }
  bones: GlbBones
  /** weapon stub container parented to the right hand */
  gunRig: THREE.Group
  /** C4 charge parented to the upper back (Spine1) */
  c4: THREE.Group
  current: 'idle' | 'walk' | 'run'
  /** manually-driven blend weights (immune to mixer fade flapping) */
  weights: { idle: number; walk: number; run: number }
  wasAlive: boolean
}

interface Asset {
  state: 'idle' | 'loading' | 'ready' | 'failed'
  proto: THREE.Group | null
  clips: { idle: THREE.AnimationClip; walk: THREE.AnimationClip; run: THREE.AnimationClip } | null
  scale: number
  groundY: number
  bodyMat: THREE.MeshStandardMaterial | null
  visorMat: THREE.MeshStandardMaterial | null
  teamBody: Partial<Record<TeamId, THREE.MeshStandardMaterial>>
  teamVisor: Partial<Record<TeamId, THREE.MeshStandardMaterial>>
  waiter: Promise<void> | null
}

const asset: Asset = {
  state: 'idle', proto: null, clips: null, scale: 1, groundY: 0,
  bodyMat: null, visorMat: null, teamBody: {}, teamVisor: {}, waiter: null,
}

/** load the prototype once; resolves when ready (or failed → callers keep the procedural rig) */
export function preloadSoldier(): Promise<void> {
  if (asset.waiter) return asset.waiter
  asset.state = 'loading'
  asset.waiter = new Promise<void>((resolve) => {
    const loader = new GLTFLoader()
    loader.load(
      MODEL_URL,
      (gltf) => {
        try {
          const proto = gltf.scene
          // identify body + visor materials by name
          proto.traverse((o) => {
            const m = o as THREE.Mesh
            if (!m.isMesh) return
            const mats = Array.isArray(m.material) ? m.material : [m.material]
            for (const mat of mats) {
              const sm = mat as THREE.MeshStandardMaterial
              if (!asset.bodyMat && sm.name === BODY_MAT_NAME) asset.bodyMat = sm
              if (!asset.visorMat && sm.name === VISOR_MAT_NAME) asset.visorMat = sm
            }
          })
          if (!asset.bodyMat) {
            // name-based lookup failed → first material with a texture map
            proto.traverse((o) => {
              const m = o as THREE.Mesh
              if (asset.bodyMat || !m.isMesh) return
              const mats = Array.isArray(m.material) ? m.material : [m.material]
              for (const mat of mats) {
                const sm = mat as THREE.MeshStandardMaterial
                if (sm.map) { asset.bodyMat = sm; break }
              }
            })
          }
          // per-team tinted clones (shared by all players of that team)
          for (const team of ['CT', 'T'] as TeamId[]) {
            const b = (asset.bodyMat ?? new THREE.MeshStandardMaterial()).clone()
            b.name = `body-${team}`
            b.color = new THREE.Color(TEAM_BODY[team])
            b.roughness = 0.85
            b.metalness = 0.05
            asset.teamBody[team] = b
            const v = (asset.visorMat ?? new THREE.MeshStandardMaterial({ color: 0x1a1a1a })).clone()
            v.name = `visor-${team}`
            v.color = new THREE.Color(0x181818)
            v.emissive = new THREE.Color(TEAM_VISOR_EMISSIVE[team])
            v.emissiveIntensity = 1.2
            v.roughness = 0.35
            v.metalness = 0.4
            asset.teamVisor[team] = v
          }
          // ground + scale from the bind-pose bounding box
          const box = new THREE.Box3().setFromObject(proto)
          const h = Math.max(0.01, box.max.y - box.min.y)
          asset.scale = TARGET_HEIGHT / h
          asset.groundY = -box.min.y * asset.scale
          // clips (fuzzy by name)
          const find = (n: string) => gltf.animations.find((a) => a.name.toLowerCase().includes(n))
          const idle = find('idle') ?? gltf.animations[0]
          const walk = find('walk') ?? idle
          const run = find('run') ?? walk
          asset.clips = { idle, walk, run }
          asset.proto = proto
          asset.state = 'ready'
        } catch (e) {
          console.warn('[glbmodels] prototype prep failed, keeping procedural rig', e)
          asset.state = 'failed'
        }
        resolve()
      },
      undefined,
      (err) => {
        console.warn('[glbmodels] Soldier.glb failed to load, keeping procedural rig', err)
        asset.state = 'failed'
        resolve()
      },
    )
  })
  return asset.waiter
}

export function soldierReady(): boolean { return asset.state === 'ready' }

/** debug: current asset state (for __eng + E2E checks) */
export function soldierState(): string { return asset.state }

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

/** create a per-player instance (only call when soldierReady()) */
export function createSoldier(team: TeamId): GlbInstance {
  const proto = asset.proto!
  const clips = asset.clips!
  const model = skeletonClone(proto) as THREE.Group

  const bodyT = asset.teamBody[team]!
  const visorT = asset.teamVisor[team] ?? bodyT
  const swap = (mat: THREE.Material) =>
    mat === asset.bodyMat ? bodyT : mat === asset.visorMat ? visorT : mat
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.frustumCulled = false // skinned bounds are unreliable; never cull
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material)
  })

  const mixer = new THREE.AnimationMixer(model)
  // all three actions play permanently; blend weights are driven manually in players.ts
  const mk = (clip: THREE.AnimationClip) => {
    const a = mixer.clipAction(clip)
    a.enabled = true
    a.setEffectiveTimeScale(1)
    a.setEffectiveWeight(0)
    a.play()
    return a
  }
  const actions = { idle: mk(clips.idle), walk: mk(clips.walk), run: mk(clips.run) }

  // three's GLTFLoader sanitizes node names (strips ':'), so look up both forms
  const bone = (n: string) => (model.getObjectByName(n) ?? model.getObjectByName(n.replace(/:/g, ''))) as THREE.Object3D | null
  const wanted = ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2', 'mixamorig:Neck', 'mixamorig:Head', 'mixamorig:RightHand', 'mixamorig:RightUpLeg', 'mixamorig:LeftUpLeg', 'mixamorig:RightLeg', 'mixamorig:LeftLeg']
  const missing = wanted.filter(n => !bone(n))
  if (missing.length) console.warn('[glbmodels] missing bones after clone:', missing.join(','))
  const bones: GlbBones = {
    hips: bone('mixamorig:Hips')!,
    spine: bone('mixamorig:Spine')!,
    spine1: bone('mixamorig:Spine1')!,
    spine2: bone('mixamorig:Spine2')!,
    neck: bone('mixamorig:Neck')!,
    head: bone('mixamorig:Head')!,
    handR: bone('mixamorig:RightHand')!,
    thighR: bone('mixamorig:RightUpLeg')!,
    thighL: bone('mixamorig:LeftUpLeg')!,
    calfR: bone('mixamorig:RightLeg')!,
    calfL: bone('mixamorig:LeftLeg')!,
  }

  // gun rig on the right hand
  const gunRig = new THREE.Group()
  gunRig.position.copy(GUN_HAND_POS)
  gunRig.rotation.copy(GUN_HAND_ROT)
  bones.handR.add(gunRig)

  // C4 on the upper back
  const c4 = buildC4()
  c4.position.set(-0.05, 0.12, 0.14)
  c4.rotation.y = Math.PI
  bones.spine1.add(c4)

  // wrapper: scale + grounding + orientation (Mixamo faces -Z already, matching our yaw 0)
  const wrap = new THREE.Group()
  model.scale.setScalar(asset.scale)
  model.position.y = asset.groundY
  wrap.add(model)

  return { model: wrap, mixer, actions, bones, gunRig, c4, current: 'idle', weights: { idle: 1, walk: 0, run: 0 }, wasAlive: true }
}
