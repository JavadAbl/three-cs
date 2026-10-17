import { WEAPONS } from './weapons'
import type { WeaponId, TeamId, HitPart } from './weapons'
import { MAPS } from './mapdata'
import type { MapDef, WP } from './mapdata'
import type { PlayerState, Match, BotBrain } from './types'

export const BOT_NAMES = [
  'Wolf', 'Cobra', 'Viper', 'Rex', 'Blaze', 'Ghost', 'Falcon', 'Storm',
  'Steel', 'Stormy', 'Rock', 'Bull', 'Hawk', 'Fox', 'Rhino', 'Panther',
]

interface Diff { reaction: number; aimErr: number; headChance: number; moveJitter: number }
const DIFFS: Record<string, Diff> = {
  easy: { reaction: 600, aimErr: 0.075, headChance: 0.06, moveJitter: 0.6 },
  normal: { reaction: 330, aimErr: 0.040, headChance: 0.14, moveJitter: 0.35 },
  hard: { reaction: 170, aimErr: 0.022, headChance: 0.26, moveJitter: 0.15 },
}

// context injected by index.ts to avoid circular imports
interface BotCtx {
  applyDamage?: (m: Match, victim: PlayerState, attacker: PlayerState | null, weapon: WeaponId, part: HitPart, dist: number, hs: boolean) => void
  hasLOS?: (m: Match, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean
}
export const botCtx: BotCtx = {}
export function setBotContext(c: BotCtx) { Object.assign(botCtx, c) }

// ---------------- per-map waypoint graphs ----------------
interface MapGraph {
  def: MapDef
  nodeById: Map<string, WP>
  adj: Map<string, string[]>
  aHold: string[]
  bHold: string[]
  midHold: string[]
  aRoutes: Array<[string, string]>
  bRoutes: Array<[string, string]>
  tHoldA: string
  tHoldB: string
  plantA: string
  plantB: string
  watch: Record<string, [number, number]> // node id -> face this point while holding
}

function buildGraph(def: MapDef, cfg: Omit<MapGraph, 'def' | 'nodeById' | 'adj'>): MapGraph {
  const nodeById = new Map(def.waypoints.map(w => [w.id, w]))
  const adj = new Map<string, string[]>()
  for (const [a, b] of def.waypointEdges) {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }
  return { def, nodeById, adj, ...cfg }
}

const GRAPHS: Record<string, MapGraph> = {
  dust: buildGraph(MAPS.dust, {
    aHold: ['aDefault', 'aRampTop', 'aPit'],
    bHold: ['bDoors', 'bPlat', 'bSite'],
    midHold: ['doorsGap', 'ctMid'],
    aRoutes: [['longDoors', 'aDefault'], ['catGap', 'aDefault']],
    bRoutes: [['tunN', 'bSite']],
    tHoldA: 'aShort',
    tHoldB: 'bCar',
    plantA: 'aDefault',
    plantB: 'bSite',
    watch: {
      aDefault: [39, -24], aRampTop: [6, -31], bDoors: [-32, -30], bPlat: [-30, -16],
      doorsGap: [1, 10], ctMid: [1, 10], aPit: [36, -10],
    },
  }),
  dust2: buildGraph(MAPS.dust2, {
    aHold: ['aDefault', 'aGoose', 'aNE', 'aCar'],
    bHold: ['bSite', 'bPlatTop', 'bNW', 'bDoorsW'],
    midHold: ['midDoors', 'ctMid', 'xboxE'],
    aRoutes: [['longDoorsN', 'aDefault'], ['catBase', 'aDefault']],
    bRoutes: [['tunMid', 'bSite'], ['lowTunMid', 'bSite']],
    tHoldA: 'aSW',
    tHoldB: 'bSE',
    plantA: 'aDefault',
    plantB: 'bSite',
    watch: {
      aDefault: [39, -12], aGoose: [30, -32], aNE: [28, -36], aCar: [26, -32],
      bSite: [-24, -33], bPlatTop: [-30, -34], bNW: [-30, -34], bDoorsW: [-11, -33],
      midDoors: [4, 10], ctMid: [4, 10], xboxE: [4, 22], bSE: [-20, -24],
      aSW: [23, -34],
    },
  }),
  aimhead: buildGraph(MAPS.aimhead, {
    // v3 face-driven conversion (ramp staircases fixed): CT west terrace (site A), T east terrace (site B), mid = valley
    aHold: ['ah111', 'ah1050', 'ah1049', 'ah112'],
    bHold: ['ah987', 'ah879', 'ah878', 'ah444'],
    midHold: ['ah323', 'ah1205', 'ah237', 'ah1175'],
    aRoutes: [['ah987', 'ah111']],
    bRoutes: [['ah111', 'ah987']],
    tHoldA: 'ah987',
    tHoldB: 'ah111',
    plantA: 'ah111',
    plantB: 'ah987',
    watch: {
      // CT holds face east (toward T), T holds face west
      ah111: [25, 0], ah1050: [25, 0], ah1049: [25, 0], ah112: [25, 0],
      ah987: [-25, 0], ah879: [-25, 0], ah878: [-25, 0], ah444: [-25, 0],
      ah323: [25, 0], ah1205: [-25, 0], ah237: [25, 0], ah1175: [-25, 0],
    },
  }),
}

function graphFor(m: Match): MapGraph {
  return GRAPHS[m.mapId] ?? GRAPHS.dust
}

function bfs(from: string, to: string, g: MapGraph): string[] {
  if (from === to) return [to]
  const prev = new Map<string, string>()
  const q = [from]
  const seen = new Set([from])
  while (q.length) {
    const cur = q.shift()!
    for (const nx of g.adj.get(cur) ?? []) {
      if (seen.has(nx)) continue
      seen.add(nx)
      prev.set(nx, cur)
      if (nx === to) {
        const path: string[] = [to]
        let c = to
        while (prev.has(c)) { c = prev.get(c)!; path.unshift(c) }
        path.shift() // drop the current node itself
        return path
      }
      q.push(nx)
    }
  }
  return []
}

function nearestNode(x: number, z: number, g: MapGraph): string {
  let best = g.def.waypoints[0].id, bd = Infinity
  for (const w of g.def.waypoints) {
    const d = Math.hypot(w.x - x, w.z - z)
    if (d < bd) { bd = d; best = w.id }
  }
  return best
}

export function defaultBrain(): BotBrain {
  return {
    path: [], goal: '', role: 'rush', site: 'A',
    holdYaw: 0, engageTarget: null, lastSeenAt: 0, nextShotAt: 0,
    burstLeft: 0, reactAt: 0, strafeDir: 1, strafeUntil: 0,
    stuckAt: 0, lastX: 0, lastZ: 0,
  }
}

export function resetBotForRound(m: Match, p: PlayerState) {
  p.ai ??= defaultBrain()
  const ai = p.ai
  ai.path = []; ai.goal = ''
  ai.engageTarget = null; ai.nextShotAt = 0; ai.burstLeft = 0
  ai.stuckAt = 0; ai.lastX = p.x; ai.lastZ = p.z
  if (p.team === 'T') {
    // mostly agree on one site
    const site: 'A' | 'B' = Math.random() < 0.6 ? 'A' : 'B'
    ai.site = site
    ai.role = Math.random() < 0.75 ? 'rush' : 'hold'
  } else {
    const g = graphFor(m)
    const pools = [g.aHold, g.aHold, g.bHold, g.bHold, g.midHold]
    const idx = [...m.players.values()].filter(q => q.bot && q.team === 'CT').indexOf(p)
    const spot = pools[idx % pools.length]
    ai.site = spot === g.aHold ? 'A' : spot === g.bHold ? 'B' : 'MID'
    ai.goal = spot[Math.floor(Math.random() * spot.length)]
    if (spot === g.midHold) ai.role = 'hold'
    else ai.role = Math.random() < 0.3 ? 'hold' : 'rush'
  }
}

export function botBuy(m: Match, p: PlayerState) {
  const buy = (id: WeaponId): boolean => {
    const w = WEAPONS[id]
    if (!w || p.money < w.price) return false
    if (w.team && w.team !== p.team) return false
    p.money -= w.price
    p.inventory = p.inventory.filter(x => WEAPONS[x]?.slot !== w.slot || x === 'knife')
    p.inventory.unshift(id)
    p.ammo[id] = { mag: w.mag, reserve: w.reserve }
    p.wIdx = 0
    return true
  }
  const armor = (helm: boolean): boolean => {
    const price = helm ? 1000 : 650
    if (p.money < price || p.armor >= 100) return false
    p.money -= price
    p.armor = 100
    if (helm) p.helmet = true
    return true
  }
  if (m.round === 1) {
    // pistol round
    if (p.money >= 700 && Math.random() < 0.5) buy('deagle')
    if (p.money >= 650) armor(false)
    return
  }
  const awpChance = m.round > 2 ? 0.15 : 0
  if (awpChance > 0 && Math.random() < awpChance && p.money >= 4750) { buy('awp'); armor(true); return }
  const rifle: WeaponId = p.team === 'T' ? 'ak47' : 'm4'
  if (p.money >= WEAPONS[rifle].price + 650) { buy(rifle); armor(true); return }
  if (p.money >= WEAPONS[rifle].price) { buy(rifle); return }
  if (p.money >= 1500) { buy('mp5'); if (p.money >= 650) armor(false); return }
  if (p.money >= 700) buy('deagle')
  if (p.money >= 650) armor(false)
}

// ---------------- per-tick update (100ms) ----------------
export function updateBots(m: Match, t: number) {
  for (const p of m.players.values()) {
    if (!p.bot || !p.ai) continue
    try { updateBot(m, p, t) } catch { /* keep server alive */ }
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

function eyeY(p: PlayerState) { return p.y + (p.crouch ? 1.1 : 1.5) }

function updateBot(m: Match, p: PlayerState, t: number) {
  const ai = p.ai!
  const diff = DIFFS[m.botDifficulty] ?? DIFFS.normal

  if (!p.alive) { ai.engageTarget = null; ai.path = []; return }
  if (m.phase !== 'live' && m.phase !== 'freeze') return
  if (p.reloadEndsAt > t) return

  // ---------- enemy scan ----------
  let best: PlayerState | null = null
  let bestD = Infinity
  for (const e of m.players.values()) {
    if (e.team === p.team || !e.alive) continue
    const dx = e.x - p.x, dz = e.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > 55) continue
    const yawTo = Math.atan2(-dx, -dz)
    const fovLimit = ai.engageTarget === e.id ? 2.4 : 1.05
    if (Math.abs(angleDiff(p.yaw, yawTo)) > fovLimit && d > 3) continue
    if (!botCtx.hasLOS?.(m, p.x, eyeY(p), p.z, e.x, e.y + 1.3, e.z)) continue
    if (d < bestD) { bestD = d; best = e }
  }

  if (best) {
    if (ai.engageTarget !== best.id) {
      ai.engageTarget = best.id
      const reaction = diff.reaction * (0.7 + Math.random() * 0.6)
      ai.reactAt = t + reaction
      ai.nextShotAt = t + reaction
      ai.burstLeft = 3 + Math.floor(Math.random() * 5)
      ai.lastSeenAt = t
    } else {
      ai.lastSeenAt = t
    }
  } else {
    const cur = ai.engageTarget ? m.players.get(ai.engageTarget) : null
    if (!cur || !cur.alive || t - ai.lastSeenAt > 2600) ai.engageTarget = null
  }

  const target = ai.engageTarget ? m.players.get(ai.engageTarget) ?? null : null

  // ---------- freeze phase: face forward ----------
  if (m.phase === 'freeze') {
    p.moving = false
    p.yaw = (p.team === 'T' ? 0 : Math.PI) + Math.sin(t / 1900 + hash(p.id)) * 0.25
    return
  }

  // ---------- engaging ----------
  if (target && target.alive) {
    const dx = target.x - p.x, dz = target.z - p.z
    const d = Math.max(0.6, Math.hypot(dx, dz))
    p.plantingSince = 0
    p.defusingSince = 0
    p.moving = false
    const aimYaw = Math.atan2(-dx, -dz)
    const aimPitch = Math.atan2((target.y + 1.2) - eyeY(p), d)
    p.yaw = aimYaw
    p.pitch = aimPitch
    // strafe wiggle
    if (t > ai.strafeUntil) {
      ai.strafeDir = Math.random() < 0.5 ? -1 : 1
      ai.strafeUntil = t + 500 + Math.random() * 900
    }
    const w = WEAPONS[p.inventory[p.wIdx] ?? 'knife']
    const speed = w.moveSpeed * 0.45
    const perpX = -dz / d, perpZ = dx / d
    p.x += perpX * ai.strafeDir * speed * 0.1
    p.z += perpZ * ai.strafeDir * speed * 0.1

    // shooting
    if (t >= ai.reactAt && t >= ai.nextShotAt) {
      const am = p.ammo[w.id]
      if (w.id === 'knife') {
        if (d < 2.2) { botShoot(m, p, target, w, d, diff, t, ai); ai.nextShotAt = t + w.fireDelay }
      } else if (!am || am.mag > 0) {
        if (ai.burstLeft <= 0) {
          ai.nextShotAt = t + 450 + Math.random() * 750
          ai.burstLeft = 3 + Math.floor(Math.random() * 5)
        } else {
          botShoot(m, p, target, w, d, diff, t, ai)
          if (am) am.mag--
          ai.burstLeft--
          ai.nextShotAt = t + w.fireDelay
        }
      } else if (am && am.reserve > 0) {
        // reload
        p.reloadEndsAt = t + w.reloadMs
        setTimeout(() => {
          if (am.reserve > 0) {
            const need = w.mag - am.mag
            const take = Math.min(need, am.reserve)
            am.mag += take; am.reserve -= take
          }
        }, w.reloadMs)
      }
    }
    return
  }

  // ---------- navigation ----------
  p.pitch = 0
  navigate(m, p, ai, t)
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h % 100) / 100
}

function navigate(m: Match, p: PlayerState, ai: BotBrain, t: number) {
  const bomb = m.bomb
  const g = graphFor(m)
  const sites = g.def.sites

  // objective goals
  if (p.team === 'T') {
    if (bomb.planted && !bomb.exploded) {
      // defend near bomb
      if (!ai.path.length && !ai.goal.startsWith('def')) {
        const siteNodes = ai.site === 'A' ? g.aHold : g.bHold
        ai.goal = 'def' + siteNodes[Math.floor(Math.random() * siteNodes.length)]
        ai.path = bfs(nearestNode(p.x, p.z, g), ai.goal.slice(3), g)
      }
    } else if (p.hasBomb) {
      const sitePos = ai.site === 'A' ? sites.A : sites.B
      const inSite = Math.hypot(p.x - sitePos.x, p.z - sitePos.z) < sitePos.r - 1
      if (inSite) {
        // plant!
        p.moving = false
        if (p.plantingSince === 0) p.plantingSince = t
        return
      }
      const goalNode = ai.site === 'A' ? g.plantA : g.plantB
      if (ai.goal !== goalNode) {
        ai.goal = goalNode
        ai.path = bfs(nearestNode(p.x, p.z, g), goalNode, g)
      }
    } else {
      // escort to site
      const goalNode = ai.site === 'A' ? (ai.role === 'hold' ? g.tHoldA : g.plantA) : (ai.role === 'hold' ? g.tHoldB : g.plantB)
      if (ai.goal !== goalNode) {
        ai.goal = goalNode
        const via = ai.site === 'A'
          ? g.aRoutes[Math.floor(Math.random() * g.aRoutes.length)]
          : g.bRoutes[Math.floor(Math.random() * g.bRoutes.length)]
        const from = nearestNode(p.x, p.z, g)
        ai.path = [...bfs(from, via[0], g), ...bfs(via[0], via[1], g)]
      }
    }
  } else {
    // CT
    if (bomb.planted && !bomb.defused && !bomb.exploded) {
      const dToBomb = Math.hypot(p.x - bomb.x, p.z - bomb.z)
      if (dToBomb < 2.0) {
        p.moving = false
        if (p.defusingSince === 0) p.defusingSince = t
        return
      }
      const goalNode = nearestNode(bomb.x, bomb.z, g)
      if (ai.goal !== 'bomb:' + goalNode) {
        ai.goal = 'bomb:' + goalNode
        ai.path = bfs(nearestNode(p.x, p.z, g), goalNode, g)
      }
    } else if (!ai.goal || ai.goal.startsWith('bomb:') || ai.goal.startsWith('def')) {
      const pools = ai.site === 'A' ? g.aHold : ai.site === 'B' ? g.bHold : g.midHold
      ai.goal = pools[Math.floor(Math.random() * pools.length)]
      ai.path = bfs(nearestNode(p.x, p.z, g), ai.goal, g)
    }
  }

  // follow path
  if (!ai.path.length) {
    // at goal: hold & scan
    p.moving = false
    const hold = g.nodeById.get(ai.goal.replace(/^def/, '').replace(/^bomb:/, ''))
    if (hold) {
      let watchX = 0, watchZ = p.team === 'CT' ? 40 : -40
      const w = g.watch[ai.goal.replace(/^def/, '').replace(/^bomb:/, '')]
      if (w) { watchX = w[0]; watchZ = w[1] }
      const dx = watchX - p.x, dz = watchZ - p.z
      if (Math.hypot(dx, dz) > 1) p.yaw = Math.atan2(-dx, -dz)
    }
    p.yaw += Math.sin(t / 1700 + hash(p.id)) * 0.06
    return
  }

  const next = g.nodeById.get(ai.path[0])
  if (!next) { ai.path.shift(); return }
  const dx = next.x - p.x, dz = next.z - p.z
  const d = Math.hypot(dx, dz)
  const w = WEAPONS[p.inventory[p.wIdx] ?? 'knife']
  const speed = w.moveSpeed * (p.walking ? 0.5 : 1)

  if (d < 0.8) {
    ai.path.shift()
    p.y = next.y
  } else {
    const step = Math.min(d, speed * 0.1)
    p.x += (dx / d) * step
    p.z += (dz / d) * step
    p.y += (next.y - p.y) * 0.25
    p.yaw = Math.atan2(-dx, -dz)
    p.moving = true
    // crouch-walk quiet sometimes
    p.crouch = false
  }

  // stuck detection
  if (Math.hypot(p.x - ai.lastX, p.z - ai.lastZ) < 0.15) {
    if (ai.stuckAt === 0) ai.stuckAt = t
    if (t - ai.stuckAt > 2200) {
      const n = g.nodeById.get(nearestNode(p.x, p.z, g))
      if (n) { p.x = n.x; p.z = n.z; p.y = n.y }
      ai.path = []
      ai.goal = ''
      ai.stuckAt = 0
    }
  } else {
    ai.stuckAt = 0
    ai.lastX = p.x; ai.lastZ = p.z
  }
}

function botShoot(m: Match, p: PlayerState, target: PlayerState, w: (typeof WEAPONS)[WeaponId], d: number, diff: Diff, t: number, _ai: BotBrain) {
  if (!botCtx.applyDamage) return
  // angular size of target body
  const bodyAng = Math.atan2(0.38, d)
  const headAng = Math.atan2(0.13, d)
  const hitP = Math.max(0.05, Math.min(0.9, bodyAng / Math.max(diff.aimErr, 0.001)))
  const moving = p.moving || target.moving ? 0.75 : 1
  if (Math.random() < hitP * moving) {
    const headP = diff.headChance * Math.max(0.15, Math.min(1, headAng / Math.max(diff.aimErr, 0.001)))
    let part: HitPart = 'body'
    const r = Math.random()
    if (r < headP) part = 'head'
    else if (r > 0.86) part = 'legs'
    botCtx.applyDamage(m, target, p, w.id, part, d, part === 'head')
  }
  // fake shot event time so fire validation passes (not needed for bots)
  p.lastShotAt = t
}
