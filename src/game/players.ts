// Remote player rendering: auto-rigged user character model (primary) + procedural fallback rig,
// hitboxes + snapshot interpolation.
// Model faces -Z at yaw 0 (same convention as the local camera).
import * as THREE from 'three'
import { soldierCamo, soldierVest, soldierFace } from './textures'
import { buildRemoteGun } from './weaponmodels'
import { preloadUserModel, userModelReady, createUserModel, type UserInstance, type ArmChain } from './usermodel'
import { preloadWeaponModels, buildGLBRemoteGun } from './weapongltf'
import { WEAPONS, type TeamId } from './weapons'

export interface RemotePlayer {
  id: string
  name: string
  team: TeamId
  bot: boolean
  alive: boolean
  hp: number
  // root transform (feet position)
  root: THREE.Group
  gunStub: THREE.Group
  nameSprite: THREE.Sprite | null
  // hitboxes (invisible, raycastable) — kept identical to legacy dims
  hbHead: THREE.Mesh
  hbBody: THREE.Mesh
  hbLegs: THREE.Mesh
  // interpolation buffer
  buf: Array<{ t: number; x: number; y: number; z: number; yaw: number; pitch: number; crouch: boolean }>
  kills: number
  deaths: number
  money: number
  weapon: string
  hasBomb: boolean
  deathAt: number
  // rig + animation state (user auto-rig when loaded, procedural fallback otherwise)
  rig: SoldierRig | null
  glb: UserInstance | null
  phase: number
  speed: number
  crouchT: number
  lastX: number
  lastZ: number
  lastT: number
  fallAxis: 'x' | 'z'
  fallSign: number
}

interface SoldierRig {
  hips: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  foreL: THREE.Group
  foreR: THREE.Group
  thighL: THREE.Group
  thighR: THREE.Group
  calfL: THREE.Group
  calfR: THREE.Group
  bootL: THREE.Mesh
  bootR: THREE.Mesh
  gunRig: THREE.Group
  c4: THREE.Group
}

// ------------------------------------------------------------------ shared geometry
const G_TORSO = new THREE.BoxGeometry(0.46, 0.60, 0.28)
const G_VEST = new THREE.BoxGeometry(0.50, 0.40, 0.34)
const G_POUCH = new THREE.BoxGeometry(0.085, 0.12, 0.04)
const G_HEAD = new THREE.BoxGeometry(0.22, 0.24, 0.24)
const G_HELMET = new THREE.SphereGeometry(0.152, 14, 10)
const G_BEANIE = new THREE.CylinderGeometry(0.132, 0.145, 0.10, 12)
const G_GOGGLE = new THREE.BoxGeometry(0.23, 0.045, 0.03)
const G_UPARM = new THREE.BoxGeometry(0.11, 0.30, 0.12)
const G_FOREARM = new THREE.BoxGeometry(0.095, 0.26, 0.10)
const G_HAND = new THREE.BoxGeometry(0.08, 0.09, 0.09)
const G_THIGH = new THREE.BoxGeometry(0.17, 0.42, 0.19)
const G_CALF = new THREE.BoxGeometry(0.14, 0.40, 0.16)
const G_BOOT = new THREE.BoxGeometry(0.15, 0.12, 0.25)
const G_C4 = new THREE.BoxGeometry(0.11, 0.15, 0.05)

const SKIN = { CT: 0xc9a17c, T: 0xb58a63 }
const MASK = { CT: 0x2c333d, T: 0x6e5d40 }

// materials cached per team
const matCache = new Map<string, THREE.MeshLambertMaterial>()
function teamMat(key: string, make: () => THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  const hit = matCache.get(key)
  if (hit) return hit
  const m = make()
  matCache.set(key, m)
  return m
}

const HIPS_STAND = 0.92
const HIPS_CROUCH = 0.46
const GUN_LOCAL = new THREE.Vector3(0.09, 0.42, -0.30)

// ------------------------------------------------------------------ Task 114: gun-hold IK
// "characters are not holding the weapon in hands" — the staged soldier's
// forearm (joint→fist 0.36 m) is far longer than the retired Vanguard model's
// (0.22 m) the old hand anchor + FK arm poses were tuned against, so the gun
// grip floated ~15 cm up the forearm at chin height, stock clipping the
// backpack, fists gripping air. Fix: per-frame 2-bone analytic IK solved in
// TORSO-LOCAL space — the right fist is driven ONTO the grip target, the left
// fist onto the handguard (clamped at full extension — the model's short
// total arm reach (0.63 m) puts the fingertips on it, which reads as
// contact), and the gunRig ORIENTATION is set directly so the gun axis is
// locked to the carriage direction (idle cant blended toward the bot's look
// direction) regardless of where the elbow swings.
// Task 115: the arm chains moved INTO each UserInstance (g.armR / g.armL) —
// the soldier and the rebel have different measured proportions, so a module
// -level pair of chains would solve one model's arms against the other's
// pivots. The ArmChain type + mkChain live in usermodel.ts next to the specs.

/** Solve one arm: bone quaternions that put the FIST on `target`.
 * `pole` biases the elbow (direction from the shoulder→fist line toward the
 * elbow). Targets beyond reach clamp to full extension pointing at the target. */
function solveArm(c: ArmChain, target: THREE.Vector3, pole: THREE.Vector3,
                  qUpper: THREE.Quaternion, qFore: THREE.Quaternion): void {
  const sw = target.clone().sub(c.S)
  let D = sw.length()
  const dmax = c.L1 + c.L2 - 0.004
  if (D > dmax) D = dmax
  else if (D < 0.06) D = 0.06
  const dsw = sw.normalize()
  const h = (D * D + c.L1 * c.L1 - c.L2 * c.L2) / (2 * D)
  const a = Math.sqrt(Math.max(0, c.L1 * c.L1 - h * h))
  const pp = pole.clone().addScaledVector(dsw, -pole.dot(dsw))
  if (pp.lengthSq() < 1e-8) pp.set(0, -1, 0).addScaledVector(dsw, dsw.y)
  pp.normalize()
  const elbow = c.S.clone().addScaledVector(dsw, h).addScaledVector(pp, a)
  const e1 = elbow.clone().sub(c.S).normalize()
  const w1 = target.clone().sub(elbow).normalize()
  qUpper.setFromUnitVectors(c.e0, e1)
  // forearm is a CHILD of the upper arm: its local rotation must map the bind
  // forearm dir to the desired one EXPRESSED IN THE UPPER-ARM'S FRAME
  const w1Local = w1.applyQuaternion(qUpper.clone().invert())
  qFore.setFromUnitVectors(c.w0, w1Local)
}

/** weapon-carriage parameters, all torso-local, LIVE-TUNABLE via __eng.hold() */
export const HOLD = {
  // slot 1 (rifles / primaries): right fist on the grip, left fist out on the
  // handguard. Support 0.17 is at the model's fingertip reach — deliberate.
  rifle: { gripX: 0.16, gripY: 0.01, gripZ: -0.30, dirX: -0.14, dirY: -0.05, dirZ: -1, support: 0.17, supportDropY: 0.02 },
  // slot 2 (pistols): both fists together in front of the chest
  pistol: { gripX: 0.11, gripY: 0.05, gripZ: -0.28, dirX: -0.03, dirY: 0.0, dirZ: -1, leftX: -0.06, leftY: -0.07, leftZ: 0.02 },
  // slot 3+ (knife / grenades / C4): low right-hand carry, left arm relaxed
  knife: { gripX: 0.17, gripY: -0.05, gripZ: -0.24, dirX: 0.08, dirY: -0.30, dirZ: -1, leftX: -0.24, leftY: -0.24, leftZ: -0.10 },
  // gun origin offset from the fist anchor (hand-local: +Y toward elbow, −Z muzzle side)
  gunOX: 0, gunOY: 0.02, gunOZ: 0.01,
  cant: 0.10,        // gun roll (rad) — slight CS-style cant
  aimBlend: 0.85,    // 0 = idle carriage dir, 1 = full look-direction
  pitchLift: 0.10,   // grip rises this much per rad of aim pitch
  poleTilt: 0.45,    // elbow tucks back per rad of aim pitch
  swayX: 0.012, bobY: 0.008, // walk sway glued to BOTH fist targets
  crouchTuckY: 0.05,
  poleRX: 0.10, poleRY: -1, poleRZ: 0.30,   // right elbow: down + slightly back
  poleLX: -0.55, poleLY: -1, poleLZ: 0.10,   // left elbow: down + out
}

function weaponSlot(w: string): number {
  return (WEAPONS as Record<string, { slot?: number } | undefined>)[w]?.slot ?? 3
}

/** active carriage params for a weapon id (shared with the __eng probes) */
export function carriageFor(weapon: string) {
  const slot = weaponSlot(weapon)
  return slot === 1 ? HOLD.rifle : slot === 2 ? HOLD.pistol : HOLD.knife
}

// scratch (hot path — driveUser runs per player per frame)
const _AX = new THREE.Vector3(1, 0, 0)
const _AZ = new THREE.Vector3(0, 0, 1)
const _UP = new THREE.Vector3(0, 1, 0)
const _ORIGIN = new THREE.Vector3(0, 0, 0)
const _dir = new THREE.Vector3()
const _look = new THREE.Vector3()
const _grip = new THREE.Vector3()
const _left = new THREE.Vector3()
const _poleR = new THREE.Vector3()
const _poleL = new THREE.Vector3()
const _qU = new THREE.Quaternion()
const _qF = new THREE.Quaternion()
const _qT = new THREE.Quaternion()
const _qGun = new THREE.Quaternion()
const _mLook = new THREE.Matrix4()

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3) }

function nameSpriteTex(name: string, team: TeamId): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 64
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 34px "Arial Narrow", sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 8, 256, 48)
  ctx.fillStyle = team === 'CT' ? '#9ec9ee' : '#f0c878'
  ctx.fillText(name.slice(0, 14), 128, 32)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Invisible hitboxes (legacy dims: head sphere r .17 @1.62, body .62x.85x.42 @1.15, legs .5x.82x.36 @0.4). */
function buildHitboxes(id: string): THREE.Mesh[] {
  const hbMat = new THREE.MeshBasicMaterial({ visible: false })
  const hbHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), hbMat)
  hbHead.position.y = 1.62
  hbHead.userData = { pid: id, part: 'head' }
  const hbBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.42), hbMat)
  hbBody.position.y = 1.15
  hbBody.userData = { pid: id, part: 'body' }
  const hbLegs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.82, 0.36), hbMat)
  hbLegs.position.y = 0.4
  hbLegs.userData = { pid: id, part: 'legs' }
  return [hbHead, hbBody, hbLegs]
}

/** Builds the articulated procedural soldier rig (fallback). Feet at hips origin, head center ~1.62. */
function buildSoldierRig(team: TeamId): SoldierRig {
  const camo = teamMat(`camo-${team}`, () => new THREE.MeshLambertMaterial({ map: soldierCamo(team) }))
  const vest = teamMat(`vest-${team}`, () => new THREE.MeshLambertMaterial({ map: soldierVest(team) }))
  const sideMats = [camo, camo, camo, camo, camo, vest] // +x,-x,+y,-y,+z(back),-z(FRONT)
  const torsoMesh = new THREE.Mesh(G_TORSO, sideMats)
  torsoMesh.position.y = 0.30
  const maskMat = teamMat(`mask-${team}`, () => new THREE.MeshLambertMaterial({ color: MASK[team] }))
  const skinMat = teamMat(`skin-${team}`, () => new THREE.MeshLambertMaterial({ color: SKIN[team] }))
  const faceMat = teamMat(`face-${team}`, () => new THREE.MeshLambertMaterial({ map: soldierFace(team) }))
  const headMesh = new THREE.Mesh(G_HEAD, [maskMat, maskMat, maskMat, skinMat, maskMat, faceMat])
  headMesh.position.y = 0.09
  const helmetMat = teamMat(`helm-${team}`, () => new THREE.MeshLambertMaterial({ color: team === 'CT' ? 0x3b4650 : 0x453a2a }))
  const helmet = new THREE.Mesh(G_HELMET, helmetMat)
  helmet.scale.set(1, 0.74, 1.1)
  helmet.position.y = 0.205
  const darkMat = teamMat('dark', () => new THREE.MeshLambertMaterial({ color: 0x14171a }))
  const goggle = new THREE.Mesh(G_GOGGLE, darkMat)
  goggle.position.set(0, 0.115, -0.125)
  const vestMesh = new THREE.Mesh(G_VEST, teamMat(`vestbox-${team}`, () => new THREE.MeshLambertMaterial({ color: team === 'CT' ? 0x2b3036 : 0x40372a })))
  vestMesh.position.set(0, 0.34, 0)
  const pouchMat = teamMat(`pouch-${team}`, () => new THREE.MeshLambertMaterial({ color: team === 'CT' ? 0x353b41 : 0x4a3f2e }))
  const pouches: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(G_POUCH, pouchMat)
    p.position.set(-0.13 + i * 0.13, 0.24, -0.19)
    pouches.push(p)
  }
  const bootMat = teamMat('boot', () => new THREE.MeshLambertMaterial({ color: 0x241d18 }))

  const hips = new THREE.Group()
  hips.position.y = HIPS_STAND

  // ---- torso
  const torso = new THREE.Group()
  hips.add(torso)
  torso.add(torsoMesh, vestMesh, goggle)
  torso.add(...pouches)

  // ---- head
  const head = new THREE.Group()
  head.position.y = 0.62
  torso.add(head)
  head.add(headMesh)
  if (team === 'CT') { head.add(helmet) } else {
    const beanie = new THREE.Mesh(G_BEANIE, helmetMat)
    beanie.position.y = 0.16
    head.add(beanie)
  }

  // ---- arms (ready pose; walk sway applied in update)
  function arm(side: 1 | -1) {
    const upper = new THREE.Group()
    upper.position.set(0.185 * side, 0.54, 0)
    const um = new THREE.Mesh(G_UPARM, camo)
    um.position.y = -0.13
    upper.add(um)
    const fore = new THREE.Group()
    fore.position.y = -0.27
    const fm = new THREE.Mesh(G_FOREARM, camo)
    fm.position.y = -0.12
    const hand = new THREE.Mesh(G_HAND, skinMat)
    hand.position.set(0, -0.27, 0.015)
    fore.add(fm, hand)
    upper.add(fore)
    torso.add(upper)
    return { upper, fore }
  }
  const aR = arm(1)
  const aL = arm(-1)
  aR.upper.rotation.set(0.72, 0, -0.10)
  aR.fore.rotation.set(0.55, 0, 0)
  aL.upper.rotation.set(0.95, 0, 0.28)
  aL.fore.rotation.set(0.62, 0, 0.30)

  // ---- gun rig (chest height, aims -Z, pitch animated)
  const gunRig = new THREE.Group()
  gunRig.position.copy(GUN_LOCAL)
  gunRig.rotation.set(0.02, 0.05, 0)
  torso.add(gunRig)

  // ---- C4 on the back
  const c4 = new THREE.Group()
  const c4box = new THREE.Mesh(G_C4, teamMat('c4', () => new THREE.MeshLambertMaterial({ color: 0x8a2020 })))
  const led = new THREE.Mesh(G_GOGGLE, teamMat('c4led', () => new THREE.MeshLambertMaterial({ color: 0x11ff44 })))
  led.scale.set(0.08, 0.08, 0.5)
  led.position.set(0.03, 0.06, 0.03)
  c4.add(c4box, led)
  c4.position.set(0, 0.34, 0.20)
  c4.visible = false
  torso.add(c4)

  // ---- legs
  function leg(side: 1 | -1) {
    const thigh = new THREE.Group()
    thigh.position.set(0.115 * side, -0.02, 0)
    const tm = new THREE.Mesh(G_THIGH, camo)
    tm.position.y = -0.20
    thigh.add(tm)
    const calf = new THREE.Group()
    calf.position.y = -0.40
    const cm = new THREE.Mesh(G_CALF, camo)
    cm.position.y = -0.19
    const boot = new THREE.Mesh(G_BOOT, bootMat)
    boot.position.set(0, -0.37, -0.045)
    calf.add(cm, boot)
    thigh.add(calf)
    hips.add(thigh)
    return { thigh, calf, boot }
  }
  const lR = leg(1)
  const lL = leg(-1)

  for (const m of [torsoMesh, vestMesh, headMesh, helmet, ...pouches, lR.thigh.children[0] as THREE.Mesh, lL.thigh.children[0] as THREE.Mesh, lR.calf.children[0] as THREE.Mesh, lL.calf.children[0] as THREE.Mesh]) m.castShadow = true

  const rig: SoldierRig = {
    hips, torso, head,
    armL: aL.upper, armR: aR.upper, foreL: aL.fore, foreR: aR.fore,
    thighL: lL.thigh, thighR: lR.thigh, calfL: lL.calf, calfR: lR.calf,
    bootL: lL.boot, bootR: lR.boot, gunRig, c4,
  }
  return rig
}

export class PlayerManager {
  players = new Map<string, RemotePlayer>()
  private scene: THREE.Scene
  private myTeam: TeamId

  constructor(scene: THREE.Scene, myTeam: TeamId) {
    this.scene = scene
    this.myTeam = myTeam
  }

  setMyTeam(t: TeamId) { this.myTeam = t }

  /**
   * Kick off the user-model asset load; upgrades existing procedural players
   * once ready. Also warms the staged weapon GLBs (remote guns): when they
   * finish parsing, every player's gun stub is rebuilt — GLB-first, with
   * the procedural stub staying as fallback for ids that aren't staged.
   */
  preloadModels(): void {
    // per-team: each team upgrades the moment ITS model lands (the rebel is
    // 2× the soldier's bytes — CT players must not wait for it)
    for (const team of ['CT', 'T'] as TeamId[]) {
      void preloadUserModel(team).then(() => {
        if (!userModelReady(team)) return
        for (const p of this.players.values()) {
          if (p.team === team && !p.glb && p.rig) this.upgradeToGlb(p)
        }
      })
    }
    void preloadWeaponModels().then(() => this.refreshGuns())
  }

  /** rebuild every remote gun (GLB-first after the weapon preload lands) */
  refreshGuns(): void {
    for (const p of this.players.values()) {
      const parent = p.glb ? p.glb.gunRig : p.rig?.gunRig
      if (!parent) continue
      parent.remove(p.gunStub)
      p.gunStub = buildGLBRemoteGun(p.weapon) ?? buildRemoteGun(p.weapon)
      parent.add(p.gunStub)
    }
  }

  private upgradeToGlb(p: RemotePlayer) {
    const rig = p.rig
    if (!rig) return
    if (!userModelReady(p.team)) return   // Task 115: per-team readiness (T counts the soldier fallback)
    const glb = createUserModel(p.team)
    p.rig = null
    p.glb = glb
    p.root.remove(rig.hips)
    rig.gunRig.remove(p.gunStub)
    glb.gunRig.add(p.gunStub)
    p.root.add(glb.model)
  }

  /** debug/E2E: force-upgrade all procedural players now; returns per-player errors */
  upgradeAllNow(): Array<{ id: string; ok: boolean; err?: string }> {
    const out: Array<{ id: string; ok: boolean; err?: string }> = []
    for (const p of this.players.values()) {
      if (p.glb || !p.rig) { out.push({ id: p.id, ok: true }); continue }
      try {
        this.upgradeToGlb(p)
        out.push({ id: p.id, ok: !!p.glb })
      } catch (e) {
        out.push({ id: p.id, ok: false, err: String(e) })
      }
    }
    return out
  }

  getOrCreate(id: string, name: string, team: TeamId, bot: boolean): RemotePlayer {
    let p = this.players.get(id)
    if (p) return p
    const root = new THREE.Group()
    // YXZ (yaw-outermost): the alive path only uses rotation.y (order-agnostic),
    // but the Task-113 death fall tips the root about x — with XYZ that tip
    // composes OUTSIDE the yaw and every corpse would collapse toward a
    // world-fixed direction; YXZ keeps the fall facing-relative (forward/back).
    root.rotation.order = 'YXZ'
    const hb = buildHitboxes(id)
    root.add(hb[0], hb[1], hb[2])

    let rig: SoldierRig | null = null
    let glb: UserInstance | null = null
    if (userModelReady(team)) {
      glb = createUserModel(team)
      root.add(glb.model)
    } else {
      rig = buildSoldierRig(team)
      root.add(rig.hips)
    }

    // nametag only for teammates
    let sprite: THREE.Sprite | null = null
    if (team === this.myTeam && !bot) {
      const tex = nameSpriteTex(name, team)
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
      sprite.scale.set(1.6, 0.4, 1)
      sprite.position.y = 2.12
      root.add(sprite)
    }

    const gunStub = buildGLBRemoteGun('knife') ?? buildRemoteGun('knife')
    ;(glb ? glb.gunRig : rig!.gunRig).add(gunStub)

    this.scene.add(root)
    p = {
      id, name, team, bot, alive: true, hp: 100,
      root, gunStub, nameSprite: sprite,
      hbHead: hb[0], hbBody: hb[1], hbLegs: hb[2],
      buf: [], kills: 0, deaths: 0, money: 0, weapon: 'knife', hasBomb: false,
      deathAt: 0,
      rig, glb,
      phase: Math.random() * Math.PI * 2, speed: 0, crouchT: 0,
      lastX: 0, lastZ: 0, lastT: 0,
      fallAxis: Math.random() < 0.55 ? 'x' : 'z',
      fallSign: Math.random() < 0.5 ? 1 : -1,
    }
    this.players.set(id, p)
    return p
  }

  remove(id: string) {
    const p = this.players.get(id)
    if (!p) return
    this.scene.remove(p.root)
    this.players.delete(id)
  }

  /** swap the visible gun when a player switches weapons */
  setGun(id: string, weapon: string) {
    const p = this.players.get(id)
    if (!p || p.weapon === weapon) return
    p.weapon = weapon
    const parent = p.glb ? p.glb.gunRig : p.rig!.gunRig
    parent.remove(p.gunStub)
    p.gunStub = buildGLBRemoteGun(weapon) ?? buildRemoteGun(weapon)
    parent.add(p.gunStub)
  }

  pushSnapshot(id: string, t: number, x: number, y: number, z: number, yaw: number, pitch: number, crouch: boolean) {
    const p = this.players.get(id)
    if (!p) return
    p.buf.push({ t, x, y, z, yaw, pitch, crouch })
    if (p.buf.length > 12) p.buf.shift()
  }

  /** interpolate at render time + drive all animation */
  update(renderT: number, myId: string) {
    const delay = 130
    const target = renderT - delay
    const now = performance.now()
    for (const p of this.players.values()) {
      if (p.id === myId) continue
      const buf = p.buf
      if (!buf.length) continue
      let a = buf[0], b = buf[buf.length - 1]
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= target && buf[i + 1].t >= target) { a = buf[i]; b = buf[i + 1]; break }
      }
      const span = Math.max(1, b.t - a.t)
      let k = Math.min(1.2, Math.max(0, (target - a.t) / span))
      // yaw lerp shortest
      let dy = b.yaw - a.yaw
      while (dy > Math.PI) dy -= 2 * Math.PI
      while (dy < -Math.PI) dy += 2 * Math.PI
      const x = a.x + (b.x - a.x) * k
      const y = a.y + (b.y - a.y) * k
      const z = a.z + (b.z - a.z) * k
      const yaw = a.yaw + dy * k
      const pitch = Math.max(-1.35, Math.min(1.35, a.pitch + (b.pitch - a.pitch) * k))

      p.root.position.set(x, y, z)
      p.root.rotation.y = yaw
      const r = p.rig      // procedural fallback rig (null once the GLB rig is in)
      const g = p.glb      // GLB Vanguard rig (null until the asset loads)

      // dt + horizontal speed for the walk cycle
      const dt = Math.min(0.1, Math.max(0.001, (renderT - p.lastT) / 1000))
      if (p.lastT) {
        const inst = Math.hypot(x - p.lastX, z - p.lastZ) / dt
        p.speed = p.speed * 0.75 + (p.alive ? inst : 0) * 0.25
      }
      p.lastX = x; p.lastZ = z; p.lastT = renderT

      const amp = Math.min(1, p.speed / 5.2)
      // Task 123 — GROUND-MATCHED GAIT (fixes the "toddling steps" look):
      // the old law (phase += speed*dt*1.9) with a FIXED 0.55 rad hip swing
      // produced ~3.1 steps/s but only ~0.9 m of visual stride at the 4.8-5.0
      // m/s run speed — feet slid while the body glided = mincing/toddling.
      // Human gait: cadence saturates with speed while stride keeps growing.
      // New law: cycles/s = 1.05 + 0.105*speed → walk 1.4 m/s = 2.4 steps/s,
      // run 4.9 m/s = 3.1 steps/s (cadence barely changes at run; it was the
      // tiny fixed stride that read as toddling).
      p.phase += (6.6 + 0.66 * p.speed) * dt

      // crouch blend (hitboxes follow the legacy 0.68 scale endpoints)
      const cTarget = (b.crouch && p.alive) ? 1 : 0
      p.crouchT += (cTarget - p.crouchT) * Math.min(1, dt * 9)
      const ct = p.crouchT
      const wa = amp * (1 - 0.55 * ct) // walk amplitude fades while crouched
      // Task 123 stride amplitude (rad of hip swing), speed-scaled so the
      // step length matches ground speed: ~0.29 rad walk / 0.85 rad sprint
      // → step ~0.5 m at 1.4 m/s, ~1.33 m at 4.9 m/s (feet stop sliding);
      // crouch fades it exactly like wa. Cap 0.85 not 0.95: VLM live check
      // saw hip-band mesh stretch at the most extreme swing on the unrigged
      // procedural-weight meshes — 0.85 keeps the sprint read without it.
      const sa = Math.min(0.85, 0.20 * p.speed) * (1 - 0.55 * ct)

      if (p.alive) {
        // fall reset
        p.root.rotation.x = 0
        p.root.rotation.z = 0

        if (g) {
          this.driveUser(g, p.weapon, p.speed, pitch, ct, p.phase, now, wa, amp)
        } else if (r) {
        // hips height + double-step bob
        r.hips.position.y = lerp(HIPS_STAND, HIPS_CROUCH, ct) + Math.sin(p.phase * 2) * (0.014 + 0.018 * amp) * (1 - 0.55 * ct)

        // legs: base crouch pose + stride (Task 123: sa, not the fixed 0.55)
        const thighBase = 1.35 * ct
        const kneeBase = 2.30 * ct
        r.thighR.rotation.x = thighBase + Math.sin(p.phase) * sa
        r.thighL.rotation.x = thighBase + Math.sin(p.phase + Math.PI) * sa
        r.calfR.rotation.x = -kneeBase - Math.max(0, Math.sin(p.phase + 2.5)) * (1.30 * sa)
        r.calfL.rotation.x = -kneeBase - Math.max(0, Math.sin(p.phase + Math.PI + 2.5)) * (1.30 * sa)
        // boots stay near-flat
        r.bootR.rotation.x = -(r.thighR.rotation.x + r.calfR.rotation.x) * 0.55
        r.bootL.rotation.x = -(r.thighL.rotation.x + r.calfL.rotation.x) * 0.55

        // torso: forward lean w/ speed + crouch, shoulder counter-sway, idle breathing
        const breath = Math.sin(now * 0.0016) * 0.012
        r.torso.rotation.x = 0.05 + 0.10 * amp + 0.22 * ct + breath
        r.torso.rotation.y = Math.sin(p.phase) * 0.08 * wa

        // arms: ready pose + subtle stride sway
        r.armR.rotation.set(0.72 - 0.10 * ct + Math.sin(p.phase) * 0.06 * wa, 0, -0.10)
        r.foreR.rotation.set(0.55 + 0.25 * ct, 0, 0)
        r.armL.rotation.set(0.95 + 0.06 * ct + Math.sin(p.phase + Math.PI) * 0.06 * wa, 0, 0.28)
        r.foreL.rotation.set(0.62, 0, 0.30)

        // head + gun follow aim pitch; compensate torso pitch for the gun
        r.head.rotation.x = pitch * 0.6 - 0.06 * ct
        r.head.rotation.y = Math.sin(now * 0.0011) * 0.03 * (1 - amp)
        r.gunRig.rotation.x = 0.02 + pitch - r.torso.rotation.x * 0.85
        r.gunRig.position.y = GUN_LOCAL.y - 0.30 * ct + Math.sin(p.phase * 2) * 0.006 * wa
        }

        // hitboxes: legacy positions, crouch-scaled
        p.hbHead.position.y = lerp(1.62, 1.10, ct)
        p.hbBody.position.y = lerp(1.15, 0.78, ct)
        p.hbLegs.position.y = 0.4
        p.hbHead.visible = true
        p.hbBody.visible = true
        p.hbLegs.visible = true

        const c4 = g ? g.c4 : r!.c4
        c4.visible = p.hasBomb
        if (p.nameSprite) p.nameSprite.visible = true
      } else {
        // death: tip over around the feet, ease out over 0.55 s
        const since = (now - p.deathAt) / 1000
        const t = Math.min(1, since / 0.55)
        // Task 113: FORWARD/BACKWARD falls only (fallAxis forced to x). The
        // soldier silhouette is 1.08 m wide at the shoulders (armor pads at
        // |x| 0.54 — measured in the staged GLB), so a SIDEWAYS fall rotates
        // that width into the vertical: a ~1 m tall corpse slab sunk ~0.4 m
        // through the floor — the "dead body reads as a monster" report.
        // Tipping forward/back lays the ~0.54 m body depth down instead.
        // DEATH_LIFT: the fall pivots on the skeleton axis, which floats
        // ~0.26 m above the lying surface (vest + backpack bulk) — lift the
        // root so the fallen body RESTS on its back/chest, not inside the floor.
        const rot = 1.52 * easeOutCubic(t) * p.fallSign
        p.root.rotation.x = rot
        p.root.rotation.z = 0
        p.root.position.y = y + (0.04 + 0.26) * t
        if (g) {
          // Task 113 death-pose fix: the old "freeze at the death-moment pose"
          // left weapon-ready arms + mid-stride legs pointing FORWARD in
          // standing space — once the root tips ~87°, forward becomes DOWN,
          // so limbs punched through the floor (measured skinned bbox sank to
          // y = -0.65) and corpses read as mangled "monsters". Ease every bone
          // toward a relaxed at-attention rest pose during the same 0.55 s
          // fall: arms hang at the sides, legs straighten — after the tip the
          // body lies flat along its length, nothing below ground.
          g.wasAlive = false
          const k = easeOutCubic(t)
          const b = g.bones
          // legs straighten with a small natural spread
          b.thighR.rotation.x = lerp(b.thighR.rotation.x, 0.06, k)
          b.thighL.rotation.x = lerp(b.thighL.rotation.x, -0.04, k)
          b.shinR.rotation.x = lerp(b.shinR.rotation.x, -0.08, k)
          b.shinL.rotation.x = lerp(b.shinL.rotation.x, -0.05, k)
          // torso + head neutral
          b.torso.rotation.x = lerp(b.torso.rotation.x, -0.04, k)
          b.torso.rotation.y = lerp(b.torso.rotation.y, 0, k)
          b.head.rotation.x = lerp(b.head.rotation.x, 0, k)
          // arms relax to the sides (they lie along the body after the tip)
          b.armR.rotation.x = lerp(b.armR.rotation.x, 0.15, k)
          b.armR.rotation.y = lerp(b.armR.rotation.y, 0, k)
          b.armR.rotation.z = lerp(b.armR.rotation.z, -0.06, k)
          b.foreR.rotation.x = lerp(b.foreR.rotation.x, 0.12, k)
          b.armL.rotation.x = lerp(b.armL.rotation.x, 0.15, k)
          b.armL.rotation.y = lerp(b.armL.rotation.y, 0, k)
          b.armL.rotation.z = lerp(b.armL.rotation.z, 0.06, k)
          b.foreL.rotation.x = lerp(b.foreL.rotation.x, 0.12, k)
        } else if (r) {
        // limp limbs
        r.hips.position.y = lerp(HIPS_STAND, 0.72, t)
        r.torso.rotation.x = 0.10
        r.torso.rotation.y = 0
        r.armR.rotation.set(0.15, 0, -0.55 * t)
        r.foreR.rotation.set(0.10, 0, 0)
        r.armL.rotation.set(0.30, 0, 0.55 * t)
        r.foreL.rotation.set(0.10, 0, 0)
        r.thighR.rotation.x = 0.18 * t
        r.thighL.rotation.x = -0.12 * t
        r.calfR.rotation.x = -0.35 * t
        r.calfL.rotation.x = -0.15 * t
        r.gunRig.rotation.x = 0.3 * t
        }
        if (p.nameSprite) p.nameSprite.visible = false
        p.hbHead.visible = false
        p.hbBody.visible = false
        p.hbLegs.visible = false
      }
    }
  }

  /** User auto-rig: procedural bone drive from live speed / crouch / aim.
   *  Sign conventions: limbs extend -Y from their pivot → +rotation.x swings the tip FORWARD (-Z);
   *  torso & head extend +Y → -rotation.x leans FORWARD, +pitch (looking up) tips them BACK.
   *  Arms + gun (Task 114): 2-bone IK — see the HOLD block above the class. */
  private driveUser(g: UserInstance, weapon: string, speed: number, pitch: number, ct: number, phase: number, now: number, wa: number, amp: number) {
    const b = g.bones

    // Task 123 stride amplitude: hip swing in rad, speed-scaled to match ground
    // speed (walk ~0.29 / sprint ~0.85 — cap softened from 0.95 after the VLM
    // live check saw hip-band stretch at full extension), crouch-faded like
    // wa. The old fixed 0.55 read as "toddling" — quick mincing steps.
    const sa = Math.min(0.85, 0.20 * speed) * (1 - 0.55 * ct)

    // hips: crouch drop + double-step walk bob (run bounces harder)
    b.hips.position.y = lerp(0.95, 0.55, ct) + Math.sin(phase * 2) * (0.012 + 0.016 * amp) * (1 - 0.55 * ct)

    // legs: crouch fold + stride (sa knee drive follows the hip swing)
    const thighBase = 1.30 * ct
    const kneeBase = 2.25 * ct
    b.thighR.rotation.x = thighBase + Math.sin(phase) * sa
    b.thighL.rotation.x = thighBase + Math.sin(phase + Math.PI) * sa
    b.shinR.rotation.x = -kneeBase - Math.max(0, Math.sin(phase + 2.5)) * (1.30 * sa)
    b.shinL.rotation.x = -kneeBase - Math.max(0, Math.sin(phase + Math.PI + 2.5)) * (1.30 * sa)

    // torso: forward lean w/ speed + crouch (negative x), counter-sway, breathing; aim leans back
    const breath = Math.sin(now * 0.0016) * 0.012
    b.torso.rotation.x = -(0.06 + 0.10 * amp + 0.30 * ct) + pitch * 0.25 + breath
    b.torso.rotation.y = Math.sin(phase) * 0.08 * wa

    // head follows aim pitch (positive pitch = look up)
    b.head.rotation.x = pitch * 0.55 - 0.10 * ct

    // ---- arms + gun: Task 114 IK hold (must run AFTER the torso write so
    // b.torso.quaternion is current — the look-dir blend un-rotates it)
    this.holdWeapon(g, weapon, pitch, ct, phase, wa)
  }

  /** Task 114 IK weapon hold: both fists onto the gun, gun axis locked to the
   *  carriage direction. See the HOLD block above the class for parameters. */
  private holdWeapon(g: UserInstance, weapon: string, pitch: number, ct: number, phase: number, wa: number) {
    const C = carriageFor(weapon)
    const P = HOLD
    const b = g.bones

    // gun direction: idle cant blended toward where the bot actually looks
    // (look dir (0, sin p, −cos p) in root space → un-rotate the torso frame)
    _dir.set(C.dirX, C.dirY, C.dirZ).normalize()
    if (P.aimBlend > 0) {
      _look.set(0, Math.sin(pitch), -Math.cos(pitch))
      _qT.copy(b.torso.quaternion).invert()
      _look.applyQuaternion(_qT)
      _dir.lerp(_look, P.aimBlend).normalize()
    }

    // right-fist target = grip (+ aim lift, crouch tuck, glued walk sway/bob)
    _grip.set(C.gripX, C.gripY + P.pitchLift * pitch - P.crouchTuckY * ct, C.gripZ)
    _grip.x += Math.sin(phase) * P.swayX * wa
    _grip.y += Math.sin(phase * 2) * P.bobY * wa

    // right elbow pole: down + back, tucking further back as the bot aims up
    _poleR.set(P.poleRX, P.poleRY, P.poleRZ).normalize()
    _poleR.applyAxisAngle(_AX, -P.poleTilt * pitch)

    solveArm(g.armR, _grip, _poleR, _qU, _qF)
    b.armR.quaternion.copy(_qU)
    b.foreR.quaternion.copy(_qF)

    // gun orientation: locked DIRECTLY to the carriage direction (independent
    // of the elbow solution) — qGunRig = (qUpper·qFore)⁻¹ · qGunTorsoLocal
    _mLook.lookAt(_ORIGIN, _dir, _UP) // -Z → _dir, +Y ≈ torso up
    _qGun.setFromRotationMatrix(_mLook)
    if (P.cant) _qGun.multiply(_qT.setFromAxisAngle(_AZ, P.cant))
    _qT.copy(_qU).multiply(_qF).invert()
    g.gunRig.quaternion.copy(_qT).multiply(_qGun)
    g.gunRig.position.set(P.gunOX, P.gunOY, P.gunOZ)

    // left-fist target
    const slot = weaponSlot(weapon)
    if (slot === 1) {
      // support hand: out on the handguard, approaching from slightly below
      // (_grip already carries the walk sway/bob — the support hand rides it,
      // so it can never slide off the gun)
      _left.copy(_grip).addScaledVector(_dir, (C as typeof HOLD.rifle).support)
      _left.y -= (C as typeof HOLD.rifle).supportDropY
    } else if (slot === 2) {
      _left.set(_grip.x + (C as typeof HOLD.pistol).leftX,
        _grip.y + (C as typeof HOLD.pistol).leftY,
        _grip.z + (C as typeof HOLD.pistol).leftZ)
    } else {
      // relaxed hang carries its own counter-sway (grip-independent target)
      _left.set((C as typeof HOLD.knife).leftX + Math.sin(phase) * P.swayX * wa,
        (C as typeof HOLD.knife).leftY + Math.sin(phase * 2) * P.bobY * wa,
        (C as typeof HOLD.knife).leftZ)
    }
    _poleL.set(P.poleLX, P.poleLY, P.poleLZ).normalize()
    solveArm(g.armL, _left, _poleL, _qU, _qF)
    b.armL.quaternion.copy(_qU)
    b.foreL.quaternion.copy(_qF)
  }

  hitboxMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    for (const p of this.players.values()) {
      if (!p.alive) continue
      out.push(p.hbHead, p.hbBody, p.hbLegs)
    }
    return out
  }

  getById(id: string) { return this.players.get(id) }

  currentPos(id: string): THREE.Vector3 | null {
    const p = this.players.get(id)
    if (!p) return null
    return p.root.position.clone()
  }
}
