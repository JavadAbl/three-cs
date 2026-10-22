// CS2-clone game engine (client)
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { io } from 'socket.io-client'
import { WEAPONS, ECONOMY, ROUND, GEAR, fireModeOf, scopeLevelsOf, zoomFovOf, pelletsOf, pelletSpreadOf, accuracyRampOf } from './weapons'
import type { WeaponId, TeamId, HitPart } from './weapons'
import { pelletDirs } from '../../shared/pellets'
import { NADE } from '../../shared/grenades'
import type { GrenadeKind } from '../../shared/grenades'
import { MAPS } from './mapdata'
import type { MapDef, MapId } from './mapdata'
import { buildMap } from './mapview'
import { buildDetails } from './mapdetails'
import type { MapBuild } from './mapview'
import { PlayerManager } from './players'
import { Effects, buildBombMesh, buildNadeMesh, SmokeCloud, FireZone } from './fx'
import type { WorldFx } from './fx'
import { buildViewModel, vmBase, preloadWeaponTextures } from './weaponmodels'
import { pbrState } from './textures'
import { preloadWeaponModels, buildGLBKnifeVM, buildGLBGunVM, weaponModelsState, GLB_VM_SCALE } from './weapongltf'
import { userModelState } from './usermodel'
import type { ViewModel } from './weaponmodels'
import { audio } from './audio'

export interface KillFeedItem { killer: string; victim: string; weapon: string; hs: boolean; killerTeam: string; victimTeam: string; t: number }
export interface ChatItem { name: string; team: string; text: string; t: number; id: string }
export interface ScoreRow { id: string; name: string; team: TeamId; kills: number; deaths: number; money: number; bot: boolean; alive: boolean; self: boolean }

export interface HudState {
  connected: boolean
  joined: boolean
  phase: string
  mapName: string
  timer: number
  round: number
  scores: { CT: number; T: number }
  winTarget: number
  team: TeamId
  alive: boolean
  hp: number
  armor: number
  helmet: boolean
  money: number
  weapon: WeaponId
  inventory: WeaponId[]
  wIdx: number
  ammo: { mag: number; reserve: number }
  reloading: boolean
  scoped: boolean
  hasBomb: boolean
  bombPlanted: boolean
  bombTimer: number
  defuseBar: number | null
  plantBar: number | null
  canBuy: boolean
  killfeed: KillFeedItem[]
  chat: ChatItem[]
  scoreboard: ScoreRow[]
  hitmarkerAge: number
  headshotAge: number
  damageAge: number
  deathBy: string | null
  banner: { title: string; sub: string; winner: string | null } | null
  toasts: Array<{ msg: string; t: number }>
  spread: number
  fps: number
  specTarget: string | null
  gameover: { winner: string; scores: { CT: number; T: number } } | null
  buyError: string | null
  pointerLocked: boolean
  canPlant: boolean
  canDefuse: boolean
  scoreboardOpen: boolean
  flash: number            // Phase 8: 0..1 whiteout intensity (fade window)
  hasKit: boolean          // Phase 8: defuse kit
  grenadeCount: number     // Phase 8: copies of the CURRENT grenade held
}

export interface EngineOpts {
  name: string
  team: 'CT' | 'T' | 'auto'
  room: string
  map?: MapId
  botFill: boolean
  botDifficulty: 'easy' | 'normal' | 'hard'
  winTarget: number
  sensitivity: number
  volume: number
  fov: number
  /**
   * Task 82 — join gate. While pending, connect() withholds the 'join' emit;
   * the server's phase machine keeps the match dormant in 'warmup' (no
   * startRound, no updateBots — bots can't fire and can't be heard) until a
   * human joins, so nothing starts behind the loading bar. Resolve OR reject
   * => join fires. Omitted => join fires on connect (legacy behavior).
   */
  readyGate?: Promise<unknown>
}

const PLAYER_R = 0.4
// GLB long-gun vm pull-back: park the real-model stock butt behind the
// eye so it clips off like CS viewmodels (user 2026-10-19: "gun stock is
// completely in screen"; 2026-10-20: "it is better but it need to go
// back yet" — 0.13 left a stock wedge in the bottom-right corner, the
// butt only reached the near plane, not the eye). 0.20 puts the butt
// (+0.278 local) at +0.028 camera-space = behind the eye entirely.
// Live-tunable: __eng.vmTune(dz).
const GLB_VM_PULLBACK = 0.20
const STAND_H = 1.8
const CROUCH_H = 1.3
const EYE_STAND = 1.62
const EYE_CROUCH = 1.08
const GRAVITY = 22
const JUMP_V = 7.4
const STEP_UP = 0.55
const CROUCH_TUCK = 0.55   // airborne crouch raises virtual feet (CS-style crouch-jump)
const FALL_SAFE_V = 12.5   // max safe landing speed (~2.8m drop); above this = fall damage

const KICK: Partial<Record<WeaponId, number>> = {
  ak47: 0.55, ak74: 0.5, m4: 0.42, mp5: 0.22, deagle: 1.3, awp: 2.2, glock: 0.55, usp: 0.6,
  // Phase 3 pistols
  p250: 0.55, fiveseven: 0.5, tec9: 0.7, cz75: 0.45, elites: 0.5,
  hkp2000: 0.55, revolver: 2.0, taser: 0.8,
  // Phase 4 SMGs
  mp9: 0.2, mac10: 0.3, mp7: 0.2, ump45: 0.35, p90: 0.25, bizon: 0.22,
  // Phase 5 rifles + snipers
  m4a1s: 0.38, galil: 0.6, famas: 0.45, sg553: 0.55, aug: 0.5,
  ssg08: 1.6, scar20: 1.8, g3sg1: 1.9,
  // Phase 6 shotguns — a shell kicks like a mule
  nova: 2.4, xm1014: 1.5, mag7: 2.6, sawedoff: 2.8,
  // Phase 7 machine guns — heavy platforms, moderate per-shot kick; the
  // negev's kick fades with the spool (see fireShot ramp scaling)
  m249: 0.5, negev: 0.55,
}

export class Engine {
  private canvas: HTMLCanvasElement
  private renderer!: THREE.WebGLRenderer
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private map!: MapBuild
  private mapDef!: MapDef
  /** Task 77 — atmosphere handles for per-map re-theming (fog + lights). */
  private atmo?: { hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight; sun: THREE.DirectionalLight; fog: THREE.Fog }
  private fx!: Effects
  private pm!: PlayerManager
  private raycaster = new THREE.Raycaster()

  private opts: EngineOpts
  private hudCb: (s: HudState) => void

  // net
  private socket: ReturnType<typeof io> | null = null
  private myId = ''
  myTeam: TeamId = 'CT'

  // local player physics
  private pos = new THREE.Vector3(0, 0, 40)
  private vel = new THREE.Vector3()
  private yaw = 0
  private pitch = 0
  private onGround = false
  private crouchAmt = 0
  private tuck = 0          // airborne crouch feet-tuck (0..CROUCH_TUCK)
  private eyeY = 0          // smoothed camera base height (absorbs stair steps)
  private lastFallAt = 0
  private keys = new Set<string>()
  private firing = false
  // Phase 5 multi-level scope: 0 = hip, 1..scopeLevels = zoom steps
  // (awp/ssg08/scar20/g3sg1: 0→1→2→0; sg553/aug: 0→1→0)
  private scopeLevel = 0
  private lastC4StageSfx = 0 // debounce for plant/defuse start sounds
  private sndFwd = new THREE.Vector3()

  // weapons
  private inventory: WeaponId[] = ['usp', 'knife']
  private wIdx = 0
  private ammo: Partial<Record<WeaponId, { mag: number; reserve: number }>> = {}
  private lastShotAt = 0
  private reloadEndsAt = 0
  private reloadSfxTimers: ReturnType<typeof setTimeout>[] = []
  private recoil = 0
  // Phase 7 accuracy-ramp spool (negev): consecutive-shot counter. Grows
  // with every sustained shot, hard-resets on a >400ms firing pause, weapon
  // switch, reload, round start or death. spreadDeg() lerps the negev's
  // spread from the wild startSpread down to laser `accurate` as it rises.
  private sustained = 0
  private scoped = false
  private vmGroup: THREE.Group | null = null
  private vmCache = new Map<string, ViewModel>()
  private vm: ViewModel | null = null
  private vmBasePos = new THREE.Vector3(0.26, -0.24, -0.45)
  // extra pull-back on GLB long-gun vms, live-tunable via __eng.vmTune()
  private vmGlbAdj = 0
  // live size multiplier for GLB gun vms (stacks on GLB_VM_SCALE in
  // weapongltf.ts), tunable via __eng.vmScale(f); 1 = baked default
  private vmGlbScaleMul = 1
  // viewmodel part animations
  private slideKickAt = -1e9
  private boltCycleAt = -1e9
  private pumpAt = -1e9      // Phase 6: shotgun fore-end cycle (pump anim)
  private slashAt = -1e9
  private slideLeft = false   // dual berettas: which gun fires next
  private vmKick = 0
  // Phase 5 burst fire: queued rounds of the current burst (famas)
  private burstRemaining = 0
  private bobPhase = 0
  private lastW = 0
  // v5 feel: viewmodel sway + camera shake + landing dip
  private swayX = 0
  private swayY = 0
  private prevYaw = 0
  private prevPitch = 0
  private camShake = 0
  private landDip = 0
  private wasOnGround = true

  // match state (from server)
  private phase = 'warmup'
  private phaseEndsAt = 0
  private round = 0
  private scores = { CT: 0, T: 0 }
  private winTarget = 8
  private hp = 100
  private armor = 0
  private helmet = false
  private money = ECONOMY.startMoney
  private alive = false
  private hasBomb = false
  private kills = 0
  private deaths = 0

  // Phase 8: grenades + equipment
  private nadeWorld = new Map<number, { mesh: THREE.Group; kind: GrenadeKind; vel: THREE.Vector3; pos: THREE.Vector3; lastSyncAt: number; lastSeenAt: number; trailAt: number }>()
  private smokeWorld = new Map<number, WorldFx>()
  private fireWorld = new Map<number, WorldFx>()
  private blindUntil = 0
  private blindMs = 1
  private hasKit = false
  private lastThrowAt = 0
  private pinPullAt = -1e9   // viewmodel pin-out anim timestamp

  // bomb
  private bombPlanted = false
  private bombPos: THREE.Vector3 | null = null
  private bombExplodeAt = 0
  private bombMesh: THREE.Group | null = null
  private lastBeepAt = 0
  private defuseBar: number | null = null
  private plantBar: number | null = null

  // hud event state
  private killfeed: KillFeedItem[] = []
  private chat: ChatItem[] = []
  private toasts: Array<{ msg: string; t: number }> = []
  private hitmarkerAt = 0
  private headshotAt = 0
  private damageAt = 0
  private deathBy: string | null = null
  private banner: HudState['banner'] = null
  private gameover: HudState['gameover'] = null
  private buyError: string | null = null
  private specIdx = 0
  private spectating = false

  // loop
  private raf = 0
  private lastT = 0
  private fpsCounter = 0
  private fpsAt = 0
  private fps = 0
  private hudAt = 0
  private stateSentAt = 0
  private running = false
  private disposed = false
  private loopTick = 0
  private pointerLocked = false
  private stepAccum = 0

  // public toggles driven by React
  menuOpen = false
  buyOpen = false
  chatOpen = false
  scoreboardOpen = false

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts, hudCb: (s: HudState) => void) {
    this.canvas = canvas
    this.opts = opts
    this.hudCb = hudCb
  }

  // ---------------------------------------------------------------- setup
  start() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xd9cfb4, 55, 240)

    // atmosphere per map (Task 77): dust/dust2 keep the warm desert balance;
    // aimhead gets its ORIGINAL identity — de_aztec's pale jungle-blue haze and
    // cool green ground-bounce (a tan desert atmosphere renders the muted
    // aztec greens brown). Re-themed on rebuildMap.
    const aztec = this.opts.map === 'aimhead'
    if (aztec) {
      this.scene.fog.color.set(0xcfe0e8)
      this.scene.fog.near = 60
      this.scene.fog.far = 260
    }

    // image-based lighting: PBR metal weapon materials need environment
    // reflections, otherwise high-metalness surfaces render near-black
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture
      this.scene.environmentIntensity = 0.55
      pmrem.dispose()
    } catch { /* env map is cosmetic — ignore failures */ }

    this.camera = new THREE.PerspectiveCamera(this.opts.fov, window.innerWidth / window.innerHeight, 0.05, 700)
    this.scene.add(this.camera)

    // lights — warm desert balance: strong sun, warm ambient bounce,
    // shadowed areas must read warm-grey (not blue). aimhead: cooler jungle
    // balance matching de_aztec (blue sky haze, green bounce, whiter sun)
    const hemi = new THREE.HemisphereLight(aztec ? 0xdce8f0 : 0xe6e2d2, aztec ? 0x5e7a68 : 0x8a7a5e, 0.72)
    this.scene.add(hemi)
    const ambient = new THREE.AmbientLight(aztec ? 0xb6c4bd : 0xc9b896, 0.38)
    this.scene.add(ambient)
    // sun with shadows (matches the sky's sun disc — NE high)
    const sun = new THREE.DirectionalLight(aztec ? 0xfff6e0 : 0xfff0d0, 1.9)
    this.atmo = { hemi, ambient, sun, fog: this.scene.fog }
    sun.position.set(55, 70, 18)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -62
    sun.shadow.camera.right = 62
    sun.shadow.camera.top = 62
    sun.shadow.camera.bottom = -62
    sun.shadow.camera.near = 10
    sun.shadow.camera.far = 190
    sun.shadow.bias = -0.00035
    sun.shadow.normalBias = 0.03
    this.scene.add(sun)
    this.scene.add(sun.target)

    this.mapDef = MAPS[this.opts.map ?? 'dust2'] ?? MAPS.dust2
    this.map = buildMap(this.scene, this.mapDef)
    // visual detail layer (props, no gameplay colliders)
    const details = buildDetails(this.mapDef)
    details.group.userData.isDetails = true
    this.scene.add(details.group)
    this.map.raycastMeshes.push(...details.raycastMeshes)
    this.fx = new Effects(this.scene)
    this.pm = new PlayerManager(this.scene, this.myTeam)
    // start weapon PBR texture downloads early so viewmodels never pop in mid-round
    preloadWeaponTextures()
    // staged weapon GLBs (remote guns + ALL staged viewmodels): preloaded in
    // the lobby too; once parsed, drop the vm cache and swap whatever is in
    // hand right now (gun OR knife) from procedural to its staged GLB
    // (procedural builders stay as the fallback for anything not staged)
    void preloadWeaponModels().then(() => {
      this.vmCache.clear()
      if (this.vmGroup) this.rebuildViewmodel()
    })
    // async GLB player models (procedural rig stays as fallback until ready)
    this.pm.preloadModels()

    // debug/testing hook (harmless in production)
    if (typeof window !== 'undefined') {
      ;(window as unknown as Record<string, unknown>).__eng = {
        teleport: (x: number, y: number, z: number, yaw?: number) => {
          this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.eyeY = y
          if (typeof yaw === 'number') { this.yaw = yaw; this.pitch = 0 }
        },
        state: () => ({ pos: [this.pos.x, this.pos.y, this.pos.z], vel: [this.vel.x, this.vel.y, this.vel.z], onGround: this.onGround, phase: this.phase, alive: this.alive, hp: this.hp, map: this.mapDef.id, mapv: this.mapDef.version, tick: this.loopTick, keys: [...this.keys], menu: this.menuOpen || this.buyOpen || this.chatOpen, weapon: this.inventory[this.wIdx], scopeLevel: this.scopeLevel, fov: Math.round(this.camera.fov * 100) / 100, scoped: this.scoped, spread: Math.round(this.spreadDeg() * 100) / 100, sustained: this.sustained }),
        ammo: () => ({ weapon: this.inventory[this.wIdx], ammo: this.ammo[this.inventory[this.wIdx]], all: { ...this.ammo }, reloadEndsIn: Math.max(0, this.reloadEndsAt - performance.now()) }),
        reload: () => this.tryReload(),
        fire: () => this.tryFire(),
        gas: () => this.fx.aliveKinds(),
        players: () => [...this.pm.players.values()].map(p => ({
          id: p.id, team: p.team, w: p.weapon, alive: p.alive,
          pos: p.root.position.toArray().map((v: number) => Math.round(v * 100) / 100),
          rot: [Math.round(p.root.rotation.x * 100) / 100, Math.round(p.root.rotation.z * 100) / 100],
          vis: p.root.visible,
          gunParts: p.gunStub.children.length,
          glb: !!p.glb, anim: p.glb ? 'user' : null,
        })),
        sock: () => this.socket,
        glb: () => userModelState(),
        wglb: () => weaponModelsState(),
        upgrade: () => this.pm.upgradeAllNow(),
        meshWorld: (id: string) => {
          const p = this.pm.getById(id)
          if (!p) return null
          const out: Record<string, number[]> = { root: p.root.position.toArray().map((v: number) => Math.round(v * 100) / 100) }
          let i = 0
          p.root.traverse(o => {
            const m = o as THREE.Mesh
            if (m.isMesh && i < 10) {
              out['m' + i + (m.visible === false ? '_HID' : '')] = m.getWorldPosition(new THREE.Vector3()).toArray().map((v: number) => Math.round(v * 100) / 100)
              i++
            }
          })
          return out
        },
        // live GLB vm pull-back tuning: positive dz = gun closer to you
        // (stock further off-screen), negative = deeper into the scene.
        // Applies instantly (bob loop renders from vmBasePos) and sticks
        // across weapon switches until reload/rejoin.
        vmTune: (dz: number) => {
          this.vmGlbAdj += dz
          // instant-apply only when the held vm IS a GLB gun (knife/procedural
          // vms didn't get the pull-back; their base must not move)
          const gv = (this.vm?.group.userData as { glbVm?: string } | undefined)?.glbVm
          if (gv && gv !== 'knife') this.vmBasePos.z += dz
          return { adj: Number(this.vmGlbAdj.toFixed(3)), pullback: Number((GLB_VM_PULLBACK + this.vmGlbAdj).toFixed(3)) }
        },
        // live GLB gun vm SIZE tuning: f is a multiplier on the baked 90%
        // size (vmScale(0.9) = 10% smaller again, vmScale(1) = reset to
        // baked default). Busts the vm cache and rebuilds instantly so the
        // effect is visible with zero reloads; sticks across weapon switches.
        vmScale: (f: number) => {
          if (!Number.isFinite(f)) return null
          this.vmGlbScaleMul = Math.min(1.5, Math.max(0.5, f))
          this.vmCache.clear()
          this.rebuildViewmodel()
          return { mul: this.vmGlbScaleMul, scale: Number((GLB_VM_SCALE * this.vmGlbScaleMul).toFixed(3)) }
        },
        // live gun-in-hand offset tuning (GLB rig): __eng.gunTune(id, x,y,z, rx,ry,rz)
        gunTune: (id: string, x?: number, y?: number, z?: number, rx?: number, ry?: number, rz?: number) => {
          const p = this.pm.getById(id)
          if (!p || !p.glb) return null
          const rig = p.glb.gunRig
          if (x !== undefined) rig.position.set(x, y ?? rig.position.y, z ?? rig.position.z)
          if (rx !== undefined) rig.rotation.set(rx, ry ?? rig.rotation.y, rz ?? rig.rotation.z)
          return { pos: rig.position.toArray(), rot: [rig.rotation.x, rig.rotation.y, rig.rotation.z] }
        },
        // world position + rotation of any named node under a player's root (GLB bones)
        boneWorld: (id: string, name: string) => {
          const p = this.pm.getById(id)
          if (!p) return null
          const node = p.root.getObjectByName(name) ?? p.root.getObjectByName(name.replace(/:/g, ''))
          if (!node) return null
          return {
            pos: node.getWorldPosition(new THREE.Vector3()).toArray().map((v: number) => Math.round(v * 1000) / 1000),
            rot: [node.rotation.x, node.rotation.y, node.rotation.z].map((v: number) => Math.round(v * 1000) / 1000),
          }
        },
        // user-rig bone state: rotations of the driven skeleton (proves animation is live)
        rigInfo: (id: string) => {
          const p = this.pm.getById(id)
          if (!p || !p.glb) return null
          const b = p.glb.bones
          const r3 = (o: THREE.Object3D) => [o.rotation.x, o.rotation.y, o.rotation.z].map(v => Math.round(v * 100) / 100)
          return {
            hipsY: Math.round(b.hips.position.y * 100) / 100,
            torso: r3(b.torso),
            head: r3(b.head),
            armR: r3(b.armR),
            foreR: r3(b.foreR),
            thighR: r3(b.thighR),
            shinR: r3(b.shinR),
            thighL: r3(b.thighL),
            shinL: r3(b.shinL),
            speed: Math.round(p.speed * 100) / 100,
            crouchT: Math.round(p.crouchT * 100) / 100,
            gunPos: p.glb.gunRig.position.toArray().map(v => Math.round(v * 1000) / 1000),
          }
        },
        // live bone-rotation probe: set a bone's rotation, read back its world transform
        bonePose: (id: string, bone: string, x?: number, y?: number, z?: number) => {
          const p = this.pm.getById(id)
          if (!p || !p.glb) return null
          const node = p.root.getObjectByName(bone) as THREE.Object3D | null
          if (!node) return null
          const before = node.getWorldPosition(new THREE.Vector3()).toArray()
          if (x !== undefined) node.rotation.set(x, y ?? node.rotation.y, z ?? node.rotation.z)
          p.root.updateMatrixWorld(true)
          const after = node.getWorldPosition(new THREE.Vector3()).toArray()
          const tip = new THREE.Vector3(0, -0.25, 0).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion())).add(node.getWorldPosition(new THREE.Vector3()))
          return { before: before.map(v => +v.toFixed(3)), after: after.map(v => +v.toFixed(3)), tipDir: tip.toArray().map(v => +v.toFixed(3)), rot: [node.rotation.x, node.rotation.y, node.rotation.z] }
        },
        sfx: () => audio.info(),
        setAmmo: (mag: number, reserve: number) => {
          const w = this.inventory[this.wIdx]
          if (w && this.ammo[w]) this.ammo[w] = { mag, reserve }
          return this.ammo[w]
        },
        vm: () => this.vmGroup ? { visible: this.vmGroup.visible, parts: this.vmGroup.children.length, parent: this.vmGroup.parent?.type ?? null, w: this.inventory[this.wIdx] } : null,
        // id of the staged GLB backing the current viewmodel (null = procedural)
        vmGlb: () => (this.vm?.group.userData as { glbVm?: string } | undefined)?.glbVm ?? null,
        vmState: () => {
          const vm = this.vm
          if (!vm) return null
          return {
            w: this.inventory[this.wIdx],
            rot: this.vmGroup ? [this.vmGroup.rotation.x.toFixed(3), this.vmGroup.rotation.y.toFixed(3), this.vmGroup.rotation.z.toFixed(3)] : null,
            slide: vm.slide ? Number(vm.slide.position.z.toFixed(4)) : null,
            bolt: vm.bolt ? { z: Number(vm.bolt.position.z.toFixed(4)), rz: Number(vm.bolt.rotation.z.toFixed(3)) } : null,
            magVisible: vm.mag ? vm.mag.visible : null,
            magY: vm.mag ? Number(vm.mag.position.y.toFixed(4)) : null,
          }
        },
        mats: () => {
          const out: Array<Record<string, unknown>> = []
          this.vmGroup?.traverse(o => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
            if (m && (m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) {
              out.push({ tex: !!m.map, nrm: !!m.normalMap, rgh: !!m.roughnessMap, color: '#' + m.color.getHexString(), met: m.metalness.toFixed(2), rou: m.roughness.toFixed(2) })
            }
          })
          return { total: out.length, textured: out.filter(x => x.tex).length, flat: out.filter(x => !x.tex).length, sample: out.slice(0, 8) }
        },
        fxdemo: () => {
          const p = this.camera.position.clone()
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
          for (let i = 0; i < 8; i++) {
            const dir = fwd.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.18, 0)).normalize()
            this.raycaster.set(p, dir)
            this.raycaster.far = 60
            const hits = this.raycaster.intersectObjects(this.map.raycastMeshes, false)
            if (hits.length) {
              const h = hits[0]
              this.fx.impact(h.point, h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : undefined, (h.object.userData as { surf?: string }).surf)
            }
          }
          this.fx.explosion(p.clone().addScaledVector(fwd, 16))
          this.camShake = 1.1
          return 'ok'
        },
      }
    }

    audio.init()
    audio.setVolume(this.opts.volume)
    audio.loadPack() // real CS:GO samples; synth fallback covers until decoded

    this.bindEvents()
    this.connect()

    this.running = true
    this.lastT = performance.now()
    this.loop()
  }

  /**
   * Task 81: settle every async asset job that would otherwise hitch mid-round,
   * while the loading bar still covers the screen:
   *   1. PBR upgrades — with the preloader's cache these resolve in
   *      milliseconds instead of popping in mid-round with a shader recompile
   *   2. sound pack decode — 252 .oggs; from cached blobs this is pure CPU
   *      decode, done here rather than at first-listen
   *   3. shader programs — renderer.compileAsync warms every program the
   *      current scene needs, killing the classic first-look stutter
   * Best-effort with deadlines: warm-up never blocks the game forever (a
   * timeout just means the old lazy behavior for whatever is left).
   */
  async warmup(onStage?: (stage: string) => void): Promise<void> {
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
    const deadline1 = performance.now() + 8000
    onStage?.('textures')
    while (performance.now() < deadline1) {
      const busy = Object.values(pbrState).some(v => v === 'loading')
      if (!busy) break
      await sleep(80)
    }
    const deadline2 = performance.now() + 12000
    onStage?.('sounds')
    while (performance.now() < deadline2) {
      const i = audio.info()
      if (i.loaded + i.errors.length >= i.total) break
      await sleep(120)
    }
    onStage?.('shaders')
    try {
      const rd = this.renderer as unknown as { compileAsync?: (s: THREE.Scene, c: THREE.Camera) => Promise<unknown> }
      if (rd?.compileAsync) {
        // deadline: on weak/software GPUs a full-scene compile can take tens of
        // seconds — give it a head start behind the bar, then let the rest
        // finish in the background (programs still warm up on first render)
        await new Promise<void>((resolve) => {
          let settled = false
          const t = setTimeout(() => { if (!settled) { settled = true; resolve() } }, 15000)
          rd.compileAsync!.call(this.renderer, this.scene, this.camera)
            .then(() => { if (!settled) { settled = true; clearTimeout(t); resolve() } })
            .catch(() => { if (!settled) { settled = true; clearTimeout(t); resolve() } })
        })
      }
    } catch { /* warm-up is best-effort */ }
  }

  private bindEvents() {
    window.addEventListener('resize', this.onResize)
    document.addEventListener('pointerlockchange', this.onPointerLock)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    this.canvas.addEventListener('click', this.onCanvasClick)
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
  }

  dispose() {
    this.disposed = true
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('pointerlockchange', this.onPointerLock)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    this.canvas.removeEventListener('click', this.onCanvasClick)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.socket?.disconnect()
    this.renderer?.dispose()
  }

  private onResize = () => {
    if (!this.renderer) return
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
  }

  private onCanvasClick = () => {
    if (this.menuOpen || this.buyOpen || this.chatOpen) return
    if (!this.pointerLocked) this.canvas.requestPointerLock()
    audio.resume()
  }

  private onContextMenu = (e: Event) => e.preventDefault()

  private onPointerLock = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas
  }

  requestLock() {
    if (!this.pointerLocked && !this.menuOpen && !this.buyOpen && !this.chatOpen) {
      this.canvas.requestPointerLock()
    }
  }

  releaseLock() {
    if (this.pointerLocked) document.exitPointerLock()
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || !this.running) return
    const sens = this.opts.sensitivity * (this.scoped ? Math.max(0.08, this.camera.fov / this.opts.fov) : 1) * 0.0022
    this.yaw -= e.movementX * sens
    this.pitch -= e.movementY * sens
    this.pitch = Math.max(-1.53, Math.min(1.53, this.pitch))
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.pointerLocked || this.menuOpen || this.buyOpen || this.chatOpen) return
    if (e.button === 0) {
      if (!this.alive) { this.cycleSpectate(); return }
      this.firing = true
      this.tryFire()
    } else if (e.button === 2) {
      const w = this.currentWeapon()
      if (w.throwable && this.alive) {
        // Phase 8 (plan 8.3): RMB = underhand lob while holding a grenade
        this.throwGrenade(0.45)
      } else if (scopeLevelsOf(w) > 0 && this.alive) {
        // cycle zoom steps: 2-level snipers 0→1→2→0, scoped rifles 0→1→0
        this.setScopeLevel((this.scopeLevel + 1) % (scopeLevelsOf(w) + 1))
        audio.zoom()
      }
    }
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.firing = false
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.chatOpen) return // chat input handles its own keys
    const k = e.code
    if (k === 'Tab') { e.preventDefault(); this.scoreboardOpen = true; return }
    if (k === 'Escape') return // browser handles pointer unlock; React shows menu via pointerlockchange
    if (this.menuOpen || this.buyOpen) return // pause/buy menus handle their own keys — digits navigate the buy menu, not weapon slots
    this.keys.add(k)
    if (k === 'KeyR') this.tryReload()
    if (k === 'Digit1') this.switchSlot(1)
    if (k === 'Digit2') this.switchSlot(2)
    if (k === 'Digit3') this.switchSlot(3)
    if (k === 'Digit4') this.switchSlot(4)
    if (k === 'Digit5') this.switchSlot(5)   // cycles through held grenades
    if (k === 'KeyQ') this.switchLast()
    if (k === 'KeyE') {
      this.socket?.emit('useDown')
      audio.plantTick()
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
    if (e.code === 'Tab') this.scoreboardOpen = false
    if (e.code === 'KeyE') this.socket?.emit('useUp')
  }

  // ---------------------------------------------------------------- net
  // Task 82 — 'join' is deferred behind opts.readyGate (page.tsx resolves it
  // when the loading bar finishes). Matches park in 'warmup' server-side
  // (rounds + bot ticks only start when a human joins), so withholding join
  // means bots can't shoot — and their gunfire can't reach this client —
  // while assets are still downloading behind the bar.
  private joinGateSettled = false

  private connect() {
    const socket = io('/?XTransformPort=3003', { path: '/' })
    this.socket = socket

    socket.on('connect', () => {
      const emitJoin = () => {
        if (this.disposed) return
        socket.emit('join', {
          name: this.opts.name,
          room: this.opts.room,
          team: this.opts.team,
          map: this.mapDef.id,
          botFill: this.opts.botFill,
          botDifficulty: this.opts.botDifficulty,
          winTarget: this.opts.winTarget,
        })
      }
      const gate = this.opts.readyGate
      if (this.joinGateSettled || !gate) {
        this.joinGateSettled = true
        return emitJoin()
      }
      const go = () => {
        this.joinGateSettled = true
        // Only emit while actually connected: if the socket dropped mid-load,
        // a buffered emit + the reconnect path ('connect' → settled branch)
        // would double-join. Let the next 'connect' carry the join instead.
        if (socket.connected) emitJoin()
      }
      void Promise.resolve(gate).then(go, go)
    })

    socket.on('joinError', (d: { msg: string }) => {
      this.pushToast(d.msg)
    })

    socket.on('init', (d: {
      youId: string; team: TeamId; money: number; inventory: WeaponId[]
      mapId?: string; mapVersion: number; players: Array<Record<string, unknown>>; match: Record<string, unknown>
    }) => {
      // server is authoritative about the room's map — rebuild if we guessed wrong
      if (d.mapId && d.mapId !== this.mapDef.id && (d.mapId === 'dust' || d.mapId === 'dust2' || d.mapId === 'aimhead')) this.rebuildMap(d.mapId as MapId)
      this.myId = d.youId
      this.myTeam = d.team
      this.pm.setMyTeam(d.team)
      this.money = d.money
      this.inventory = d.inventory ?? ['knife']
      this.syncAmmo()
      for (const p of d.players) {
        if (p.id !== this.myId) {
          this.pm.getOrCreate(p.id as string, p.name as string, p.team as TeamId, p.bot as boolean)
          this.pm.pushSnapshot(p.id as string, performance.now(), p.x as number, p.y as number, p.z as number, p.yaw as number, p.pitch as number, false)
        }
      }
      this.applyMatch(d.match as Record<string, never>)
      // spawn pos from own snapshot entry
      const me = (d.players as Array<Record<string, unknown>>).find(p => p.id === this.myId)
      if (me) {
        this.pos.set(me.x as number, me.y as number, me.z as number)
        this.eyeY = this.pos.y
        this.yaw = (me.yaw as number) ?? 0
      }
      this.pushToast(`Connected — room "${this.opts.room}"`)
    })

    socket.on('playerJoined', (p: Record<string, unknown>) => {
      if (p.id === this.myId) return
      this.pm.getOrCreate(p.id as string, p.name as string, p.team as TeamId, p.bot as boolean)
    })

    socket.on('playerLeft', (d: { id: string }) => this.pm.remove(d.id))

    socket.on('snapshot', (d: { t: number; ps: unknown[][]; gs?: unknown[][]; sm?: unknown[][]; fi?: unknown[][] }) => {
      const rt = performance.now()
      // Phase 8 entity reconciliation — positions/vels authoritative, meshes
      // dead-reckon between snapshots (see loop)
      if (d.gs) {
        for (const row of d.gs) {
          this.trackNade(row[0] as number, row[1] as GrenadeKind,
            [row[2] as number, row[3] as number, row[4] as number],
            [row[5] as number, row[6] as number, row[7] as number], rt)
        }
      }
      if (d.sm) {
        for (const row of d.sm) {
          const id = row[0] as number
          if (!this.smokeWorld.has(id)) {
            this.smokeWorld.set(id, new SmokeCloud(this.scene, new THREE.Vector3(row[1] as number, row[2] as number, row[3] as number)))
          }
        }
      }
      if (d.fi) {
        for (const row of d.fi) {
          const id = row[0] as number
          if (!this.fireWorld.has(id)) {
            this.fireWorld.set(id, new FireZone(this.scene, new THREE.Vector3(row[1] as number, row[2] as number, row[3] as number)))
          }
        }
      }
      for (const row of d.ps) {
        const id = row[0] as string
        if (id === this.myId) {
          this.hp = row[10] as number
          this.armor = row[11] as number
          if (this.armor <= 0) this.helmet = false
          const alive = row[12] === 1
          this.hasBomb = row[13] === 1
          // authoritative score/economy sync (kills, deaths, money — incl. round rewards)
          this.kills = row[18] as number
          this.deaths = row[19] as number
          this.money = row[20] as number
          this.hasKit = row[21] === 1
          // respawn / round-start position sync (server owns spawn placement)
          {
            const sx = row[1] as number, sy = row[2] as number, sz = row[3] as number
            const dxz = Math.hypot(sx - this.pos.x, sz - this.pos.z)
            if ((!this.alive && alive) ||
                (this.alive && (this.phase === 'freeze' || this.phase === 'post' || this.phase === 'warmup') && dxz > 1.5) ||
                (this.alive && dxz > 20)) {
              this.pos.set(sx, sy, sz)
              this.vel.set(0, 0, 0)
              this.eyeY = sy
            }
          }
          const wname = row[14] as WeaponId
          if (!this.inventory.includes(wname) && wname !== 'knife') {
            // server inventory changed (buy/bomb) — resync
            this.inventory = [wname, ...this.inventory.filter(w => w !== wname && w !== 'knife' && WEAPONS[w]?.slot === WEAPONS[wname]?.slot), 'knife']
            this.syncAmmo()
          }
          if (!alive && this.alive) this.died(this.deathBy)
          this.alive = alive
          continue
        }
        let rp = this.pm.getById(id)
        if (!rp) rp = this.pm.getOrCreate(id, row[15] as string, row[16] as TeamId, row[17] === 1)
        rp.name = row[15] as string
        rp.kills = row[18] as number
        rp.deaths = row[19] as number
        rp.money = row[20] as number
        this.pm.setGun(id, row[14] as string)
        const wasAlive = rp.alive
        rp.alive = row[12] === 1
        rp.hp = row[10] as number
        rp.hasBomb = row[13] === 1
        if (!rp.alive && wasAlive) rp.deathAt = performance.now()
        this.pm.pushSnapshot(id, rt, row[1] as number, row[2] as number, row[3] as number, row[4] as number, row[5] as number, row[6] === 1)
      }
    })

    socket.on('round', (d: Record<string, unknown>) => {
      this.applyMatch(d)
      if (d.phase === 'freeze') {
        this.banner = { title: `Round ${d.round}`, sub: 'Buy your weapons (B)', winner: null }
        audio.roundStart()
        // round reset
        this.recoil = 0
        this.sustained = 0
        this.scopeLevel = 0
        this.scoped = false
        this.setScopeLevel(0)
        this.deathBy = null
        this.spectating = false
        this.specIdx = 0
        this.plantBar = null        // round reset cancels any in-flight plant/defuse —
        this.defuseBar = null       // updateBomb() drops them silently (no progress:0 broadcast)
        this.wIdx = 0
        this.reloadEndsAt = 0
        this.cancelReloadSfx()
        this.blindUntil = 0
        this.lastThrowAt = 0
        this.clearNadeWorld()
        for (const w of this.inventory) {
          const def = WEAPONS[w]
          if (def && def.mag !== Infinity) this.ammo[w] = { mag: def.mag, reserve: def.reserve }
        }
        this.rebuildViewmodel()
      } else if (d.phase === 'live') {
        this.banner = null
      } else if (d.phase === 'post') {
        const winner = d.roundWinner as string | null
        const reason = (d.winReason as string) ?? ''
        const reasons: Record<string, string> = {
          'elimination': 'Enemy team eliminated',
          'bomb': 'The bomb has exploded',
          'defuse': 'The bomb has been defused',
          'time': 'Round time is over',
        }
        if (winner) {
          this.banner = {
            title: winner === 'CT' ? 'Counter-Terrorists Win' : 'Terrorists Win',
            sub: reasons[reason] ?? reason, winner,
          }
          if (winner === this.myTeam) audio.roundWin(); else audio.roundLose()
        }
      }
    })

    socket.on('kill', (d: { killer: string | null; victim: string; weapon: string; headshot: boolean; killerName: string; victimName: string; killerTeam: string; victimTeam: string }) => {
      this.killfeed.push({ killer: d.killerName, victim: d.victimName, weapon: d.weapon, hs: d.headshot, killerTeam: d.killerTeam, victimTeam: d.victimTeam, t: performance.now() })
      if (this.killfeed.length > 6) this.killfeed.shift()
      if (d.victim === this.myId && this.alive) {
        this.deathBy = d.killerName || 'the bomb'
      }
    })

    socket.on('hitConfirm', (d: { victimId: string; attackerId: string | null; dmg: number; part: string; hs: boolean; hp: number }) => {
      if (d.attackerId === this.myId) {
        this.hitmarkerAt = performance.now()
        if (d.hs) { this.headshotAt = performance.now(); audio.headshotDing() }
        else audio.hitmarker()
      }
      if (d.victimId === this.myId) {
        this.damageAt = performance.now()
        this.hp = d.hp
        this.camShake = Math.max(this.camShake, 0.35)
        audio.damageTaken()
      }
    })

    socket.on('shot', (d: { id: string; weapon: string; origin: number[]; dir: number[]; seed?: number }) => {
      // remote shot fx (suppressed shooters keep their tracer/flash hidden)
      const o = new THREE.Vector3(d.origin[0], d.origin[1], d.origin[2])
      const dir = new THREE.Vector3(d.dir[0], d.dir[1], d.dir[2])
      const rw = WEAPONS[d.weapon as WeaponId]
      const sup = !!rw?.suppressed
      if (rw && pelletsOf(rw) > 1 && typeof d.seed === 'number') {
        // Phase 6: rebuild the shooter's EXACT fan from the broadcast seed —
        // every witness draws the identical tracer spread
        const dirs = pelletDirs(d.seed, pelletsOf(rw), pelletSpreadOf(rw), { x: dir.x, y: dir.y, z: dir.z })
        let pocks = 0
        for (const pd of dirs) {
          const pdir = new THREE.Vector3(pd.x, pd.y, pd.z)
          this.raycaster.set(o, pdir)
          this.raycaster.far = 60
          const ph = this.raycaster.intersectObjects(this.map.raycastMeshes, false)
          const pend = ph.length ? ph[0].point : o.clone().addScaledVector(pdir, 60)
          if (ph.length && pocks < 3) {
            const surf = (ph[0].object.userData as { surf?: string }).surf
            this.fx.impact(ph[0].point, ph[0].face ? ph[0].face.normal.clone().transformDirection(ph[0].object.matrixWorld) : undefined, surf)
            pocks++
          }
          if (!sup) this.fx.tracer(o.clone().addScaledVector(pdir, 0.8), pend)
        }
        this.fx.muzzleFlash(o.clone().addScaledVector(dir, 0.5), sup)
        const myEye = this.camera.position
        audio.gunshot(d.weapon, d.origin as [number, number, number], [myEye.x, myEye.y, myEye.z])
        return
      }
      // find map hit for tracer end + impact fx
      this.raycaster.set(o, dir)
      this.raycaster.far = 150
      const hits = this.raycaster.intersectObjects(this.map.raycastMeshes, false)
      const end = hits.length ? hits[0].point : o.clone().addScaledVector(dir, 120)
      if (hits.length) {
        const h0 = hits[0]
        const surf = (h0.object.userData as { surf?: string }).surf
        this.fx.impact(h0.point, h0.face ? h0.face.normal.clone().transformDirection(h0.object.matrixWorld) : undefined, surf)
      }
      if (!sup) this.fx.tracer(o.clone().addScaledVector(dir, 0.8), end)
      this.fx.muzzleFlash(o.clone().addScaledVector(dir, 0.5), sup)
      const myEye = this.camera.position
      audio.gunshot(d.weapon, d.origin as [number, number, number], [myEye.x, myEye.y, myEye.z])
    })

    // ---- Phase 8: grenade events ----
    // projectile spawned (throw broadcast — everyone incl. the thrower gets
    // the world mesh immediately; snapshots reconcile position afterwards)
    socket.on('nade', (d: { id: number; kind: GrenadeKind; weapon: string; owner: string; pos: number[]; vel: number[] }) => {
      this.trackNade(d.id, d.kind, d.pos, d.vel)
    })

    // detonation reports: visuals + sounds per kind
    socket.on('nadeFx', (d: { id: number; kind: string; pos: number[] }) => {
      const pos = new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2])
      const eye = this.camera.position
      // remove the projectile body (smoke bodies vanish into the cloud, etc.)
      const n = this.nadeWorld.get(d.id)
      if (n) { this.scene.remove(n.mesh); this.nadeWorld.delete(d.id) }
      if (d.kind === 'he') {
        this.fx.explosion(pos)
        this.camShake = Math.max(this.camShake, THREE.MathUtils.clamp(1.4 - pos.distanceTo(eye) / 22, 0.15, 1.2))
      } else if (d.kind === 'smoke') {
        if (!this.smokeWorld.has(d.id)) this.smokeWorld.set(d.id, new SmokeCloud(this.scene, pos))
      } else if (d.kind === 'molotov' || d.kind === 'inc') {
        this.fx.explosion(pos)
      }
      // sound for every kind (flash pops, smoke hisses, HE booms, decoy deploys)
      audio.nadeExplode(d.kind, [pos.x, pos.y, pos.z], [eye.x, eye.y, eye.z])
    })

    // hard-landing bounce ticks
    socket.on('gBounce', (d: { id: number; pos: number[]; speed: number }) => {
      const eye = this.camera.position
      audio.nadeBounce([d.pos[0], d.pos[1], d.pos[2]], [eye.x, eye.y, eye.z])
    })

    // personal flashblind: server computed distance + facing + LOS for ME
    socket.on('flash', (d: { ms: number; pos: number[] }) => {
      const t = performance.now()
      if (d.ms > (this.blindUntil ?? 0) - t) {
        this.blindUntil = t + d.ms
        this.blindMs = Math.max(1, d.ms)
        audio.duckFor(d.ms)
      }
    })

    // decoy fake gunfire (mimics the thrower's primary)
    socket.on('decoyShot', (d: { id: number; pos: number[]; weapon: string }) => {
      const eye = this.camera.position
      audio.gunshot(d.weapon, [d.pos[0], d.pos[1], d.pos[2]], [eye.x, eye.y, eye.z])
    })

    socket.on('reloadFx', (d: { id: string }) => {
      const rp = this.pm.getById(d.id)
      audio.reloadStage(rp?.weapon ?? 'rifle', 'out')
    })

    // server refilled our mag after a reload — update local copy (drives HUD + fire gate)
    socket.on('ammo', (d: { weapon?: string; mag?: number; reserve?: number }) => {
      const id = (d.weapon ?? '') as WeaponId
      const def = WEAPONS[id]
      if (!def || def.mag === Infinity) return
      this.ammo[id] = { mag: Math.max(0, Number(d.mag) || 0), reserve: Math.max(0, Number(d.reserve) || 0) }
    })

    socket.on('bomb', (d: { planted?: boolean; exploded?: boolean; defused?: boolean; pos?: number[]; explodeIn?: number }) => {
      if (d.planted && d.pos) {
        this.bombPlanted = true
        this.plantBar = null          // plant completed — drop the progress bar (it has no terminal event otherwise and would stick on screen)
        this.bombPos = new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2])
        this.bombExplodeAt = performance.now() + (d.explodeIn ?? ROUND.bombMs)
        this.bombMesh = buildBombMesh()
        this.bombMesh.position.copy(this.bombPos).add(new THREE.Vector3(0, 0.1, 0))
        this.scene.add(this.bombMesh)
        audio.bombPlanted()
        this.pushToast('The bomb has been planted!')
      } else if (d.exploded && d.pos) {
        this.defuseBar = null         // a defuse cut short by the explosion leaves no progress:0 event — clear it here
        const ex = new THREE.Vector3(d.pos[0], d.pos[1] + 0.5, d.pos[2])
        this.fx.explosion(ex)
        audio.bombExplode()
        // camera shake scaled by distance
        const dist = this.camera.position.distanceTo(ex)
        this.camShake = Math.max(this.camShake, THREE.MathUtils.clamp(1.6 - dist / 30, 0.25, 1.4))
        if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null }
        this.bombPlanted = false
      } else if (d.defused) {
        if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null }
        this.bombPlanted = false
        this.defuseBar = null
        audio.bombDefused()
        this.pushToast('The bomb has been defused!')
      }
    })

    socket.on('plantProgress', (d: { id: string; action: string; progress: number }) => {
      const t = performance.now()
      if (d.action === 'plant') {
        this.plantBar = d.id === this.myId ? (d.progress > 0 ? d.progress : null) : null
        if (d.progress < 0.05 && t - this.lastC4StageSfx > 800) { this.lastC4StageSfx = t; audio.c4Initiate() }
        else if (d.progress > 0.3 && d.progress < 0.4 && t - this.lastC4StageSfx > 300) { this.lastC4StageSfx = t; audio.plantTick() }
        else if (d.progress > 0.6 && d.progress < 0.7 && t - this.lastC4StageSfx > 300) { this.lastC4StageSfx = t; audio.plantTick() }
      } else if (d.action === 'defuse') {
        this.defuseBar = d.id === this.myId ? (d.progress > 0 ? d.progress : null) : null
        if (d.progress < 0.05 && t - this.lastC4StageSfx > 800) { this.lastC4StageSfx = t; audio.c4DisarmStart() }
      }
    })

    socket.on('gameover', (d: { winner: string; scores: { CT: number; T: number } }) => {
      this.gameover = d
      this.pushToast(`Match over — ${d.winner === 'CT' ? 'Counter-Terrorists' : 'Terrorists'} win!`)
    })

    socket.on('invSync', (d: { inventory: WeaponId[]; wIdx: number }) => {
      const prevW = this.inventory[this.wIdx]
      this.inventory = d.inventory
      if (typeof d.wIdx === 'number' && d.wIdx < this.inventory.length) this.wIdx = d.wIdx
      this.syncAmmo()
      // loadout changed server-side (round reset stripped weapons) — swap viewmodel
      const newW = this.inventory[this.wIdx]
      if (newW !== prevW) {
        this.rebuildViewmodel()
        audio.draw(newW ?? 'knife')
      }
    })

    socket.on('chat', (d: { id: string; name: string; team: string; text: string }) => {
      this.chat.push({ name: d.name, team: d.team, text: d.text, t: performance.now(), id: d.id })
      if (this.chat.length > 30) this.chat.shift()
    })

    socket.on('toast', (d: { msg: string }) => this.pushToast(d.msg))

    socket.on('buyOk', (d: { money: number; armor: number; helmet: boolean; inventory: WeaponId[]; wIdx: number; hasKit?: boolean }) => {
      const prevW = this.inventory[this.wIdx]
      this.money = d.money
      this.armor = d.armor
      this.helmet = d.helmet
      if (d.hasKit !== undefined) this.hasKit = d.hasKit
      this.inventory = d.inventory
      this.wIdx = d.wIdx ?? 0
      this.syncAmmo()
      const newW = this.inventory[this.wIdx]
      if (newW !== prevW) this.rebuildViewmodel()
      audio.buy()
    })

    socket.on('buyError', (d: { msg: string }) => {
      this.buyError = d.msg
      setTimeout(() => { this.buyError = null }, 1500)
    })

    socket.on('disconnect', () => {
      this.pushToast('Disconnected from server — reconnecting...')
    })
  }

  private applyMatch(m: Record<string, unknown>) {
    this.phase = (m.phase as string) ?? this.phase
    this.phaseEndsAt = performance.now() + ((m.endsIn as number) ?? 0)
    this.round = (m.round as number) ?? this.round
    if (m.scores) this.scores = m.scores as { CT: number; T: number }
    if (m.bombPlanted === false && this.bombPlanted) {
      // round reset: remove bomb mesh
      if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null }
      this.bombPlanted = false
      this.bombPos = null
      this.defuseBar = null
      this.plantBar = null
    }
    if (typeof m.winTarget === 'number') this.winTarget = m.winTarget
  }

  private pushToast(msg: string) {
    this.toasts.push({ msg, t: performance.now() })
    if (this.toasts.length > 4) this.toasts.shift()
  }

  private died(by: string | null) {
    this.alive = false
    this.deathBy = by
    this.firing = false
    this.burstRemaining = 0
    this.reloadEndsAt = 0
    this.cancelReloadSfx()
    this.setScopeLevel(0)
    audio.death()
    this.spectating = true
    this.specIdx = 0
  }

  /** Phase 8: create or server-sync a world grenade entry. */
  private trackNade(id: number, kind: GrenadeKind, pos: number[], vel: number[], at?: number) {
    let n = this.nadeWorld.get(id)
    if (!n) {
      n = {
        mesh: buildNadeMesh(kind), kind,
        vel: new THREE.Vector3(vel[0], vel[1], vel[2]),
        pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
        lastSyncAt: at ?? performance.now(), lastSeenAt: performance.now(), trailAt: 0,
      }
      n.mesh.position.copy(n.pos)
      this.scene.add(n.mesh)
      this.nadeWorld.set(id, n)
    } else {
      // reconcile: hard-snap if we drifted far, else blend toward server truth
      const sp = new THREE.Vector3(pos[0], pos[1], pos[2])
      if (n.pos.distanceTo(sp) > 1.5) n.pos.copy(sp)
      else n.pos.lerp(sp, 0.5)
      n.vel.set(vel[0], vel[1], vel[2])
      n.lastSyncAt = at ?? performance.now()
    }
    n.lastSeenAt = performance.now()
  }

  /** Purge all local grenade/smoke/fire visuals (round boundary). */
  private clearNadeWorld() {
    for (const n of this.nadeWorld.values()) this.scene.remove(n.mesh)
    this.nadeWorld.clear()
    for (const s of this.smokeWorld.values()) s.dispose()
    this.smokeWorld.clear()
    for (const f of this.fireWorld.values()) f.dispose()
    this.fireWorld.clear()
  }

  /**
   * Dead-reckon world grenades between snapshots (gravity + drag, the SAME
   * constants the server steps with), spin the bodies, drop a faint trail,
   * and reap entries the server stopped listing (detonated / round-cleared).
   */
  private updateNadeWorld(now: number, dt: number) {
    for (const [id, n] of [...this.nadeWorld]) {
      if (now - n.lastSeenAt > 300) {
        // server no longer lists it and no nadeFx removed it — reap quietly
        this.scene.remove(n.mesh)
        this.nadeWorld.delete(id)
        continue
      }
      if (now - n.lastSyncAt > 60) {
        // between syncs: step locally with the shared physics constants
        n.vel.y -= NADE.gravity * dt
        const damp = Math.max(0, 1 - NADE.drag * dt)
        n.vel.multiplyScalar(damp)
        n.pos.addScaledVector(n.vel, dt)
        if (n.pos.y < NADE.radius) {
          n.pos.y = NADE.radius
          if (n.vel.y < 0) n.vel.y = -n.vel.y * NADE.restitution
        }
        n.mesh.position.copy(n.pos)
      }
      n.mesh.rotation.x += 9 * dt
      n.mesh.rotation.z += 6 * dt
      // faint trail puffs while moving fast
      if (n.vel.lengthSq() > 6 && now - n.trailAt > 90) {
        n.trailAt = now
        this.fx.nadeTrailPuff(n.pos)
      }
    }
    for (const [id, s] of [...this.smokeWorld]) {
      if (!s.update(now, dt)) { s.dispose(); this.smokeWorld.delete(id) }
    }
    for (const [id, f] of [...this.fireWorld]) {
      if (!f.update(now, dt)) { f.dispose(); this.fireWorld.delete(id) }
    }
  }

  private cycleSpectate() {
    if (!this.spectating) return
    const mates = [...this.pm.players.values()].filter(p => p.team === this.myTeam && p.alive)
    if (!mates.length) return
    this.specIdx = (this.specIdx + 1) % mates.length
  }

  // ---------------------------------------------------------------- weapons
  private currentWeapon(): (typeof WEAPONS)[WeaponId] {
    return WEAPONS[this.inventory[this.wIdx] ?? 'knife'] ?? WEAPONS.knife
  }

  private syncAmmo() {
    for (const w of this.inventory) {
      const def = WEAPONS[w]
      if (!def || def.mag === Infinity) continue
      if (!this.ammo[w]) this.ammo[w] = { mag: def.mag, reserve: def.reserve }
    }
    // drop ammo for weapons no longer owned
    for (const k of Object.keys(this.ammo)) {
      if (!this.inventory.includes(k as WeaponId)) delete this.ammo[k as WeaponId]
    }
  }

  private switchSlot(slot: number) {
    let idx = this.inventory.findIndex(w => WEAPONS[w]?.slot === slot)
    // Phase 8: grenade slot cycles — pressing 5 again advances to the next
    // held grenade (CS behavior); wraps around
    if (slot === 5 && idx >= 0 && this.inventory[this.wIdx] !== undefined &&
        WEAPONS[this.inventory[this.wIdx]]?.slot === 5) {
      const entries = this.inventory.map((w, i) => WEAPONS[w]?.slot === 5 ? i : -1).filter(i => i >= 0)
      const cur = entries.indexOf(this.wIdx)
      idx = entries[(cur + 1) % entries.length]
    }
    if (idx >= 0 && idx !== this.wIdx) {
      this.lastW = this.wIdx
      this.wIdx = idx
      this.reloadEndsAt = 0
      this.cancelReloadSfx()
      this.recoil = 0
      this.burstRemaining = 0
      this.sustained = 0
      this.setScopeLevel(0)
      this.rebuildViewmodel()
      this.socket?.emit('switch', { wIdx: this.wIdx })
      audio.draw(this.inventory[this.wIdx])
    }
  }

  private switchLast() {
    if (this.lastW >= 0 && this.lastW < this.inventory.length && this.lastW !== this.wIdx) {
      const t = this.wIdx
      this.wIdx = this.lastW
      this.lastW = t
      this.reloadEndsAt = 0
      this.cancelReloadSfx()
      this.burstRemaining = 0
      this.setScopeLevel(0)
      this.rebuildViewmodel()
      this.socket?.emit('switch', { wIdx: this.wIdx })
      audio.draw(this.inventory[this.wIdx])
    }
  }

  /** Phase 5 multi-level scope: level 0 = hip; 1 = zoomFov; 2 = zoomFov/2. */
  private setScopeLevel(n: number) {
    const w = this.currentWeapon()
    this.scopeLevel = n
    this.scoped = n > 0
    this.camera.fov = n === 0 ? this.opts.fov : Math.max(6, zoomFovOf(w) / (n === 2 ? 2 : 1))
    this.camera.updateProjectionMatrix()
    if (this.vmGroup) this.vmGroup.visible = n === 0
  }

  private rebuildViewmodel() {
    if (this.vmGroup) {
      this.camera.remove(this.vmGroup)
      this.vmGroup = null
    }
    const w = this.inventory[this.wIdx] ?? 'knife'
    const key = `${w}:${this.myTeam}`
    let vm = this.vmCache.get(key)
    if (!vm) {
      // staged GLB first (knife bayonet + every staged gun — user request
      // 2026-10-19: "in first person camera i see old models in hand");
      // GLB vms carry no named parts, so per-part animations skip while the
      // whole-vm motion keeps running. Anything not staged (m249, negev,
      // taser, c4, grenades) falls through to the procedural builders.
      vm = (w === 'knife' ? buildGLBKnifeVM(this.myTeam) : buildGLBGunVM(w, this.myTeam, this.vmGlbScaleMul))
        ?? buildViewModel(w, this.myTeam)
      this.vmCache.set(key, vm)
    }
    this.vm = vm
    this.vmBasePos.copy(vmBase(w))
    // Staged GLB gun vms: real full-length stocks otherwise park ~17cm in
    // front of the eye and fill the screen (user 2026-10-19: "gun stock is
    // completely in screen"). Pull long-gun vms BACK so the stock butt ends
    // up behind the eye itself (not just the near plane — 0.13 still left a
    // stock wedge in the corner; user 2026-10-20) — the CS-style look
    // (stock behind your shoulder). Grip/hands/muzzle stay
    // in natural positions; tip/eject derive from vmBasePos so they follow.
    // Knife keeps its tuned base; per-weapon values if staged models diverge.
    const gv = (vm.group.userData as { glbVm?: string }).glbVm
    if (gv && gv !== 'knife' && WEAPONS[w as WeaponId]?.slot === 1) this.vmBasePos.z += GLB_VM_PULLBACK + this.vmGlbAdj
    const g = vm.group
    g.position.copy(this.vmBasePos)
    g.rotation.set(0, 0.06, 0)
    // remember part home transforms for the animation envelopes
    if (vm.slide) vm.slide.userData.homeZ = vm.slide.position.z
    if (vm.slideL) vm.slideL.userData.homeZ = vm.slideL.position.z
    if (vm.bolt) vm.bolt.userData.homeZ = vm.bolt.position.z
    if (vm.mag) vm.mag.userData.homeY = vm.mag.position.y
    this.camera.add(g)
    this.vmGroup = g
  }

  private tryReload() {
    const w = this.currentWeapon()
    if (w.mag === Infinity) return
    const am = this.ammo[w.id]
    if (!am || am.mag >= w.mag || am.reserve <= 0 || this.reloadEndsAt > performance.now()) return
    this.socket?.emit('reload', { weapon: w.id })
    this.reloadEndsAt = performance.now() + w.reloadMs
    // spawn a falling magazine copy in the world
    if (this.vm?.mag) {
      const wp = new THREE.Vector3()
      this.vm.mag.getWorldPosition(wp)
      this.fx.dropMag(wp)
    }
    // staged reload audio: real per-weapon samples — mag out now, mag in ~68%, slide/bolt rack at the end
    audio.reloadStage(w.id, 'out')
    this.cancelReloadSfx()
    this.reloadSfxTimers.push(
      setTimeout(() => audio.reloadStage(w.id, 'in'), Math.max(150, w.reloadMs * 0.68)),
      setTimeout(() => audio.reloadStage(w.id, 'rack'), Math.max(250, w.reloadMs - 170)),
    )
  }

  private cancelReloadSfx() {
    for (const t of this.reloadSfxTimers) clearTimeout(t)
    this.reloadSfxTimers = []
  }

  private spreadDeg(): number {
    const w = this.currentWeapon()
    let s = w.accurate
    // Phase 7 spool (negev): cold start sprays a wild cone, consecutive shots
    // settle it linearly to base accuracy; recoil's spread contribution
    // fades with the same ramp ("recoil eliminated after spool" — wiki)
    let recoilMul = 1
    const ramp = accuracyRampOf(w)
    if (ramp) {
      const t = Math.min(this.sustained / ramp.shots, 1)
      s = ramp.startSpread + (w.accurate - ramp.startSpread) * t
      recoilMul = 1 - 0.8 * t
    }
    s += this.recoil * (w.auto ? 0.3 : 0.55) * recoilMul
    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    s += (hSpeed / w.moveSpeed) * 1.9
    if (!this.onGround) s += 4.5
    if (this.crouchAmt > 0.5) s *= 0.78
    // unscoped sniper penalty (2-level) is crippling; scoped rifles (1-level) milder
    const lvls = scopeLevelsOf(w)
    if (lvls === 2 && !this.scoped) s = 5.2
    else if (lvls === 1 && !this.scoped) s += 1.6
    if (this.scoped) s *= 0.12
    return s
  }

  private tryFire() {
    if (!this.alive || this.phase === 'freeze' || this.phase === 'warmup') return
    const w = this.currentWeapon()
    if (w.id === 'c4') return // planting is via E
    const now = performance.now()
    // Phase 8: LMB = full-power grenade throw (RMB lobs); one per click
    if (w.throwable) {
      this.throwGrenade(1)
      this.lastShotAt = now
      return
    }
    const fm = fireModeOf(w)
    if (fm === 'burst') {
      // Phase 5 burst: in-burst cadence gate + retrigger gate (fireDelay).
      // The burst completes itself once triggered, even after mouse-up.
      const gap = now - this.lastShotAt
      if (this.burstRemaining > 0) {
        if (gap < (w.burstDelayMs ?? 75)) return
      } else {
        if (gap < w.fireDelay) return
        this.burstRemaining = w.burstRounds ?? 3
      }
    } else if (now - this.lastShotAt < w.fireDelay) {
      return
    }
    if (this.reloadEndsAt > now) return
    const am = this.ammo[w.id]
    if (w.id === 'knife') {
      this.lastShotAt = now
      this.fireKnife(w.id)
      return
    }
    if (!am || am.mag <= 0) {
      audio.dryFire(w.id)
      this.lastShotAt = now
      this.burstRemaining = 0 // dry mid-burst: stop the queue
      if (am && am.reserve > 0) this.tryReload()
      return
    }
    const prevShotAt = this.lastShotAt
    this.lastShotAt = now
    if (fm === 'burst') this.burstRemaining--
    am.mag--
    // Phase 7 spool (negev accuracy ramp): consecutive-shot counter — a
    // >400ms firing pause (trigger release, reload, desync) drops the gun
    // back to its cold wild cone; switch/round/death reset it explicitly
    if (now - prevShotAt > 400) this.sustained = 0
    this.sustained++

    // direction with spread
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const spreadRad = (this.spreadDeg() * Math.PI) / 180
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
    const up = new THREE.Vector3().crossVectors(right, dir)
    const rx = Math.sqrt(Math.random()) * (Math.random() < 0.5 ? -1 : 1)
    const rz = Math.sqrt(Math.random()) * (Math.random() < 0.5 ? -1 : 1)
    dir.addScaledVector(right, Math.tan(spreadRad) * rx)
      .addScaledVector(up, Math.tan(spreadRad) * rz)
      .normalize()

    // Phase 6: multi-pellet shotguns — the perturbed center dir becomes the
    // bore axis; the deterministic seeded fan spreads around it
    if (pelletsOf(w) > 1) {
      this.fireShotgun(w, dir)
      return
    }

    this.raycaster.set(this.camera.position, dir)
    // zeus: short-range electric arc (knife-like reach, not a ballistic gun)
    this.raycaster.far = w.id === 'taser' ? 6 : 200
    const hitboxes = this.pm.hitboxMeshes()
    const hits = this.raycaster.intersectObjects([...hitboxes, ...this.map.raycastMeshes], false)
    const hit = hits.find(h => h.distance > 0.2)

    const muzzle = this.muzzleWorld()
    let end = this.camera.position.clone().addScaledVector(dir, 200)
    if (hit) {
      end = hit.point
      const ud = hit.object.userData as { pid?: string; part?: HitPart }
      if (ud && ud.pid) {
        // enemy hit
        const rp = this.pm.getById(ud.pid)
        if (rp) {
          if (rp.team !== this.myTeam) {
            this.socket?.emit('hit', { target: ud.pid, part: ud.part, dist: hit.distance, weapon: w.id })
            this.fx.blood(hit.point, dir)
            // local instant feedback
            this.hitmarkerAt = performance.now()
            if (ud.part === 'head') { this.headshotAt = performance.now(); audio.headshotDing() }
            else audio.hitmarker()
            audio.gunshot(w.id)
          } else {
            // teammate: just blood, no damage
            this.fx.blood(hit.point, dir)
          }
        }
      } else {
        // map hit
        const surf = (hit.object.userData as { surf?: string }).surf
        const nrm = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : undefined
        this.fx.impact(hit.point, nrm, surf)
        audio.impact()
        audio.gunshot(w.id)
      }
    } else {
      audio.gunshot(w.id)
    }

    // suppressed guns (m4a1s / usp / mp5): no tracer, small flash — hiding
    // the shooter is the point of the suppressor
    if (!w.suppressed) this.fx.tracer(muzzle, end)
    this.fx.muzzleFlash(muzzle, !!w.suppressed)
    // eject the casing from the actual ejection port, not the muzzle
    if (this.vmGroup && this.vm?.eject) {
      this.fx.shell(this.vmGroup.localToWorld(this.vm.eject.clone()), right)
    } else {
      this.fx.shell(muzzle, right)
    }

    // recoil — ramped guns (negev) fade the kick with the spool: "recoil
    // is eliminated after sustained fire" (CS:GO wiki) — the laser settles
    this.recoil = Math.min(this.recoil + 1, 18)
    const ramp = accuracyRampOf(w)
    const spoolT = ramp ? Math.min(this.sustained / ramp.shots, 1) : 0
    const kick = (KICK[w.id] ?? 0.5) * (Math.PI / 180) * (ramp ? 1 - 0.75 * spoolT : 1)
    this.pitch += kick
    this.yaw += (Math.random() - 0.5) * kick * 0.6 + Math.sin(this.recoil * 2.1) * 0.00035
    this.vmKick = 1
    // part animations: pistol slide blowback / AWP bolt cycle / dual berettas
    // alternate the cycling gun with every shot (fire left/right)
    if (this.vm?.slideL) this.slideLeft = !this.slideLeft
    if (this.vm?.slide || this.vm?.slideL) this.slideKickAt = now
    if (this.vm?.bolt) this.boltCycleAt = now
    // bolt-action guns (semi + bolt rechamber) unscope per shot (existing AWP
    // feel); auto scoped guns (sg553/aug/scar20/g3sg1) stay scoped while firing
    if (this.scoped && !w.auto) { this.setScopeLevel(0) }

    this.socket?.emit('shoot', {
      weapon: w.id,
      origin: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      dir: [dir.x, dir.y, dir.z],
    })
  }

  /**
   * Phase 6 multi-pellet fire (plan 6.1): deterministic seeded fan around the
   * perturbed bore axis. Client predicts: per-pellet raycasts (tracer fan,
   * blood, wall pocks) and per-pellet hit CLAIMS — the server owns all the
   * numbers (distance/falloff/armor/aggregation, see handleShotgunHit).
   * One shell = one gunshot, one flash, one ejected hull, one recoil kick —
   * the FAN is the only multiplied thing.
   */
  private fireShotgun(w: (typeof WEAPONS)[WeaponId], dir: THREE.Vector3) {
    const now = performance.now()
    const pellets = pelletsOf(w)
    const seed = (Math.random() * 0xffffffff) >>> 0 || 1
    const dirs = pelletDirs(seed, pellets, pelletSpreadOf(w), { x: dir.x, y: dir.y, z: dir.z })
    const hitboxes = this.pm.hitboxMeshes()
    const claims: Array<{ target: string; part: HitPart }> = []
    const blooded = new Set<string>()
    let anyHead = false
    let mapPocks = 0
    const tracerEnds: Array<{ d: THREE.Vector3; end: THREE.Vector3 }> = []
    for (const pd of dirs) {
      const pdir = new THREE.Vector3(pd.x, pd.y, pd.z)
      this.raycaster.set(this.camera.position, pdir)
      this.raycaster.far = 60        // shotguns are a close-range argument
      const hits = this.raycaster.intersectObjects([...hitboxes, ...this.map.raycastMeshes], false)
      const hit = hits.find(h => h.distance > 0.2)
      let end = this.camera.position.clone().addScaledVector(pdir, 60)
      if (hit) {
        end = hit.point
        const ud = hit.object.userData as { pid?: string; part?: HitPart }
        if (ud?.pid) {
          const rp = this.pm.getById(ud.pid)
          if (rp && rp.team !== this.myTeam) {
            claims.push({ target: ud.pid, part: ud.part ?? 'body' })
            if (ud.part === 'head') anyHead = true
            if (!blooded.has(ud.pid)) { this.fx.blood(hit.point, pdir); blooded.add(ud.pid) }
          }
        } else if (mapPocks < 4) {
          // one wall-puff cluster per blast, not 9 overlapping puffs
          const surf = (hit.object.userData as { surf?: string }).surf
          this.fx.impact(hit.point, hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : undefined, surf)
          mapPocks++
        }
      }
      tracerEnds.push({ d: pdir, end })
    }

    // claims ride their own event; the single-ray 'hit' path is server-blocked
    // for shotguns (per-shot pellet budget lives there)
    if (claims.length) {
      this.socket?.emit('pellets', { weapon: w.id, pellets: claims })
      this.hitmarkerAt = now                 // local instant feedback; server confirms totals
      if (anyHead) { this.headshotAt = now; audio.headshotDing() }
      else audio.hitmarker()
    }

    // visuals + audio: ONE report for the whole shell
    audio.gunshot(w.id)
    if (mapPocks > 0) audio.impact()
    const muzzle = this.muzzleWorld()
    for (const t of tracerEnds) this.fx.tracer(muzzle, t.end)
    this.fx.muzzleFlash(muzzle, false)
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
    if (this.vmGroup && this.vm?.eject) {
      this.fx.shell(this.vmGroup.localToWorld(this.vm.eject.clone()), right)
    } else {
      this.fx.shell(muzzle, right)
    }

    // recoil — one mule kick for the shell
    this.recoil = Math.min(this.recoil + 1, 18)
    const kick = (KICK[w.id] ?? 2.4) * (Math.PI / 180)
    this.pitch += kick
    this.yaw += (Math.random() - 0.5) * kick * 0.6 + Math.sin(this.recoil * 2.1) * 0.00035
    this.vmKick = 1
    // pump guns cycle the fore-end after the shot (audio pump comes from the
    // audio map's bolt slot — 300ms after the report)
    if (this.vm?.pump) this.pumpAt = now

    this.socket?.emit('shoot', {
      weapon: w.id,
      origin: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      dir: [dir.x, dir.y, dir.z],
      seed,
    })
  }

  /**
   * Phase 8 (plan 8.3): LMB full throw / RMB underhand lob. The pin pulls
   * audibly + the lever swings out on the viewmodel, then the 'throw' event
   * goes to the server which owns origin, velocity and physics — the local
   * mesh appears with the next 'nade' broadcast (≤ 50 ms, 20 Hz stream).
   */
  private throwGrenade(power: number) {
    if (!this.alive || this.phase !== 'live') return
    const w = this.currentWeapon()
    if (!w.throwable) return
    const now = performance.now()
    if (now - this.lastThrowAt < NADE.throwCooldownMs) return
    this.lastThrowAt = now

    // aim direction from the camera (pitch up = arcs)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize()

    // pin + release: sounds and the vm pin-out anim
    audio.pinPull()
    setTimeout(() => audio.throwSfx(), 120)
    this.pinPullAt = performance.now()
    this.vmKick = 1

    this.socket?.emit('throw', { weapon: w.id, dir: [dir.x, dir.y, dir.z], power })

    // local inventory: remove one copy of this grenade; if none remain,
    // fall back to slot 0 (primary/pistol). The server's invSync confirms.
    const idx = this.inventory.lastIndexOf(w.id)
    if (idx >= 0) this.inventory.splice(idx, 1)
    if (this.inventory[this.wIdx] !== w.id) {
      const j = this.inventory.indexOf(w.id)
      this.wIdx = j >= 0 ? j : 0
      this.rebuildViewmodel()
      this.socket?.emit('switch', { wIdx: this.wIdx })
      audio.draw(this.inventory[this.wIdx])
    }
  }

  private fireKnife(weapon: WeaponId) {
    audio.knifeSwing()
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    this.raycaster.set(this.camera.position, dir)
    this.raycaster.far = 2.3
    const hits = this.raycaster.intersectObjects([...this.pm.hitboxMeshes(), ...this.map.raycastMeshes], false)
    const hit = hits.find(h => h.distance > 0.2)
    if (hit) {
      const ud = hit.object.userData as { pid?: string; part?: HitPart }
      if (ud?.pid) {
        const rp = this.pm.getById(ud.pid)
        if (rp && rp.team !== this.myTeam) {
          this.socket?.emit('hit', { target: ud.pid, part: ud.part ?? 'body', dist: hit.distance, weapon })
          this.fx.blood(hit.point, dir)
          audio.knifeHit()
        }
      } else {
        const surf = (hit.object.userData as { surf?: string }).surf
        this.fx.impact(hit.point, hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : undefined, surf)
      }
    }
    this.vmKick = 0.6
    this.slashAt = performance.now()
    this.socket?.emit('shoot', { weapon: 'knife', origin: [this.camera.position.x, this.camera.position.y, this.camera.position.z], dir: [dir.x, dir.y, dir.z] })
  }

  private muzzleWorld(): THREE.Vector3 {
    const w = this.currentWeapon()
    const key = `${w.id}:${this.myTeam}`
    let vm = this.vmCache.get(key)
    if (!vm) {
      vm = (w.id === 'knife' ? buildGLBKnifeVM(this.myTeam) : buildGLBGunVM(w.id, this.myTeam))
        ?? buildViewModel(w.id, this.myTeam)
      this.vmCache.set(key, vm)
    }
    return this.camera.localToWorld(new THREE.Vector3(
      this.vmBasePos.x, this.vmBasePos.y + 0.04, this.vmBasePos.z + vm.tip.z))
  }

  // ---------------------------------------------------------------- movement
  private playerHeight() { return STAND_H - this.crouchAmt * (STAND_H - CROUCH_H) }

  private overlapsAt(x: number, y: number, z: number): boolean {
    const h = this.playerHeight()
    const r = PLAYER_R
    for (const c of this.map.colliders) {
      if (x + r > c.min.x && x - r < c.max.x &&
        y + h > c.min.y && y < c.max.y &&
        z + r > c.min.z && z - r < c.max.z) return true
    }
    return false
  }

  private movePlayer(dt: number) {
    const w = this.currentWeapon()
    const crouching = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC')
    // stay crouched while there is no headroom to stand
    const wantCrouch = crouching || (this.crouchAmt > 0.02 && this.blockedStanding())
    this.crouchAmt += ((wantCrouch ? 1 : 0) - this.crouchAmt) * Math.min(1, 10 * dt)
    const walking = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')

    let maxSpeed = w.moveSpeed
    if (walking) maxSpeed *= 0.52
    if (this.crouchAmt > 0.3) maxSpeed *= 0.4
    if (this.scoped) maxSpeed *= 0.5

    const frozen = this.phase === 'freeze' || this.phase === 'warmup' || !this.alive
      || this.menuOpen || this.buyOpen || this.chatOpen // no movement while any menu is open (incl. keys held from before)
    const wish = new THREE.Vector3()
    if (!frozen) {
      if (this.keys.has('KeyW')) { wish.x -= Math.sin(this.yaw); wish.z -= Math.cos(this.yaw) }
      if (this.keys.has('KeyS')) { wish.x += Math.sin(this.yaw); wish.z += Math.cos(this.yaw) }
      if (this.keys.has('KeyA')) { wish.x -= Math.cos(this.yaw); wish.z += Math.sin(this.yaw) }
      if (this.keys.has('KeyD')) { wish.x += Math.cos(this.yaw); wish.z -= Math.sin(this.yaw) }
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(maxSpeed)
    }

    const accel = this.onGround ? 12 : 2.2
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt)
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt)

    // jump
    if (!frozen && this.keys.has('Space') && this.onGround) {
      this.vel.y = JUMP_V
      this.onGround = false
    }

    // gravity
    this.vel.y -= GRAVITY * dt
    if (this.vel.y < -35) this.vel.y = -35

    // airborne crouch-jump: tuck the feet up (gains ~0.55m of jump reach)
    this.tuck = (!this.onGround && this.crouchAmt > 0.5) ? CROUCH_TUCK : 0

    // X axis
    this.pos.x += this.vel.x * dt
    this.resolveHorizontal('x')
    // Z axis
    this.pos.z += this.vel.z * dt
    this.resolveHorizontal('z')
    // Y axis (swept: catches tunneling through thin floors on frame hitches)
    const fallV = this.vel.y
    const prevFeet = this.pos.y + this.tuck
    this.pos.y += this.vel.y * dt
    this.onGround = false
    const h = this.playerHeight()
    // v2: land on the HIGHEST matching top (was: last match in array order —
    // snagged players DOWN onto lower staircase strips, then the higher neighbor
    // strips became un-climbable walls). Head-bonk uses the LOWEST ceiling.
    let landY: number | null = null
    let ceilY: number | null = null
    for (const c of this.map.colliders) {
      const feet = this.pos.y + this.tuck
      if (this.pos.x + PLAYER_R > c.min.x && this.pos.x - PLAYER_R < c.max.x &&
        feet + h > c.min.y && feet < c.max.y + Math.max(0, prevFeet - feet) &&
        this.pos.z + PLAYER_R > c.min.z && this.pos.z - PLAYER_R < c.max.z) {
        if (this.vel.y <= 0.01 && (feet > c.max.y - 0.3 || prevFeet >= c.max.y - 0.001)) {
          landY = landY === null ? c.max.y : Math.max(landY, c.max.y)
        } else if (this.vel.y > 0 && feet + h > c.min.y && prevFeet + h <= c.min.y + 0.001) {
          ceilY = ceilY === null ? c.min.y : Math.min(ceilY, c.min.y)
        }
      }
    }
    if (landY !== null) {
      this.pos.y = landY
      this.vel.y = 0
      this.onGround = true
      this.tuck = 0
      if (fallV < -3) this.landDip = Math.min(0.24, (-fallV - 3) * 0.022) // camera dip on landing
      if (fallV < -FALL_SAFE_V) this.fallDamage(fallV)
    } else if (ceilY !== null) {
      this.pos.y = ceilY - h - this.tuck - 0.001
      this.vel.y = 0
    }
    if (this.pos.y < -6) { // failsafe — recover to this map's CT spawn (never a foreign-map coord)
      const s = this.mapDef?.spawns?.CT?.[0]
      if (s) { this.pos.set(s.x, s.y + 0.1, s.z) } else { this.pos.set(0, 2, 0) }
      this.vel.set(0, 0, 0); this.eyeY = this.pos.y + 1.6
    }

    // footsteps
    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    if (this.onGround && hSpeed > 1.5 && !walking && this.crouchAmt < 0.3) {
      this.stepAccum += dt * hSpeed
      if (this.stepAccum > 2.4) {
        this.stepAccum = 0
        audio.footstep(true)
      }
    }
  }

  private resolveHorizontal(axis: 'x' | 'z') {
    const h = this.playerHeight()
    for (const c of this.map.colliders) {
      const feet = this.pos.y + this.tuck // live — re-read after in-loop step-ups
      if (this.pos.x + PLAYER_R > c.min.x && this.pos.x - PLAYER_R < c.max.x &&
        feet + h > c.min.y && feet < c.max.y &&
        this.pos.z + PLAYER_R > c.min.z && this.pos.z - PLAYER_R < c.max.z) {
        // try step up (grounded climbing only - never while crouch-tucked in air)
        const rise = c.max.y - this.pos.y
        if (rise <= 0.01) continue // feet level with this top (staircase-seam float) — not a horizontal blocker
        if (this.tuck === 0 && rise <= STEP_UP && this.vel.y <= 0.1) {
          if (!this.overlapsAt(this.pos.x, c.max.y + 0.02, this.pos.z)) {
            this.pos.y = c.max.y + 0.02
            this.onGround = true
            continue
          }
        }
        // push out along the axis, toward the side we penetrated from
        if (axis === 'x') {
          this.pos.x = this.pos.x > c.box.x ? c.max.x + PLAYER_R + 0.001 : c.min.x - PLAYER_R - 0.001
          this.vel.x = 0
        } else {
          this.pos.z = this.pos.z > c.box.z ? c.max.z + PLAYER_R + 0.001 : c.min.z - PLAYER_R - 0.001
          this.vel.z = 0
        }
      }
    }
  }

  // would the standing-height collider overlap anything here? (uncrouch headroom check)
  private blockedStanding(): boolean {
    for (const c of this.map.colliders) {
      if (this.pos.x + PLAYER_R > c.min.x && this.pos.x - PLAYER_R < c.max.x &&
        this.pos.y + STAND_H > c.min.y && this.pos.y < c.max.y &&
        this.pos.z + PLAYER_R > c.min.z && this.pos.z - PLAYER_R < c.max.z) return true
    }
    return false
  }

  // landing impact damage (validated server-side)
  private fallDamage(v: number) {
    const dmg = Math.round((-v - FALL_SAFE_V) * 5.5)
    if (dmg < 4) return
    const t = performance.now()
    if (t - this.lastFallAt < 400) return
    this.lastFallAt = t
    this.damageAt = t
    this.pushToast(`Fall damage: -${dmg} HP`)
    this.socket?.emit('selfdamage', { dmg, reason: 'fall' })
  }

  // ---------------------------------------------------------------- loop
  private loop = () => {
    if (!this.running || this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    this.loopTick++
    const now = performance.now()
    let dt = (now - this.lastT) / 1000
    this.lastT = now
    if (dt > 0.1) dt = 0.1

    // sound listener orientation for stereo panning of positional sfx
    this.camera.getWorldDirection(this.sndFwd)
    audio.setListener([this.sndFwd.x, this.sndFwd.y, this.sndFwd.z])

    // fps
    this.fpsCounter++
    if (now - this.fpsAt > 500) {
      this.fps = Math.round(this.fpsCounter * 1000 / (now - this.fpsAt))
      this.fpsAt = now
      this.fpsCounter = 0
    }

    if (this.alive) this.movePlayer(dt)
    else this.vel.set(0, 0, 0)

    // recoil decay
    this.recoil = Math.max(0, this.recoil - dt * 6)
    this.vmKick = Math.max(0, this.vmKick - dt * 9)
    this.camShake = Math.max(0, this.camShake - dt * 2.2)
    this.landDip = Math.max(0, this.landDip - dt * 1.6)

    // auto fire
    if (this.firing && this.currentWeapon().auto && this.alive) this.tryFire()
    // Phase 5: a triggered burst runs to completion even after mouse-up;
    // holding a burst gun retriggers bursts at the fireDelay gate
    const cw = this.currentWeapon()
    if (this.alive && (this.burstRemaining > 0 || (this.firing && fireModeOf(cw) === 'burst'))) this.tryFire()

    // slow cloud drift + skybox follows camera (never clips through far plane)
    if (this.map.sky) {
      this.map.sky.rotation.y += dt * 0.004
      this.map.sky.position.set(this.camera.position.x, 0, this.camera.position.z)
    }

    // camera
    const eye = EYE_STAND - this.crouchAmt * (EYE_STAND - EYE_CROUCH)
    if (this.spectating && !this.alive) {
      const mates = [...this.pm.players.values()].filter(p => p.team === this.myTeam && p.alive)
      if (mates.length) {
        const m = mates[this.specIdx % mates.length]
        this.camera.position.set(m.root.position.x, m.root.position.y + 1.62, m.root.position.z)
        this.camera.rotation.set(0, m.root.rotation.y, 0, 'YXZ')
      } else {
        this.camera.position.set(this.pos.x, this.pos.y + 1.2, this.pos.z)
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
      }
    } else {
      // smooth eye height: absorbs stair steps, tracks jumps/falls exactly
      if (!this.onGround || Math.abs(this.pos.y - this.eyeY) > 0.9) this.eyeY = this.pos.y
      else this.eyeY += (this.pos.y - this.eyeY) * Math.min(1, 26 * dt)
      const dip = Math.sin(Math.min(1, this.landDip / 0.22) * Math.PI) * this.landDip * 0.55
      this.camera.position.set(this.pos.x, this.eyeY + eye - dip, this.pos.z)
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
      // camera shake (explosions / damage)
      if (this.camShake > 0) {
        const s = this.camShake * this.camShake
        this.camera.position.x += (Math.random() - 0.5) * 0.22 * s
        this.camera.position.y += (Math.random() - 0.5) * 0.22 * s
        this.camera.position.z += (Math.random() - 0.5) * 0.22 * s
        this.camera.rotation.z += (Math.random() - 0.5) * 0.015 * s
      }
    }

    // viewmodel: bob + kick + mouse sway + recoil spring
    if (this.vmGroup) {
      const hSpeed = Math.hypot(this.vel.x, this.vel.z)
      this.bobPhase += dt * hSpeed * 3.4
      const bobA = Math.min(1, hSpeed / 5) * (this.onGround ? 1 : 0.2)
      // mouse-lag sway
      const dYaw = this.yaw - this.prevYaw
      const dPitch = this.pitch - this.prevPitch
      this.prevYaw = this.yaw
      this.prevPitch = this.pitch
      const targetX = THREE.MathUtils.clamp(dYaw * 1.8, -0.06, 0.06)
      const targetY = THREE.MathUtils.clamp(dPitch * 1.4, -0.05, 0.05)
      this.swayX += (targetX - this.swayX) * Math.min(1, 12 * dt)
      this.swayY += (targetY - this.swayY) * Math.min(1, 12 * dt)
      const dip = this.landDip * 0.35
      // reload animation: gun drops + rolls while the mag is out, returns before the slide rack
      let rl = 0
      if (this.reloadEndsAt > now) {
        const w = this.currentWeapon()
        const total = Math.max(1, w.reloadMs)
        const remaining = this.reloadEndsAt - now
        const inT = Math.min(1, (total - remaining) / (total * 0.22))
        const outT = Math.min(1, remaining / (total * 0.28))
        rl = Math.min(inT, outT)
      }
      this.vmGroup.position.set(
        this.vmBasePos.x + Math.cos(this.bobPhase) * 0.008 * bobA - this.swayX * 0.5,
        this.vmBasePos.y + Math.abs(Math.sin(this.bobPhase)) * 0.01 * bobA - this.crouchAmt * 0.02 - this.swayY * 0.5 - dip - rl * 0.14,
        this.vmBasePos.z + this.vmKick * 0.07 + rl * 0.07,
      )
      // knife slash arc (diagonal chop)
      let slashRoll = 0, slashPitch = 0
      const st = (now - this.slashAt) / 240
      if (st >= 0 && st < 1) {
        const e = Math.sin(Math.PI * st)
        slashRoll = -0.85 * e
        slashPitch = 0.22 * e
      }
      this.vmGroup.rotation.set(
        this.vmKick * 0.16 + this.swayY * 1.6 + rl * 0.62 + slashPitch,
        0.06 + this.swayX * 1.8 + rl * 0.25,
        Math.sin(this.bobPhase) * 0.006 * bobA - this.swayX * 0.8 + rl * 0.42 + slashRoll,
      )

      // ---- animated weapon parts (slide blowback / AWP bolt / mag swap / C4 LED)
      const vm = this.vm
      if (vm) {
        if (vm.slide && vm.slideL) {
          // dual berettas: only the gun that just fired cycles; the other sits home.
          // k clamps to 1 on the firing frame itself — auto-fire sets slideKickAt
          // with a fresher performance.now() than this frame-top `now`, and the
          // kick should render AT the shot, not one frame late (Task 64).
          const act = this.slideLeft ? vm.slideL : vm.slide
          const idle = this.slideLeft ? vm.slide : vm.slideL
          const k = Math.min(1, Math.max(0, 1 - (now - this.slideKickAt) / 120))
          act.position.z = (act.userData.homeZ as number) + k * 0.034
          idle.position.z = idle.userData.homeZ as number
        } else if (vm.slide) {
          // same min-clamp: full 34mm blowback on the firing frame, then the
          // 120ms decay (Task 64 — also drives the GLB AK dust cover)
          const k = Math.min(1, Math.max(0, 1 - (now - this.slideKickAt) / 120))
          vm.slide.position.z = (vm.slide.userData.homeZ as number) + k * 0.034
        }
        if (vm.bolt) {
          const t = (now - this.boltCycleAt) / 1050
          const homeZ = vm.bolt.userData.homeZ as number
          if (t >= 0 && t < 1) {
            // 0-0.15 handle lift, 0.15-0.45 pull back, 0.45-0.8 push forward, 0.8-1 drop
            if (t < 0.15) { vm.bolt.rotation.z = -0.95 * (t / 0.15); vm.bolt.position.z = homeZ }
            else if (t < 0.45) { vm.bolt.rotation.z = -0.95; vm.bolt.position.z = homeZ + 0.068 * ((t - 0.15) / 0.3) }
            else if (t < 0.8) { vm.bolt.rotation.z = -0.95; vm.bolt.position.z = homeZ + 0.068 * (1 - (t - 0.45) / 0.35) }
            else { vm.bolt.position.z = homeZ; vm.bolt.rotation.z = -0.95 * (1 - (t - 0.8) / 0.2) }
          } else {
            vm.bolt.position.z = homeZ
            vm.bolt.rotation.z = 0
          }
        }
        if (vm.pump) {
          // Phase 6 shotgun fore-end: recoil pause, rack back, slam forward
          // (~520ms cycle; the pump SOUND rides the audio map's bolt slot)
          const t = (now - this.pumpAt) / 520
          const homeZ = vm.pump.userData.homeZ as number
          if (t >= 0 && t < 1) {
            let dz = 0
            if (t < 0.2) dz = 0                                   // recoil settles
            else if (t < 0.5) dz = 0.075 * ((t - 0.2) / 0.3)      // pull back
            else dz = 0.075 * (1 - (t - 0.5) / 0.3)               // slam home
            vm.pump.position.z = homeZ + dz
          } else {
            vm.pump.position.z = homeZ
          }
        }
        if (vm.pin) {
          // Phase 8: pin/lever swings out + flies away after the throw
          const t = (now - this.pinPullAt) / 500
          if (t >= 0 && t < 1) {
            vm.pin.rotation.x = -1.4 * Math.sin(Math.PI * Math.min(1, t * 1.6))
            vm.pin.position.y = 0.02 * t
            vm.pin.visible = t < 0.85
          } else if (t >= 1) {
            vm.pin.visible = false
          } else {
            vm.pin.visible = true
            vm.pin.rotation.x = 0
            vm.pin.position.y = 0
          }
        }
        if (vm.mag) {
          if (vm.mag.userData.fixed) {
            // tube-fed shotguns: shells load through the port — the tube never
            // drops out (mag7's box mag is the exception and animates normally)
            vm.mag.visible = true
          } else {
            const homeY = vm.mag.userData.homeY as number
            if (this.reloadEndsAt > now) {
              const w = this.currentWeapon()
              const rp = 1 - (this.reloadEndsAt - now) / Math.max(1, w.reloadMs)
              vm.mag.visible = !(rp > 0.18 && rp < 0.72)
              // fresh mag slides up into the well during 0.72-0.86
              vm.mag.position.y = (rp > 0.72 && rp < 0.86) ? homeY - 0.05 * (1 - (rp - 0.72) / 0.14) : homeY
            } else {
              vm.mag.visible = true
              vm.mag.position.y = homeY
            }
          }
        }
        if (vm.led) {
          const on = Math.floor(now / 620) % 2 === 0
          ;(vm.led.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff2828 : 0x2a0606)
        }
      }
    }

    // bomb beep + LED blink
    if (this.bombPlanted && this.bombMesh && this.bombPos) {
      const remain = Math.max(0, this.bombExplodeAt - now)
      const interval = remain > 20000 ? 1000 : remain > 10000 ? 550 : remain > 5000 ? 320 : 160
      if (now - this.lastBeepAt > interval) {
        this.lastBeepAt = now
        const myEye = this.camera.position
        audio.bombBeep(remain < 10000)
        const d = Math.hypot(this.bombPos.x - myEye.x, this.bombPos.y - myEye.y, this.bombPos.z - myEye.z)
        if (d > 40) { /* too far to hear */ }
      }
      const led = (this.bombMesh as THREE.Group & { userData: { led?: THREE.Mesh } }).userData.led
      if (led) led.visible = Math.floor(now / 220) % 2 === 0
      // defuse bar clear when not defusing
      if (this.defuseBar !== null && this.defuseBar >= 1) this.defuseBar = null
    }
    if (this.plantBar !== null && (this.phase !== 'live')) this.plantBar = null

    // remote players interp
    this.pm.update(now, this.myId)
    this.fx.update(dt, this.camera.position)
    // Phase 8: world grenade dead-reckoning + smoke/fire lifecycles
    this.updateNadeWorld(now, dt)

    // network state push (20Hz)
    if (now - this.stateSentAt > 50) {
      this.stateSentAt = now
      const moving = Math.hypot(this.vel.x, this.vel.z) > 1.2
      this.socket?.emit('state', {
        x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
        yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3),
        crouch: this.crouchAmt > 0.5, moving, walking: this.keys.has('ShiftLeft'),
        wIdx: this.wIdx,
      })
    }

    // HUD push (10Hz)
    if (now - this.hudAt > 100) {
      this.hudAt = now
      this.pushHud()
    }

    this.renderer.render(this.scene, this.camera)
  }

  // ---------------------------------------------------------------- hud state
  private pushHud() {
    const now = performance.now()
    const w = this.currentWeapon()
    const am = this.ammo[w.id] ?? { mag: 0, reserve: 0 }
    // prune old feed/chat
    this.killfeed = this.killfeed.filter(k => now - k.t < 6500)
    this.chat = this.chat.filter(c => now - c.t < 30000)
    this.toasts = this.toasts.filter(t => now - t.t < 4000)
    if (this.banner && this.phase === 'live') this.banner = null

    // scoreboard
    const scoreboard: ScoreRow[] = []
    scoreboard.push({ id: this.myId, name: this.opts.name, team: this.myTeam, kills: this.kills, deaths: this.deaths, money: this.money, bot: false, alive: this.alive, self: true })
    for (const p of this.pm.players.values()) {
      scoreboard.push({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, money: p.money, bot: p.bot, alive: p.alive, self: false })
    }
    scoreboard.sort((a, b) => (b.kills - a.kills) || a.name.localeCompare(b.name))

    const timerLeft = Math.max(0, Math.ceil((this.phaseEndsAt - now) / 1000))
    const bombLeft = this.bombPlanted ? Math.max(0, (this.bombExplodeAt - now) / 1000) : 0

    const state: HudState = {
      connected: !!this.socket?.connected,
      joined: !!this.myId,
      phase: this.phase,
      mapName: this.mapDef.name,
      timer: this.bombPlanted && this.phase === 'live' ? bombLeft : timerLeft,
      round: this.round,
      scores: this.scores,
      winTarget: this.winTarget,
      team: this.myTeam,
      alive: this.alive,
      hp: Math.round(this.hp),
      armor: Math.round(this.armor),
      helmet: this.helmet,
      money: this.money,
      weapon: this.inventory[this.wIdx] ?? 'knife',
      inventory: this.inventory,
      wIdx: this.wIdx,
      ammo: w.throwable ? { mag: this.inventory.filter(x => x === w.id).length, reserve: 0 }
        : w.mag === Infinity ? { mag: -1, reserve: -1 } : am,
      reloading: this.reloadEndsAt > now,
      scoped: this.scoped,
      hasBomb: this.hasBomb,
      bombPlanted: this.bombPlanted,
      bombTimer: bombLeft,
      defuseBar: this.defuseBar,
      plantBar: this.plantBar,
      canBuy: this.phase === 'freeze' || (this.phase === 'live' && (this.phaseEndsAt - now) > ROUND.liveMs - ROUND.buyWindowMs),
      killfeed: [...this.killfeed],
      chat: [...this.chat],
      scoreboard,
      hitmarkerAge: now - this.hitmarkerAt,
      headshotAge: now - this.headshotAt,
      damageAge: now - this.damageAt,
      deathBy: this.deathBy,
      banner: this.phase === 'post' ? this.banner : (this.phase === 'freeze' ? this.banner : null),
      toasts: [...this.toasts],
      spread: this.spreadDeg(),
      fps: this.fps,
      specTarget: this.spectating && !this.alive ? 'spectating' : null,
      gameover: this.gameover,
      buyError: this.buyError,
      pointerLocked: this.pointerLocked,
      canPlant: this.mapDef.bomb !== false && this.phase === 'live' && this.alive && this.hasBomb && this.myTeam === 'T' && this.inSiteNow(),
      canDefuse: this.phase === 'live' && this.alive && this.myTeam === 'CT' && this.bombPlanted && !!this.bombPos && Math.hypot(this.pos.x - this.bombPos.x, this.pos.z - this.bombPos.z) < 2,
      scoreboardOpen: this.scoreboardOpen,
      flash: this.alive ? Math.max(0, Math.min(1, (this.blindUntil - now) / 2000)) : 0,
      hasKit: this.hasKit,
      grenadeCount: w.throwable ? this.inventory.filter(x => x === w.id).length : 0,
    }
    this.hudCb(state)
    // debugging/verification hook (harmless in production)
    if (typeof window !== 'undefined') {
      (window as unknown as { __cs2hud?: HudState }).__cs2hud = state
    }
  }

  private inSiteNow(): boolean {
    for (const s of [this.mapDef.sites.A, this.mapDef.sites.B]) {
      if (Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < s.r && Math.abs(this.pos.y - s.y) < 2.5) return true
    }
    return false
  }

  // ---------------------------------------------------------------- public api
  buy(item: string) {
    const def = WEAPONS[item as WeaponId]
    const price = def?.price ?? GEAR.find(g => g.id === item)?.price
    if (price !== undefined && price > 0 && this.money < price) { audio.cantBuy(); return }
    this.socket?.emit('buy', { item })
  }

  sendChat(text: string) {
    this.socket?.emit('chat', { text })
  }

  setSensitivity(v: number) { this.opts.sensitivity = v }
  setVolume(v: number) { audio.setVolume(v) }
  setFov(v: number) {
    this.opts.fov = v
    if (!this.scoped) { this.camera.fov = v; this.camera.updateProjectionMatrix() }
  }

  getMapVersion() { return this.mapDef.version }
  getMapId(): MapId { return this.mapDef.id }
  getMapName(): string { return this.mapDef.name }

  /** Swap the whole map scene (used when the server's room map differs from our guess). */
  private rebuildMap(mapId: MapId) {
    const def = MAPS[mapId]
    if (!def || def.id === this.mapDef?.id) return
    // remove old map + details + sky
    this.scene.remove(this.map.group)
    this.scene.remove(this.map.sky)
    // old detail group is a child of scene — remove by tag
    for (const child of [...this.scene.children]) {
      if ((child as THREE.Group).userData?.isDetails) this.scene.remove(child)
    }
    this.mapDef = def
    this.applyAtmosphere(mapId)   // Task 77: fog + light palette per map
    this.map = buildMap(this.scene, def)
    const details = buildDetails(def)
    details.group.userData.isDetails = true
    this.scene.add(details.group)
    this.map.raycastMeshes.push(...details.raycastMeshes)
  }

  /** Task 77 — per-map atmosphere: dust/dust2 = warm desert haze + tan bounce;
   * aimhead = de_aztec mood (pale jungle-blue fog, cool sky hemi, green ground
   * bounce, whiter sun). Colors only — position/intensity/shadows untouched. */
  private applyAtmosphere(mapId: MapId) {
    const aztec = mapId === 'aimhead'
    const a = this.atmo
    if (!a) return
    a.fog.color.set(aztec ? 0xcfe0e8 : 0xd9cfb4)
    a.fog.near = aztec ? 60 : 55
    a.fog.far = aztec ? 260 : 240
    a.hemi.color.set(aztec ? 0xdce8f0 : 0xe6e2d2)
    a.hemi.groundColor.set(aztec ? 0x5e7a68 : 0x8a7a5e)
    a.ambient.color.set(aztec ? 0xb6c4bd : 0xc9b896)
    a.sun.color.set(aztec ? 0xfff6e0 : 0xfff0d0)
  }
}
