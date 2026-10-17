// Remote player rendering: GLB Vanguard soldier (primary) + procedural fallback rig,
// hitboxes + snapshot interpolation.
// Model faces -Z at yaw 0 (same convention as the local camera).
import * as THREE from 'three'
import { soldierCamo, soldierVest, soldierFace } from './textures'
import { buildRemoteGun } from './weaponmodels'
import { preloadSoldier, soldierReady, createSoldier, type GlbInstance } from './glbmodels'
import type { TeamId } from './weapons'

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
  // rig + animation state (GLB rig when loaded, procedural fallback otherwise)
  rig: SoldierRig | null
  glb: GlbInstance | null
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

  /** kick off the GLB asset load; upgrades existing procedural players once ready */
  preloadModels(): void {
    void preloadSoldier().then(() => {
      if (!soldierReady()) return
      for (const p of this.players.values()) {
        if (!p.glb && p.rig) this.upgradeToGlb(p)
      }
    })
  }

  private upgradeToGlb(p: RemotePlayer) {
    const rig = p.rig
    if (!rig) return
    const glb = createSoldier(p.team)
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
    const hb = buildHitboxes(id)
    root.add(hb[0], hb[1], hb[2])

    let rig: SoldierRig | null = null
    let glb: GlbInstance | null = null
    if (soldierReady()) {
      glb = createSoldier(team)
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

    const gunStub = buildRemoteGun('knife')
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
    p.gunStub = buildRemoteGun(weapon)
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
      p.phase += p.speed * dt * 1.9

      // crouch blend (hitboxes follow the legacy 0.68 scale endpoints)
      const cTarget = (b.crouch && p.alive) ? 1 : 0
      p.crouchT += (cTarget - p.crouchT) * Math.min(1, dt * 9)
      const ct = p.crouchT
      const wa = amp * (1 - 0.55 * ct) // walk amplitude fades while crouched

      if (p.alive) {
        // fall reset
        p.root.rotation.x = 0
        p.root.rotation.z = 0

        if (g) {
          this.driveGlb(g, dt, p.speed, pitch, ct)
        } else if (r) {
        // hips height + double-step bob
        r.hips.position.y = lerp(HIPS_STAND, HIPS_CROUCH, ct) + Math.sin(p.phase * 2) * 0.024 * wa

        // legs: base crouch pose + stride
        const thighBase = 1.35 * ct
        const kneeBase = 2.30 * ct
        r.thighR.rotation.x = thighBase + Math.sin(p.phase) * 0.55 * wa
        r.thighL.rotation.x = thighBase + Math.sin(p.phase + Math.PI) * 0.55 * wa
        r.calfR.rotation.x = -kneeBase - Math.max(0, Math.sin(p.phase + 2.5)) * 0.85 * wa
        r.calfL.rotation.x = -kneeBase - Math.max(0, Math.sin(p.phase + Math.PI + 2.5)) * 0.85 * wa
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
        const rot = 1.52 * easeOutCubic(t) * p.fallSign
        if (p.fallAxis === 'x') { p.root.rotation.x = rot; p.root.rotation.z = 0 } else { p.root.rotation.z = rot; p.root.rotation.x = 0 }
        p.root.position.y = y + 0.04 * t
        if (g) {
          // GLB rig: freeze in the death-moment pose — do NOT stopAllAction()
          // (stopping restores raw bind-state bone values that mismatch the skin and collapse the mesh)
          g.wasAlive = false
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

  /** GLB rig: Idle/Walk/Run manual weight blending from live speed + post-mixer aim-pitch/crouch bone overrides. */
  private driveGlb(g: GlbInstance, dt: number, speed: number, pitch: number, ct: number) {
    if (!g.wasAlive) {
      // respawned: just reset the blend (actions kept running, bones were frozen mid-pose while dead)
      g.wasAlive = true
      g.current = 'idle'
      g.weights = { idle: 1, walk: 0, run: 0 }
    }
    g.mixer.update(dt)

    // clip choice from live speed — with hysteresis so speed jitter never flaps the selection
    let want: 'idle' | 'walk' | 'run'
    if (g.current === 'idle') want = speed > 0.9 ? (speed > 4.3 ? 'run' : 'walk') : 'idle'
    else if (g.current === 'walk') want = speed < 0.5 ? 'idle' : (speed > 4.3 ? 'run' : 'walk')
    else want = speed < 3.4 ? (speed < 0.5 ? 'idle' : 'walk') : 'run'
    g.current = want

    // manual blend weights: exponential approach to the target (frame-rate independent, no mixer fades)
    const k = Math.min(1, dt * 9)
    g.weights.idle += ((want === 'idle' ? 1 : 0) - g.weights.idle) * k
    g.weights.walk += ((want === 'walk' ? 1 : 0) - g.weights.walk) * k
    g.weights.run += ((want === 'run' ? 1 : 0) - g.weights.run) * k
    g.actions.idle.setEffectiveWeight(g.weights.idle)
    g.actions.walk.setEffectiveWeight(g.weights.walk)
    g.actions.run.setEffectiveWeight(g.weights.run)

    // clip playback rate tracks the real speed (walk ~1.55 m/s, run ~4.2 m/s natural)
    if (g.weights.walk > 0.01) g.actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 1.55, 0.65, 1.7))
    if (g.weights.run > 0.01) g.actions.run.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 4.2, 0.7, 1.5))

    // post-mixer additive overrides (mixer writes the clip pose first, these stack on top)
    const b = g.bones
    b.spine.rotation.x += pitch * 0.22
    b.spine1.rotation.x += pitch * 0.22 + 0.2 * ct
    b.spine2.rotation.x += pitch * 0.18
    b.neck.rotation.x += pitch * 0.18
    b.head.rotation.x += pitch * 0.2
    if (ct > 0.01) {
      b.hips.position.y -= 0.44 * ct
      b.thighR.rotation.x += 1.0 * ct
      b.thighL.rotation.x += 0.95 * ct
      b.calfR.rotation.x -= 1.75 * ct
      b.calfL.rotation.x -= 1.7 * ct
    }
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
