import { WEAPONS } from './weapons'
import type { WeaponId, TeamId, HitPart } from './weapons'
import { WAYPOINTS, WAYPOINT_EDGES, SITES } from './dust2'
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
  hasLOS?: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean
}
export const botCtx: BotCtx = {}
export function setBotContext(c: BotCtx) { Object.assign(botCtx, c) }

// ---------------- waypoint graph ----------------
const nodeById = new Map(WAYPOINTS.map(w => [w.id, w]))
const adj = new Map<string, string[]>()
for (const [a, b] of WAYPOINT_EDGES) {
  if (!adj.has(a)) adj.set(a, [])
  if (!adj.has(b)) adj.set(b, [])
  adj.get(a)!.push(b)
  adj.get(b)!.push(a)
}

function bfs(from: string, to: string): string[] {
  if (from === to) return [to]
  const prev = new Map<string, string>()
  const q = [from]
  const seen = new Set([from])
  while (q.length) {
    const cur = q.shift()!
    for (const nx of adj.get(cur) ?? []) {
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

function nearestNode(x: number, z: number): string {
  let best = WAYPOINTS[0].id, bd = Infinity
  for (const w of WAYPOINTS) {
    const d = Math.hypot(w.x - x, w.z - z)
    if (d < bd) { bd = d; best = w.id }
  }
  return best
}

const A_HOLD = ['aDefault', 'aRampTop', 'aPit']
const B_HOLD = ['bDoors', 'bPlat', 'bSite']
const MID_HOLD = ['doorsGap', 'ctMid']
const A_ROUTES = [['longDoors', 'aDefault'], ['catGap', 'aDefault']]
const B_ROUTES = [['tunN', 'bSite']]

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
    const pools = [A_HOLD, A_HOLD, B_HOLD, B_HOLD, MID_HOLD]
    const idx = [...m.players.values()].filter(q => q.bot && q.team === 'CT').indexOf(p)
    const spot = pools[idx % pools.length]
    ai.site = spot === A_HOLD ? 'A' : spot === B_HOLD ? 'B' : 'MID'
    ai.goal = spot[Math.floor(Math.random() * spot.length)]
    if (spot === MID_HOLD) ai.role = 'hold'
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
    if (!botCtx.hasLOS?.(p.x, eyeY(p), p.z, e.x, e.y + 1.3, e.z)) continue
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

  // objective goals
  if (p.team === 'T') {
    if (bomb.planted && !bomb.exploded) {
      // defend near bomb
      if (!ai.path.length && !ai.goal.startsWith('def')) {
        const siteNodes = ai.site === 'A' ? A_HOLD : B_HOLD
        ai.goal = 'def' + siteNodes[Math.floor(Math.random() * siteNodes.length)]
        ai.path = bfs(nearestNode(p.x, p.z), ai.goal.slice(3))
      }
    } else if (p.hasBomb) {
      const sitePos = ai.site === 'A' ? SITES.A : SITES.B
      const inSite = Math.hypot(p.x - sitePos.x, p.z - sitePos.z) < sitePos.r - 1
      if (inSite) {
        // plant!
        p.moving = false
        if (p.plantingSince === 0) p.plantingSince = t
        return
      }
      const goalNode = ai.site === 'A' ? 'aDefault' : 'bSite'
      if (ai.goal !== goalNode) {
        ai.goal = goalNode
        ai.path = bfs(nearestNode(p.x, p.z), goalNode)
      }
    } else {
      // escort to site
      const goalNode = ai.site === 'A' ? (ai.role === 'hold' ? 'aShort' : 'aDefault') : (ai.role === 'hold' ? 'bCar' : 'bSite')
      if (ai.goal !== goalNode) {
        ai.goal = goalNode
        const via = ai.site === 'A'
          ? A_ROUTES[Math.floor(Math.random() * A_ROUTES.length)]
          : B_ROUTES[Math.floor(Math.random() * B_ROUTES.length)]
        const from = nearestNode(p.x, p.z)
        ai.path = [...bfs(from, via[0]), ...bfs(via[0], via[1])]
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
      const goalNode = nearestNode(bomb.x, bomb.z)
      if (ai.goal !== 'bomb:' + goalNode) {
        ai.goal = 'bomb:' + goalNode
        ai.path = bfs(nearestNode(p.x, p.z), goalNode)
      }
    } else if (!ai.goal || ai.goal.startsWith('bomb:') || ai.goal.startsWith('def')) {
      const pools = ai.site === 'A' ? A_HOLD : ai.site === 'B' ? B_HOLD : MID_HOLD
      ai.goal = pools[Math.floor(Math.random() * pools.length)]
      ai.path = bfs(nearestNode(p.x, p.z), ai.goal)
    }
  }

  // follow path
  if (!ai.path.length) {
    // at goal: hold & scan
    p.moving = false
    const hold = nodeById.get(ai.goal.replace(/^def/, '').replace(/^bomb:/, ''))
    if (hold) {
      let watchX = 0, watchZ = p.team === 'CT' ? 40 : -40
      if (p.team === 'CT' && (ai.goal === 'aDefault' || ai.goal.startsWith('def'))) { watchX = 39; watchZ = -24 }
      if (ai.goal === 'aRampTop') { watchX = 6; watchZ = -31 }
      if (ai.goal === 'bDoors') { watchX = -32; watchZ = -30 }
      if (ai.goal === 'bPlat') { watchX = -30; watchZ = -16 }
      if (ai.goal === 'doorsGap' || ai.goal === 'ctMid') { watchX = 1; watchZ = 10 }
      const dx = watchX - p.x, dz = watchZ - p.z
      if (Math.hypot(dx, dz) > 1) p.yaw = Math.atan2(-dx, -dz)
    }
    p.yaw += Math.sin(t / 1700 + hash(p.id)) * 0.06
    return
  }

  const next = nodeById.get(ai.path[0])
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
      const n = nodeById.get(nearestNode(p.x, p.z))
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
