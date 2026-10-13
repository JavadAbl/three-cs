// CS2-clone game engine (client)
import * as THREE from 'three'
import { io } from 'socket.io-client'
import { WEAPONS, ECONOMY, ROUND } from './weapons'
import type { WeaponId, TeamId, HitPart } from './weapons'
import { MAP_VERSION, SITES } from './dust2'
import { buildMap } from './mapview'
import type { MapBuild } from './mapview'
import { PlayerManager } from './players'
import { Effects, buildViewModel, buildBombMesh } from './fx'
import { audio } from './audio'

export interface KillFeedItem { killer: string; victim: string; weapon: string; hs: boolean; killerTeam: string; victimTeam: string; t: number }
export interface ChatItem { name: string; team: string; text: string; t: number; id: string }
export interface ScoreRow { id: string; name: string; team: TeamId; kills: number; deaths: number; money: number; bot: boolean; alive: boolean; self: boolean }

export interface HudState {
  connected: boolean
  joined: boolean
  phase: string
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
}

export interface EngineOpts {
  name: string
  team: 'CT' | 'T' | 'auto'
  room: string
  botFill: boolean
  botDifficulty: 'easy' | 'normal' | 'hard'
  winTarget: number
  sensitivity: number
  volume: number
  fov: number
}

const PLAYER_R = 0.4
const STAND_H = 1.8
const CROUCH_H = 1.3
const EYE_STAND = 1.62
const EYE_CROUCH = 1.08
const GRAVITY = 22
const JUMP_V = 7.4
const STEP_UP = 0.55

const KICK: Partial<Record<WeaponId, number>> = {
  ak47: 0.55, m4: 0.42, mp5: 0.22, deagle: 1.3, awp: 2.2, glock: 0.55, usp: 0.6,
}

export class Engine {
  private canvas: HTMLCanvasElement
  private renderer!: THREE.WebGLRenderer
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private map!: MapBuild
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
  private keys = new Set<string>()
  private firing = false
  private wantScope = false

  // weapons
  private inventory: WeaponId[] = ['usp', 'knife']
  private wIdx = 0
  private ammo: Partial<Record<WeaponId, { mag: number; reserve: number }>> = {}
  private lastShotAt = 0
  private reloadEndsAt = 0
  private recoil = 0
  private scoped = false
  private vmGroup: THREE.Group | null = null
  private vmCache = new Map<WeaponId, { group: THREE.Group; tip: THREE.Vector3 }>()
  private vmKick = 0
  private bobPhase = 0
  private lastW = 0

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

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xd8cdb0, 60, 220)

    this.camera = new THREE.PerspectiveCamera(this.opts.fov, window.innerWidth / window.innerHeight, 0.05, 400)
    this.scene.add(this.camera)

    // lights
    const hemi = new THREE.HemisphereLight(0xdde8f0, 0x9a8a68, 0.85)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.1)
    sun.position.set(40, 60, 20)
    this.scene.add(sun)

    this.map = buildMap(this.scene)
    this.fx = new Effects(this.scene)
    this.pm = new PlayerManager(this.scene, this.myTeam)

    audio.init()
    audio.setVolume(this.opts.volume)

    this.bindEvents()
    this.connect()

    this.running = true
    this.lastT = performance.now()
    this.loop()
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
    const sens = this.opts.sensitivity * (this.scoped ? 0.28 : 1) * 0.0022
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
      if (w.scope && this.alive) {
        this.wantScope = !this.wantScope
        this.setScoped(this.wantScope)
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
    this.keys.add(k)
    if (k === 'KeyR') this.tryReload()
    if (k === 'Digit1') this.switchSlot(1)
    if (k === 'Digit2') this.switchSlot(2)
    if (k === 'Digit3') this.switchSlot(3)
    if (k === 'Digit4') this.switchSlot(4)
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
  private connect() {
    const socket = io('/?XTransformPort=3003', { path: '/' })
    this.socket = socket

    socket.on('connect', () => {
      socket.emit('join', {
        name: this.opts.name,
        room: this.opts.room,
        team: this.opts.team,
        botFill: this.opts.botFill,
        botDifficulty: this.opts.botDifficulty,
        winTarget: this.opts.winTarget,
      })
    })

    socket.on('joinError', (d: { msg: string }) => {
      this.pushToast(d.msg)
    })

    socket.on('init', (d: {
      youId: string; team: TeamId; money: number; inventory: WeaponId[]
      mapVersion: number; players: Array<Record<string, unknown>>; match: Record<string, unknown>
    }) => {
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
        this.yaw = (me.yaw as number) ?? 0
      }
      this.pushToast(`Connected — room "${this.opts.room}"`)
    })

    socket.on('playerJoined', (p: Record<string, unknown>) => {
      if (p.id === this.myId) return
      this.pm.getOrCreate(p.id as string, p.name as string, p.team as TeamId, p.bot as boolean)
    })

    socket.on('playerLeft', (d: { id: string }) => this.pm.remove(d.id))

    socket.on('snapshot', (d: { t: number; ps: unknown[][] }) => {
      const rt = performance.now()
      for (const row of d.ps) {
        const id = row[0] as string
        if (id === this.myId) {
          this.hp = row[10] as number
          this.armor = row[11] as number
          const alive = row[12] === 1
          this.hasBomb = row[13] === 1
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
        rp.weapon = row[14] as string
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
        this.scoped = false; this.wantScope = false
        this.setScoped(false)
        this.deathBy = null
        this.spectating = false
        this.specIdx = 0
        this.wIdx = 0
        this.reloadEndsAt = 0
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
        audio.damageTaken()
      }
    })

    socket.on('shot', (d: { id: string; weapon: string; origin: number[]; dir: number[] }) => {
      // remote shot fx
      const o = new THREE.Vector3(d.origin[0], d.origin[1], d.origin[2])
      const dir = new THREE.Vector3(d.dir[0], d.dir[1], d.dir[2])
      // find map hit for tracer end
      this.raycaster.set(o, dir)
      this.raycaster.far = 150
      const hits = this.raycaster.intersectObjects(this.map.raycastMeshes, false)
      const end = hits.length ? hits[0].point : o.clone().addScaledVector(dir, 120)
      this.fx.tracer(o.clone().addScaledVector(dir, 0.8), end)
      this.fx.muzzleFlash(o.clone().addScaledVector(dir, 0.5))
      const myEye = this.camera.position
      audio.gunshot(d.weapon, d.origin as [number, number, number], [myEye.x, myEye.y, myEye.z])
    })

    socket.on('reloadFx', () => audio.reloadClick())

    socket.on('bomb', (d: { planted?: boolean; exploded?: boolean; defused?: boolean; pos?: number[]; explodeIn?: number }) => {
      if (d.planted && d.pos) {
        this.bombPlanted = true
        this.bombPos = new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2])
        this.bombExplodeAt = performance.now() + (d.explodeIn ?? ROUND.bombMs)
        this.bombMesh = buildBombMesh()
        this.bombMesh.position.copy(this.bombPos).add(new THREE.Vector3(0, 0.1, 0))
        this.scene.add(this.bombMesh)
        audio.bombPlanted()
        this.pushToast('The bomb has been planted!')
      } else if (d.exploded && d.pos) {
        this.fx.explosion(new THREE.Vector3(d.pos[0], d.pos[1] + 0.5, d.pos[2]))
        audio.bombExplode()
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
      if (d.action === 'plant') {
        this.plantBar = d.id === this.myId ? (d.progress > 0 ? d.progress : null) : null
      } else if (d.action === 'defuse') {
        this.defuseBar = d.id === this.myId ? (d.progress > 0 ? d.progress : null) : null
      }
    })

    socket.on('gameover', (d: { winner: string; scores: { CT: number; T: number } }) => {
      this.gameover = d
      this.pushToast(`Match over — ${d.winner === 'CT' ? 'Counter-Terrorists' : 'Terrorists'} win!`)
    })

    socket.on('invSync', (d: { inventory: WeaponId[]; wIdx: number }) => {
      this.inventory = d.inventory
      if (typeof d.wIdx === 'number' && d.wIdx < this.inventory.length) this.wIdx = d.wIdx
      this.syncAmmo()
    })

    socket.on('chat', (d: { id: string; name: string; team: string; text: string }) => {
      this.chat.push({ name: d.name, team: d.team, text: d.text, t: performance.now(), id: d.id })
      if (this.chat.length > 30) this.chat.shift()
    })

    socket.on('toast', (d: { msg: string }) => this.pushToast(d.msg))

    socket.on('buyOk', (d: { money: number; armor: number; helmet: boolean; inventory: WeaponId[]; wIdx: number }) => {
      this.money = d.money
      this.armor = d.armor
      this.helmet = d.helmet
      this.inventory = d.inventory
      this.wIdx = d.wIdx ?? 0
      this.syncAmmo()
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
    this.setScoped(false)
    this.scoped = false; this.wantScope = false
    audio.death()
    this.spectating = true
    this.specIdx = 0
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
    const idx = this.inventory.findIndex(w => WEAPONS[w]?.slot === slot)
    if (idx >= 0 && idx !== this.wIdx) {
      this.lastW = this.wIdx
      this.wIdx = idx
      this.reloadEndsAt = 0
      this.recoil = 0
      this.setScoped(false)
      this.wantScope = false
      this.rebuildViewmodel()
      this.socket?.emit('switch', { wIdx: this.wIdx })
      audio.switchWeapon()
    }
  }

  private switchLast() {
    if (this.lastW < this.inventory.length) {
      const t = this.wIdx
      this.wIdx = this.lastW
      this.lastW = t
      this.reloadEndsAt = 0
      this.rebuildViewmodel()
      this.socket?.emit('switch', { wIdx: this.wIdx })
      audio.switchWeapon()
    }
  }

  private setScoped(v: boolean) {
    this.scoped = v
    this.camera.fov = v ? 16 : this.opts.fov
    this.camera.updateProjectionMatrix()
    if (this.vmGroup) this.vmGroup.visible = !v
  }

  private rebuildViewmodel() {
    if (this.vmGroup) {
      this.camera.remove(this.vmGroup)
      this.vmGroup = null
    }
    const w = this.inventory[this.wIdx] ?? 'knife'
    let vm = this.vmCache.get(w)
    if (!vm) {
      vm = buildViewModel(w)
      this.vmCache.set(w, vm)
    }
    const g = vm.group
    g.position.set(0.26, -0.24, -0.45)
    g.rotation.set(0, 0.06, 0)
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
    audio.reloadClick()
  }

  private spreadDeg(): number {
    const w = this.currentWeapon()
    let s = w.accurate
    s += this.recoil * (w.auto ? 0.3 : 0.55)
    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    s += (hSpeed / w.moveSpeed) * 1.9
    if (!this.onGround) s += 4.5
    if (this.crouchAmt > 0.5) s *= 0.78
    if (w.scope && !this.scoped) s = 5.2
    if (this.scoped) s *= 0.12
    return s
  }

  private tryFire() {
    if (!this.alive || this.phase === 'freeze' || this.phase === 'warmup') return
    const w = this.currentWeapon()
    if (w.id === 'c4') return // planting is via E
    const now = performance.now()
    if (now - this.lastShotAt < w.fireDelay) return
    if (this.reloadEndsAt > now) return
    const am = this.ammo[w.id]
    if (w.id === 'knife') {
      this.lastShotAt = now
      this.fireKnife(w.id)
      return
    }
    if (!am || am.mag <= 0) {
      audio.dryFire()
      this.lastShotAt = now
      if (am && am.reserve > 0) this.tryReload()
      return
    }
    this.lastShotAt = now
    am.mag--

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

    this.raycaster.set(this.camera.position, dir)
    this.raycaster.far = 200
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
            this.fx.blood(hit.point)
            // local instant feedback
            this.hitmarkerAt = performance.now()
            if (ud.part === 'head') { this.headshotAt = performance.now(); audio.headshotDing() }
            else audio.hitmarker()
            audio.gunshot(w.id)
          } else {
            // teammate: just blood, no damage
            this.fx.blood(hit.point)
          }
        }
      } else {
        // map hit
        this.fx.impact(hit.point, hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : undefined)
        audio.gunshot(w.id)
      }
    } else {
      audio.gunshot(w.id)
    }

    this.fx.tracer(muzzle, end)
    this.fx.muzzleFlash(muzzle)
    this.fx.shell(muzzle, right)

    // recoil
    this.recoil = Math.min(this.recoil + 1, 18)
    const kick = (KICK[w.id] ?? 0.5) * (Math.PI / 180)
    this.pitch += kick
    this.yaw += (Math.random() - 0.5) * kick * 0.6 + Math.sin(this.recoil * 2.1) * 0.00035
    this.vmKick = 1
    if (w.scope && this.scoped) { this.setScoped(false); this.wantScope = false }

    this.socket?.emit('shoot', {
      weapon: w.id,
      origin: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      dir: [dir.x, dir.y, dir.z],
    })
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
          this.fx.blood(hit.point)
          audio.knifeHit()
        }
      } else {
        this.fx.impact(hit.point)
      }
    }
    this.vmKick = 0.6
    this.socket?.emit('shoot', { weapon: 'knife', origin: [this.camera.position.x, this.camera.position.y, this.camera.position.z], dir: [dir.x, dir.y, dir.z] })
  }

  private muzzleWorld(): THREE.Vector3 {
    const w = this.currentWeapon()
    let vm = this.vmCache.get(this.inventory[this.wIdx] ?? 'knife')
    if (!vm) {
      vm = buildViewModel(w.id)
      this.vmCache.set(w.id, vm)
    }
    return this.camera.localToWorld(new THREE.Vector3(0.26, -0.2, -0.45 + vm.tip.z))
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
    this.crouchAmt += ((crouching ? 1 : 0) - this.crouchAmt) * Math.min(1, 10 * dt)
    const walking = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')

    let maxSpeed = w.moveSpeed
    if (walking) maxSpeed *= 0.52
    if (this.crouchAmt > 0.3) maxSpeed *= 0.4
    if (this.scoped) maxSpeed *= 0.5

    const frozen = this.phase === 'freeze' || this.phase === 'warmup' || !this.alive
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

    // X axis
    this.pos.x += this.vel.x * dt
    this.resolveHorizontal('x')
    // Z axis
    this.pos.z += this.vel.z * dt
    this.resolveHorizontal('z')
    // Y axis
    this.pos.y += this.vel.y * dt
    this.onGround = false
    const h = this.playerHeight()
    for (const c of this.map.colliders) {
      if (this.pos.x + PLAYER_R > c.min.x && this.pos.x - PLAYER_R < c.max.x &&
        this.pos.y + h > c.min.y && this.pos.y < c.max.y &&
        this.pos.z + PLAYER_R > c.min.z && this.pos.z - PLAYER_R < c.max.z) {
        if (this.vel.y <= 0.01 && this.pos.y > c.max.y - 0.3) {
          this.pos.y = c.max.y
          this.vel.y = 0
          this.onGround = true
        } else if (this.vel.y > 0) {
          this.pos.y = c.min.y - h - 0.001
          this.vel.y = 0
        }
      }
    }
    if (this.pos.y < -6) { // failsafe
      this.pos.set(0, 2, 40); this.vel.set(0, 0, 0)
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
      if (this.pos.x + PLAYER_R > c.min.x && this.pos.x - PLAYER_R < c.max.x &&
        this.pos.y + h > c.min.y && this.pos.y < c.max.y &&
        this.pos.z + PLAYER_R > c.min.z && this.pos.z - PLAYER_R < c.max.z) {
        // try step up
        const rise = c.max.y - this.pos.y
        if (rise > 0.01 && rise <= STEP_UP && this.vel.y <= 0.1) {
          if (!this.overlapsAt(this.pos.x, c.max.y + 0.02, this.pos.z)) {
            this.pos.y = c.max.y + 0.02
            this.onGround = true
            continue
          }
        }
        if (axis === 'x') {
          this.pos.x = this.vel.x > 0 ? c.min.x - PLAYER_R - 0.001 : c.max.x + PLAYER_R + 0.001
          this.vel.x = 0
        } else {
          this.pos.z = this.vel.z > 0 ? c.min.z - PLAYER_R - 0.001 : c.max.z + PLAYER_R + 0.001
          this.vel.z = 0
        }
      }
    }
  }

  // ---------------------------------------------------------------- loop
  private loop = () => {
    if (!this.running || this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    let dt = (now - this.lastT) / 1000
    this.lastT = now
    if (dt > 0.1) dt = 0.1

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

    // auto fire
    if (this.firing && this.currentWeapon().auto && this.alive) this.tryFire()

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
      this.camera.position.set(this.pos.x, this.pos.y + eye, this.pos.z)
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
    }

    // viewmodel bob & kick
    if (this.vmGroup) {
      const hSpeed = Math.hypot(this.vel.x, this.vel.z)
      this.bobPhase += dt * hSpeed * 3.4
      const bobA = Math.min(1, hSpeed / 5) * (this.onGround ? 1 : 0.2)
      this.vmGroup.position.set(
        0.26 + Math.cos(this.bobPhase) * 0.008 * bobA,
        -0.24 + Math.abs(Math.sin(this.bobPhase)) * 0.01 * bobA - this.crouchAmt * 0.02,
        -0.45 + this.vmKick * 0.06,
      )
      this.vmGroup.rotation.set(this.vmKick * 0.14, 0.06, Math.sin(this.bobPhase) * 0.006 * bobA)
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
      ammo: w.mag === Infinity ? { mag: -1, reserve: -1 } : am,
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
      canPlant: this.phase === 'live' && this.alive && this.hasBomb && this.myTeam === 'T' && this.inSiteNow(),
      canDefuse: this.phase === 'live' && this.alive && this.myTeam === 'CT' && this.bombPlanted && !!this.bombPos && Math.hypot(this.pos.x - this.bombPos.x, this.pos.z - this.bombPos.z) < 2,
      scoreboardOpen: this.scoreboardOpen,
    }
    this.hudCb(state)
    // debugging/verification hook (harmless in production)
    if (typeof window !== 'undefined') {
      (window as unknown as { __cs2hud?: HudState }).__cs2hud = state
    }
  }

  private inSiteNow(): boolean {
    for (const s of [SITES.A, SITES.B]) {
      if (Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < s.r && Math.abs(this.pos.y - s.y) < 2.5) return true
    }
    return false
  }

  // ---------------------------------------------------------------- public api
  buy(item: string) {
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

  getMapVersion() { return MAP_VERSION }
}
