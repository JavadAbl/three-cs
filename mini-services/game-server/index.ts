import { createServer } from 'http'
import { Server } from 'socket.io'
import { WEAPONS, ECONOMY, ROUND, computeDamage, fireModeOf, pelletsOf, pelletSpreadOf, grenadeLimitOf } from './weapons'
import type { WeaponId, TeamId, HitPart } from './weapons'
import { pelletDirs, angleDeg } from '../../shared/pellets'
import { NADE, stepNade, toNadeBoxes, heDamage, flashBlindMs, smokeBlocksSeg, viewDirFromYawPitch } from '../../shared/grenades'
import type { NadeEnt, NadeBox, GrenadeKind } from '../../shared/grenades'
import { MAPS, MAP_LIST, rayHitsAABB } from './mapdata'
import type { MapDef, MapId, Box } from './mapdata'
import type { PlayerState, Match, Phase } from './types'
import { updateBots, botBuy, BOT_NAMES, setBotContext, resetBotForRound, defaultBrain } from './bots'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

const PORT = 3003
const matches = new Map<string, Match>()
const BOT_TEAM_SIZE = 5
const VALID_MAPS = ['dust', 'dust2', 'aimhead', 'aimdepot'] as const

const now = () => Date.now()
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

// ---------------------------------------------------------------- match utils
function mapOf(m: Match): MapDef {
  return MAPS[m.mapId] ?? MAPS.dust
}

function getMatch(roomId: string, opts?: { mapId?: MapId; serverName?: string; listed?: boolean; ownerId?: string }): Match {
  let m = matches.get(roomId)
  if (!m) {
    m = {
      roomId, players: new Map(), phase: 'warmup', phaseEndsAt: 0, round: 0,
      scores: { CT: 0, T: 0 }, lossStreak: { CT: 0, T: 0 },
      bomb: { planted: false, x: 0, y: 0, z: 0, plantedAt: 0, explodeAt: 0, defuseProgress: 0, defusingBy: null, exploded: false, defused: false },
      nades: [], smokes: [], fires: [], decoys: [], nadeSeq: 0,
      winTarget: 8, botFill: true, botDifficulty: 'normal',
      roundWinner: null, winReason: '', mvp: null, started: false,
      lastHumanAt: now(), roundKills: new Map(),
      mapId: (opts?.mapId && MAPS[opts.mapId] ? opts.mapId : 'dust'),
      serverName: opts?.serverName ?? null,
      listed: !!opts?.listed,
      ownerId: opts?.ownerId ?? null,
      createdAt: now(),
    }
    matches.set(roomId, m)
    if (m.listed) serverListDirty = true
  }
  return m
}

function humans(m: Match): PlayerState[] {
  return [...m.players.values()].filter(p => !p.bot)
}

function teamOf(m: Match, team: TeamId): PlayerState[] {
  return [...m.players.values()].filter(p => p.team === team)
}

function aliveOf(m: Match, team: TeamId): PlayerState[] {
  return teamOf(m, team).filter(p => p.alive)
}

function publicPlayer(p: PlayerState) {
  return {
    id: p.id, name: p.name, team: p.team, bot: p.bot,
    x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
    yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
    crouch: p.crouch, wIdx: p.wIdx, moving: p.moving,
    hp: p.hp, armor: p.armor, money: p.money,
    kills: p.kills, deaths: p.deaths, alive: p.alive,
    hasBomb: p.hasBomb, reloading: p.reloadEndsAt > now(),
    weapon: p.inventory[p.wIdx] ?? 'knife',
  }
}

function matchState(m: Match) {
  return {
    phase: m.phase, endsIn: Math.max(0, m.phaseEndsAt - now()),
    round: m.round, scores: m.scores, winTarget: m.winTarget,
    mapId: m.mapId, mapName: mapOf(m).name,
    bombPlanted: m.bomb.planted, bombPos: m.bomb.planted ? [m.bomb.x, m.bomb.y, m.bomb.z] : null,
    bombDefuse: m.bomb.defuseProgress,
    roundWinner: m.roundWinner, winReason: m.winReason, mvp: m.mvp,
    buyTime: m.phase === 'freeze' || (m.phase === 'live' && m.phaseEndsAt - now() > ROUND.liveMs - ROUND.buyWindowMs),
  }
}

// ---------------------------------------------------------------- server browser
let serverListDirty = true
function serverListEntries() {
  const out: Array<Record<string, unknown>> = []
  for (const m of matches.values()) {
    if (!m.listed) continue
    const ps = [...m.players.values()]
    out.push({
      id: m.roomId, name: m.serverName ?? 'Server', map: m.mapId, mapName: mapOf(m).name,
      players: ps.length, humans: ps.filter(p => !p.bot).length, max: 10,
      phase: m.phase, round: m.round, scores: m.scores,
    })
  }
  return out.sort((a, b) => (b.humans as number) - (a.humans as number))
}
const serverWatchers = new Set<string>() // socket ids
function broadcastServerList() {
  if (!serverListDirty && serverWatchers.size === 0) return
  const list = serverListEntries()
  for (const sid of serverWatchers) {
    const s = io.sockets.sockets.get(sid)
    if (s) s.emit('serverList', { servers: list })
  }
  serverListDirty = false
}
setInterval(broadcastServerList, 1500)

// ---------------------------------------------------------------- LOS
function hasLOS(m: Match, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 0.01) return true
  const nx = dx / len, ny = dy / len, nz = dz / len
  const los: readonly Box[] = mapOf(m).losBoxes
  for (const b of los) {
    if (rayHitsAABB(ax, ay, az, nx, ny, nz, b, len)) return false
  }
  // Phase 8 (plan 8.2): active smoke volumes are OPAQUE to this LOS check —
  // hit validation AND bot vision both route through here, so one gate
  // makes smoke real for bullets-in-the-dark denial and blind bots alike.
  // Pop-in window + fade tail stay see-through (matches the visual cloud).
  const t = now()
  for (const s of m.smokes) {
    if (t < s.startedAt + NADE.smokePopInMs || t > s.endsAt - NADE.smokeFadeMs) continue
    if (smokeBlocksSeg(ax, ay, az, bx, by, bz, s)) return false
  }
  return true
}

// ---------------------------------------------------------------- player mgmt
function makePlayer(id: string, name: string, team: TeamId, bot: boolean): PlayerState {
  const p: PlayerState = {
    id, name, team, bot, socketId: null,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    crouch: false, moving: false, walking: false,
    hp: 100, armor: 0, helmet: false, money: ECONOMY.startMoney,
    kills: 0, deaths: 0, alive: false,
    inventory: team === 'T' ? ['glock', 'knife'] : ['usp', 'knife'],
    wIdx: 0, ammo: {}, lastShotAt: 0, reloadEndsAt: 0, burstShots: 0,
    hasBomb: false, plantingSince: 0, defusingSince: 0, lastStateAt: now(),
    hasKit: false, blindUntil: 0, lastThrowAt: 0,
  }
  refillAmmo(p)
  return p
}

function refillAmmo(p: PlayerState) {
  for (const w of p.inventory) {
    const def = WEAPONS[w]
    if (!def || def.mag === Infinity) continue
    p.ammo[w] = { mag: def.mag, reserve: def.reserve }
  }
}

function balanceTeams(m: Match) {
  if (!m.botFill) return
  for (const team of ['CT', 'T'] as TeamId[]) {
    const players = teamOf(m, team)
    const humanCount = players.filter(p => !p.bot).length
    const bots = players.filter(p => p.bot)
    const need = Math.max(0, BOT_TEAM_SIZE - humanCount)
    // remove extra bots
    while (bots.length > need) {
      const b = bots.pop()!
      m.players.delete(b.id)
    }
    // add missing bots
    let i = 0
    while (teamOf(m, team).filter(p => p.bot).length + humanCount < BOT_TEAM_SIZE && i < 10) {
      i++
      const used = new Set([...m.players.values()].map(p => p.name))
      const name = BOT_NAMES.find(n => !used.has(n)) ?? `Bot${Math.floor(Math.random() * 999)}`
      const id = `bot-${team}-${Math.random().toString(36).slice(2, 8)}`
      const bot = makePlayer(id, name, team, true)
      m.players.set(id, bot)
    }
  }
}

// ---------------------------------------------------------------- round flow
function startRound(m: Match) {
  m.round++
  m.phase = 'freeze'
  m.phaseEndsAt = now() + ROUND.freezeMs
  m.bomb = { planted: false, x: 0, y: 0, z: 0, plantedAt: 0, explodeAt: 0, defuseProgress: 0, defusingBy: null, exploded: false, defused: false }
  m.roundWinner = null; m.winReason = ''; m.mvp = null
  m.roundKills = new Map()
  // Phase 8: grenade entities never survive a round boundary (CS rule)
  m.nades = []; m.smokes = []; m.fires = []; m.decoys = []

  balanceTeams(m)
  const ts = teamOf(m, 'T')
  let bombCarrier: PlayerState | null = null
  // aim/DM maps (bomb === false) are elimination-only: no C4, no carrier. Everything
  // downstream — plant input (useDown requires hasBomb), plant loop, fuse, defuse,
  // bot carrier navigation — keys off hasBomb, so skipping assignment kills the loop.
  if (mapOf(m).bomb !== false) {
    // prefer human carrier
    const humanT = ts.find(p => !p.bot)
    if (humanT) bombCarrier = humanT
    else if (ts.length) bombCarrier = ts[Math.floor(Math.random() * ts.length)]
  }

  for (const p of m.players.values()) {
    // CS rules: weapons and armor are lost on death — only survivors keep their loadout
    const survived = p.alive
    if (!survived) {
      p.inventory = p.team === 'T' ? ['glock', 'knife'] : ['usp', 'knife']
      p.armor = 0
      p.helmet = false
      p.hasKit = false           // equipment dies with you (CS rule)
      p.ammo = {}
    }
    p.alive = true
    p.hp = 100
    p.blindUntil = 0
    p.lastThrowAt = 0
    p.plantingSince = 0; p.defusingSince = 0
    p.reloadEndsAt = 0; p.lastShotAt = 0; p.burstShots = 0; p.shot = undefined
    p.hasBomb = false
    const spawns = mapOf(m).spawns[p.team]
    const sp = spawns[(m.round + hashId(p.id)) % spawns.length]
    p.x = sp.x; p.y = sp.y; p.z = sp.z
    p.yaw = mapOf(m).spawnYaw?.[p.team] ?? (p.team === 'T' ? 0 : Math.PI)
    p.pitch = 0
    p.wIdx = 0
    // strip c4 if no longer carrier
    p.inventory = p.inventory.filter(w => w !== 'c4')
    if (p.bot) {
      p.ai ??= defaultBrain()
      resetBotForRound(m, p)
      botBuy(m, p)
    }
    refillAmmo(p)
    // push the reset loadout to human clients (their local bag must match)
    if (!survived && !p.bot) sendInvSync(p)
  }
  if (bombCarrier) {
    bombCarrier.hasBomb = true
    if (!bombCarrier.inventory.includes('c4')) bombCarrier.inventory.push('c4')
    sendInvSync(bombCarrier)
  }
  broadcast(m, 'round', matchState(m))
}

function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function endRound(m: Match, winner: TeamId, reason: string) {
  if (m.phase !== 'live' && m.phase !== 'freeze') return
  m.phase = 'post'
  m.phaseEndsAt = now() + ROUND.postMs
  m.roundWinner = winner
  m.winReason = reason
  m.scores[winner]++

  // MVP = most kills this round on winning team
  let mvpId: string | null = null, mvpKills = 0
  for (const [pid, k] of m.roundKills) {
    const p = m.players.get(pid)
    if (p && p.team === winner && k > mvpKills) { mvpId = pid; mvpKills = k }
  }
  m.mvp = mvpId

  // economy
  const loser: TeamId = winner === 'CT' ? 'T' : 'CT'
  for (const p of m.players.values()) {
    if (p.team === winner) {
      p.money = clamp(p.money + (reason === 'bomb' && winner === 'T' ? ECONOMY.winReward : ECONOMY.winReward), 0, ECONOMY.maxMoney)
    } else {
      const streak = m.lossStreak[loser]
      const bonus = Math.min(ECONOMY.lossBase + streak * ECONOMY.lossStep, ECONOMY.lossMax)
      let total = bonus
      if (reason === 'bomb' && loser === 'T') total = ECONOMY.plantLossBonus
      p.money = clamp(p.money + total, 0, ECONOMY.maxMoney)
    }
    if (reason === 'bomb' && p.team === 'T' && m.bomb.planted) {
      // planter bonus applied at plant time
    }
  }
  m.lossStreak[loser] = Math.min(m.lossStreak[loser] + 1, 4)
  m.lossStreak[winner] = 0

  if (m.scores[winner] >= m.winTarget) {
    m.phase = 'over'
    m.phaseEndsAt = now() + 120000
    broadcast(m, 'gameover', { winner, scores: m.scores, reason })
  }
  broadcast(m, 'round', matchState(m))
}

function checkElimination(m: Match) {
  if (m.phase !== 'live') return
  const ctAlive = aliveOf(m, 'CT').length
  const tAlive = aliveOf(m, 'T').length
  if (ctAlive === 0 && tAlive === 0) endRound(m, 'CT', 'draw-elimination')
  else if (ctAlive === 0) endRound(m, 'T', 'elimination')
  else if (tAlive === 0 && !m.bomb.planted) endRound(m, 'CT', 'elimination')
}

// ---------------------------------------------------------------- damage
function eyeY(p: PlayerState) { return p.y + (p.crouch ? 1.1 : 1.62) }

/** Death bookkeeping shared by every damage path (single-ray, pellets, bots). */
function killPlayer(m: Match, victim: PlayerState, attacker: PlayerState | null, weapon: WeaponId, hs: boolean) {
  victim.alive = false
  victim.deaths++
  victim.plantingSince = 0; victim.defusingSince = 0
  if (victim.hasBomb && !m.bomb.planted) {
    // drop bomb: give to random alive T
    victim.hasBomb = false
    victim.inventory = victim.inventory.filter(w => w !== 'c4')
    const ts = aliveOf(m, 'T')
    if (ts.length) {
      const heir = ts.find(p => !p.bot) ?? ts[0]
      heir.hasBomb = true
      if (!heir.inventory.includes('c4')) heir.inventory.push('c4')
      sendInvSync(heir)
      broadcast(m, 'toast', { msg: `${heir.name} picked up the bomb` })
    }
  }
  const def = WEAPONS[weapon]
  if (attacker && attacker.id !== victim.id) {
    if (attacker.team !== victim.team) {
      attacker.kills++
      m.roundKills.set(attacker.id, (m.roundKills.get(attacker.id) ?? 0) + 1)
      attacker.money = clamp(attacker.money + (def?.killReward ?? 300), 0, ECONOMY.maxMoney)
    } else {
      attacker.kills-- // team kill penalty
    }
    broadcast(m, 'kill', {
      killer: attacker.id, victim: victim.id, weapon, headshot: hs,
      killerName: attacker.name, victimName: victim.name,
      killerTeam: attacker.team, victimTeam: victim.team,
    })
  } else {
    broadcast(m, 'kill', { killer: null, victim: victim.id, weapon: 'world' as WeaponId, headshot: false, killerName: '', victimName: victim.name, killerTeam: victim.team, victimTeam: victim.team })
  }
  checkElimination(m)
}

function applyDamage(m: Match, victim: PlayerState, attacker: PlayerState | null, weapon: WeaponId, part: HitPart, dist: number, headshot: boolean, scale = 1) {
  if (!victim.alive || m.phase !== 'live') return
  const def = WEAPONS[weapon]
  if (!def) return
  const { dmg, armorDmg } = computeDamage(def, part, dist, victim.armor, victim.helmet)
  if (armorDmg > 0) {
    victim.armor = Math.max(0, victim.armor - armorDmg)
    if (victim.armor === 0) victim.helmet = false
  }
  // Task 79: bot outgoing damage is difficulty-scaled (easy is forgiving);
  // human attackers always pass scale=1 — their damage is untouched
  const scaled = Math.max(1, Math.round(dmg * scale))
  victim.hp = Math.max(0, victim.hp - scaled)

  // Task 79: bots FEEL damage — remember where it came from so the brain can
  // turn toward an unseen shooter instead of eating bullets while staring
  if (victim.bot && victim.ai && attacker && attacker.id !== victim.id) {
    victim.ai.hurtAt = now()
    victim.ai.hurtFromX = attacker.x
    victim.ai.hurtFromZ = attacker.z
  }

  const hs = headshot || part === 'head'
  broadcast(m, 'hitConfirm', {
    victimId: victim.id, attackerId: attacker?.id ?? null,
    dmg: scaled, part, hs, hp: victim.hp, victimTeam: victim.team,
  })

  if (victim.hp <= 0) killPlayer(m, victim, attacker, weapon, hs)
}

// --------------------------------------------- Phase 6: multi-pellet ballistics
// Server-authoritative shotgun damage (plan 6.1): the client reports which
// pellets connected ({target, part} per pellet — the same trust level as the
// legacy single-ray part claims); the SERVER owns everything numeric —
// per-pellet distance (live positions, not the client's claim), per-pellet
// range falloff, per-pellet armor interaction with durability drain (armor
// broken by pellet k stops protecting pellet k+1), and the aggregation: ONE
// hitConfirm per victim with summed damage, one kill when the total lands.
function applyShotgunDamage(
  m: Match, victim: PlayerState, attacker: PlayerState, weapon: WeaponId,
  pellets: Array<{ part: HitPart }>, dist: number, scale = 1
) {
  if (!victim.alive || m.phase !== 'live') return 0
  const def = WEAPONS[weapon]
  if (!def) return 0
  let total = 0
  let anyHead = false
  for (const pel of pellets) {
    if (!victim.alive) break
    const { dmg, armorDmg } = computeDamage(def, pel.part, dist, victim.armor, victim.helmet)
    if (armorDmg > 0) {
      victim.armor = Math.max(0, victim.armor - armorDmg)
      if (victim.armor === 0) victim.helmet = false   // armor gone: later pellets hit flesh
    }
    const scaled = Math.max(1, Math.round(dmg * scale))   // Task 79: bot difficulty scaling
    victim.hp = Math.max(0, victim.hp - scaled)
    total += scaled
    if (pel.part === 'head') anyHead = true
  }
  if (total <= 0) return 0
  // Task 79: shotgun pain teaches the victim where the shooter is too
  if (victim.bot && victim.ai && attacker.id !== victim.id) {
    victim.ai.hurtAt = now()
    victim.ai.hurtFromX = attacker.x
    victim.ai.hurtFromZ = attacker.z
  }
  broadcast(m, 'hitConfirm', {
    victimId: victim.id, attackerId: attacker.id,
    dmg: total, part: 'body', hs: anyHead, hp: victim.hp, victimTeam: victim.team,
  })
  if (victim.hp <= 0) killPlayer(m, victim, attacker, weapon, anyHead)
  return total
}

/**
 * Validate + apply a shotgun pellet report (plan 6.1 anti-cheat):
 *  1. freshness — claims must reference a shell fired in the last 1.5 s
 *  2. budget   — per-shot claimed pellets ≤ w.pellets (split resends counted)
 *  3. cone     — each victim must sit inside the seeded pellet cone of the
 *                shot's stored aim dir (margin covers hitbox radius + the
 *                movement between shot and claim)
 *  4. LOS      — same eye-to-eye gate as single-ray hits
 * Damage numbers are 100% server-side (applyShotgunDamage); the tick budget
 * is O(pellets) arithmetic per shot — no per-tick ray fan.
 */
function handleShotgunHit(
  m: Match, attacker: PlayerState, w: (typeof WEAPONS)[WeaponId],
  claims: Array<{ target?: string; part?: string }>
) {
  const shot = attacker.shot
  if (!shot || now() - shot.at > 1500) return
  const pelletCount = pelletsOf(w)
  const usable = Math.min(claims.length, pelletCount - shot.claims)
  if (usable <= 0) return

  // group claims by victim, preserving order
  const byVictim = new Map<PlayerState, Array<{ part: HitPart }>>()
  let taken = 0
  for (const c of claims) {
    if (taken >= usable) break
    const victim = m.players.get(String(c.target ?? ''))
    if (!victim || !victim.alive || !attacker.alive) continue
    if (attacker.team === victim.team && attacker.id !== victim.id) continue
    const part = (c.part === 'head' || c.part === 'body' || c.part === 'legs') ? c.part as HitPart : 'body'
    if (!byVictim.has(victim)) byVictim.set(victim, [])
    byVictim.get(victim)!.push({ part })
    taken++
  }
  if (byVictim.size === 0) return

  const aim = { x: shot.dir[0], y: shot.dir[1], z: shot.dir[2] }
  // cone margin: hitbox half-width (~0.35m) subtends angle at range, plus
  // strafe drift over the claim window — 10° keeps honest players honest
  const coneDeg = pelletSpreadOf(w) + 10

  for (const [victim, pels] of byVictim) {
    const to = { x: victim.x - attacker.x, y: eyeY(victim) - eyeY(attacker), z: victim.z - attacker.z }
    const dist = Math.hypot(to.x, to.y, to.z)
    // cone gate: the victim must be inside the pellet fan (aim + spread + margin)
    if (angleDeg(aim, to) > coneDeg) continue
    // LOS gate — walls block pellets like any other hit
    if (!hasLOS(m, attacker.x, eyeY(attacker), attacker.z, victim.x, eyeY(victim), victim.z) && dist > 3) continue
    applyShotgunDamage(m, victim, attacker, w.id, pels, dist)
  }
  attacker.shot = { ...shot, claims: shot.claims + taken }
}


// ---------------------------------------------------------------- Phase 8 grenades
// Server-authoritative projectile subsystem (plan 8.1-8.2): entities spawn
// on throw (velocity from view dir + power), advance on a dedicated 20 Hz
// tick (gravity/drag/bounce/rest via shared/grenades.stepNade — the SAME
// math the client dead-reckons with), and detonate server-side: HE radial
// damage with LOS gating, flash blind per distance+facing+LOS, smoke
// volumes that hasLOS treats as opaque, molotov fire zones with DoT ticks,
// decoy gunfire loops. Clients only render + predict trajectories.
//
// Tick budget: O(active nades × boxes) per 50 ms — a handful of entities a
// round, ~100 AABB tests each; smokes/fires/decoys are a few array walks.
// The 20 Hz snapshot carries only non-empty entity arrays.

const NADE_TICK_MS = 50

// AABB conversion cache per mapId (maps are immutable)
const nadeBoxCache = new Map<string, NadeBox[]>()
function nadeBoxes(m: Match): NadeBox[] {
  let b = nadeBoxCache.get(m.mapId)
  if (!b) {
    b = toNadeBoxes(mapOf(m).losBoxes)
    nadeBoxCache.set(m.mapId, b)
  }
  return b
}

/** Remove one grenade entry from the inventory and fix the weapon index. */
function consumeGrenade(m: Match, p: PlayerState, weapon: WeaponId) {
  const i = p.inventory.indexOf(weapon)
  if (i >= 0) p.inventory.splice(i, 1)
  // keep holding another of the same kind if one remains, else slot 0
  if (p.inventory[p.wIdx] !== weapon) {
    const j = p.inventory.indexOf(weapon)
    p.wIdx = j >= 0 ? j : 0
  }
  if (p.wIdx >= p.inventory.length) p.wIdx = 0
  sendInvSync(p)
}

/** Spawn a projectile at the thrower's eye and tell every client instantly. */
function spawnGrenade(m: Match, p: PlayerState, weapon: WeaponId, dir: { x: number; y: number; z: number }, power: number) {
  const w = WEAPONS[weapon]
  const kind = (w.throwable?.kind ?? weapon) as GrenadeKind
  // power is a mode, not a scalar: 1 = full throw (22 m/s), <0.9 = underhand
  // lob (11 m/s) — the client only ever sends these two
  const v = power >= 0.9 ? NADE.throwV : NADE.lobV
  const ent: NadeEnt = {
    id: ++m.nadeSeq, kind, weapon: w.id, owner: p.id,
    x: p.x, y: eyeY(p) - 0.12, z: p.z,
    vx: dir.x * v, vy: dir.y * v, vz: dir.z * v,
    bornAt: now(), restAt: null, bounces: 0,
  }
  m.nades.push(ent)
  broadcast(m, 'nade', {
    id: ent.id, kind, weapon: w.id, owner: p.id,
    pos: [+ent.x.toFixed(3), +ent.y.toFixed(3), +ent.z.toFixed(3)],
    vel: [+ent.vx.toFixed(3), +ent.vy.toFixed(3), +ent.vz.toFixed(3)],
  })
}

/** Validated grenade throw shared by human 'throw' events and bot AI. */
function throwGrenade(m: Match, p: PlayerState, weapon: WeaponId, dir: { x: number; y: number; z: number }, power: number): boolean {
  if (m.phase !== 'live' || !p.alive) return false
  const w = WEAPONS[weapon]
  if (!w?.throwable) return false
  if (!p.inventory.includes(weapon)) return false
  if (now() - (p.lastThrowAt ?? 0) < NADE.throwCooldownMs) return false
  p.lastThrowAt = now()
  spawnGrenade(m, p, weapon, dir, power)
  consumeGrenade(m, p, weapon)
  return true
}

/** Bot-facing wrapper: aims at a world point with a distance-scaled arc. */
function botThrowGrenade(m: Match, p: PlayerState, weapon: WeaponId, aimX: number, aimY: number, aimZ: number): boolean {
  const ox = p.x, oy = eyeY(p) - 0.12, oz = p.z
  let dx = aimX - ox, dy = aimY - oy, dz = aimZ - oz
  const d = Math.hypot(dx, dy, dz) || 1
  dx /= d; dy /= d; dz /= d
  const lift = 0.2 + Math.min(0.4, d * 0.015)
  const vy = dy + lift
  const l = Math.hypot(dx, vy, dz) || 1
  return throwGrenade(m, p, weapon, { x: dx / l, y: vy / l, z: dz / l }, 1)
}

function removeNade(m: Match, n: NadeEnt) {
  const i = m.nades.indexOf(n)
  if (i >= 0) m.nades.splice(i, 1)
}

/** HE detonation (plan 8.2): radial falloff + LOS so walls block, enemies + self. */
function detonateHE(m: Match, n: NadeEnt) {
  broadcast(m, 'nadeFx', { id: n.id, kind: 'he', pos: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)] })
  const attacker = m.players.get(n.owner) ?? null
  for (const v of m.players.values()) {
    if (!v.alive) continue
    if (attacker && v.team === attacker.team && v.id !== attacker.id) continue
    const dist = Math.hypot(v.x - n.x, (v.y + 1.0) - n.y, v.z - n.z)
    if (dist >= NADE.heRadius) continue
    // LOS gate — walls block the blast (point-blank exempt)
    if (dist > 1.4 && !hasLOS(m, n.x, n.y + 0.25, n.z, v.x, eyeY(v), v.z)) continue
    const dmg = heDamage(dist, v.armor > 0, WEAPONS[n.weapon])
    if (dmg <= 0) continue
    if (v.armor > 0) {
      const armorDmg = Math.min(v.armor, Math.round(dmg * 0.5))
      v.armor = Math.max(0, v.armor - armorDmg)
      if (v.armor === 0) v.helmet = false
    }
    v.hp = Math.max(0, v.hp - dmg)
    broadcast(m, 'hitConfirm', {
      victimId: v.id, attackerId: attacker?.id ?? null,
      dmg, part: 'body', hs: false, hp: v.hp, victimTeam: v.team,
    })
    if (v.hp <= 0) killPlayer(m, v, attacker, n.weapon as WeaponId, false)
  }
}

/** Flash detonation: per-player blind from distance + facing + LOS (plan 8.2).
 *  Blinds EVERYONE incl. teammates and the thrower (CS rule); bots get the
 *  blindUntil timer (no vision — real counterplay). */
function detonateFlash(m: Match, n: NadeEnt) {
  broadcast(m, 'nadeFx', { id: n.id, kind: 'flash', pos: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)] })
  const t = now()
  for (const v of m.players.values()) {
    if (!v.alive) continue
    const dist = Math.hypot(v.x - n.x, eyeY(v) - n.y, v.z - n.z)
    if (dist >= NADE.flashRadius) continue
    if (dist > 1 && !hasLOS(m, n.x, n.y, n.z, v.x, eyeY(v), v.z)) continue
    // facing: dot(victim view, dir victim->flash)
    const vd = viewDirFromYawPitch(v.yaw, v.pitch)
    let tx = n.x - v.x, ty = n.y - eyeY(v), tz = n.z - v.z
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl; ty /= tl; tz /= tl
    const dot = vd.x * tx + vd.y * ty + vd.z * tz
    const ms = flashBlindMs(dist, dot)
    if (ms <= 120) continue
    v.blindUntil = Math.max(v.blindUntil ?? 0, t + ms)
    if (v.socketId) io.to(v.socketId).emit('flash', { ms, pos: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)] })
  }
}

/** Smoke pop (plan 8.2): 18 s volume, opaque via hasLOS; extinguishes fire. */
function popSmoke(m: Match, n: NadeEnt) {
  const t = now()
  broadcast(m, 'nadeFx', { id: n.id, kind: 'smoke', pos: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)] })
  m.smokes.push({ id: n.id, x: n.x, y: n.y, z: n.z, startedAt: t, endsAt: t + NADE.smokeMs })
  // stretch goal, plan 8.2: smoke kills fire zones it lands on
  for (const f of m.fires) {
    if (Math.hypot(f.x - n.x, f.z - n.z) < NADE.smokeExtinguishR) f.endsAt = Math.min(f.endsAt, t)
  }
  removeNade(m, n)
}

/** Molotov/incendiary ignition (plan 8.2): ground fire zone, DoT, burn-out. */
function igniteFire(m: Match, n: NadeEnt) {
  broadcast(m, 'nadeFx', { id: n.id, kind: n.kind, pos: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)] })
  m.fires.push({
    id: n.id, x: n.x, y: n.y, z: n.z,
    endsAt: now() + NADE.fireMs, lastTickAt: 0,
    owner: n.owner, weapon: n.weapon,
  })
  removeNade(m, n)
}

/** The 20 Hz entity tick: physics, fuses, effects, expiry. */
function stepGrenades(m: Match) {
  const t = now()
  const live = m.phase === 'live'

  if (live) {
    const boxes = nadeBoxes(m)
    const bounds = mapOf(m).bounds
    for (const n of [...m.nades]) {
      // resting decoys persist until their sound loop expires
      if (n.restAt !== null && n.kind === 'decoy') continue
      const events = stepNade(n, NADE_TICK_MS / 1000, boxes, bounds)
      // fuse: HE/flash detonate mid-air after their timer, whatever the physics
      if (n.kind === 'he' || n.kind === 'flash') {
        if (t - n.bornAt >= (n.kind === 'he' ? NADE.heFuseMs : NADE.flashFuseMs)) {
          removeNade(m, n)
          if (n.kind === 'he') detonateHE(m, n)
          else detonateFlash(m, n)
          continue
        }
      }
      // molotov/incendiary: first ground contact ignites (hard fuse fallback)
      if (n.kind === 'molotov' || n.kind === 'inc') {
        if (events.some(e => e.kind === 'ground') || t - n.bornAt >= NADE.mollyFuseMs) {
          removeNade(m, n)
          igniteFire(m, n)
          continue
        }
      }
      // bounce sfx — throttled, only meaningful impacts
      for (const e of events) {
        if (e.kind === 'bounce' && e.speed >= NADE.bounceSfxMinV && t - (n.lastBounceSfxAt ?? 0) > 140) {
          n.lastBounceSfxAt = t
          broadcast(m, 'gBounce', { id: n.id, pos: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)], speed: +e.speed.toFixed(1) })
        }
      }
      // rest
      if (n.restAt === null && events.some(e => e.kind === 'rest')) n.restAt = t
      // smoke pops shortly after rest; decoy activates at rest
      if (n.kind === 'smoke' && n.restAt !== null && t - n.restAt >= NADE.smokePopAfterRestMs) {
        popSmoke(m, n)
        continue
      }
      if (n.kind === 'decoy' && n.restAt !== null) {
        // mimic the thrower's primary (CS rule); starter pistol otherwise
        const owner = m.players.get(n.owner)
        const primary = owner?.inventory.find(w => WEAPONS[w]?.slot === 1)
        m.decoys.push({
          id: n.id, x: n.x, y: n.y, z: n.z, endsAt: t + NADE.decoyMs, nextShotAt: t + 600,
          owner: n.owner, weapon: primary ?? (owner?.team === 'T' ? 'glock' : 'usp'),
        })
        broadcast(m, 'nadeFx', { id: n.id, kind: 'decoy', pos: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)] })
        continue // ent stays in m.nades as the resting body (snapshot renders it)
      }
      // failsafe: a nade still flying after 12 s is stuck in geometry — despawn
      if (n.restAt === null && t - n.bornAt > NADE.lifetimeMs) removeNade(m, n)
    }
  }

  // expiry + effects run in every phase so post-round visuals fade out
  m.smokes = m.smokes.filter(s => t < s.endsAt)
  m.decoys = m.decoys.filter(d => {
    if (t >= d.endsAt) {
      const body = m.nades.find(n => n.id === d.id)
      if (body) removeNade(m, body)
      return false
    }
    return true
  })
  if (live) {
    for (const d of m.decoys) {
      if (t >= d.nextShotAt) {
        broadcast(m, 'decoyShot', { id: d.id, pos: [+d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2)], weapon: d.weapon })
        d.nextShotAt = t + NADE.decoyShotMinMs + Math.random() * (NADE.decoyShotMaxMs - NADE.decoyShotMinMs)
      }
    }
    // fire DoT (plan 8.2): tick every 500 ms, enemies + self, armor no help
    for (const f of m.fires) {
      if (t >= f.endsAt || t - f.lastTickAt < NADE.fireTickMs) continue
      f.lastTickAt = t
      const attacker = m.players.get(f.owner) ?? null
      for (const v of m.players.values()) {
        if (!v.alive) continue
        if (attacker && v.team === attacker.team && v.id !== attacker.id) continue
        if (Math.hypot(v.x - f.x, v.z - f.z) >= NADE.fireRadius) continue
        if (Math.abs(v.y - f.y) >= NADE.fireHeight) continue
        v.hp = Math.max(0, v.hp - NADE.fireTickDmg)
        broadcast(m, 'hitConfirm', {
          victimId: v.id, attackerId: attacker?.id ?? null,
          dmg: NADE.fireTickDmg, part: 'body', hs: false, hp: v.hp, victimTeam: v.team,
        })
        if (v.hp <= 0) killPlayer(m, v, attacker, f.weapon as WeaponId, false)
      }
    }
  }
  m.fires = m.fires.filter(f => t < f.endsAt)
}

setInterval(() => {
  for (const m of matches.values()) {
    if (!m.started) continue
    stepGrenades(m)
  }
}, NADE_TICK_MS)

// ---------------------------------------------------------------- bomb logic
function inSite(m: Match, p: PlayerState): 'A' | 'B' | null {
  const s = mapOf(m).sites
  if (dist2d(p, { x: s.A.x, z: s.A.z }) < s.A.r && Math.abs(p.y - s.A.y) < 2.5) return 'A'
  if (dist2d(p, { x: s.B.x, z: s.B.z }) < s.B.r && Math.abs(p.y - s.B.y) < 2.5) return 'B'
  return null
}

function updateBomb(m: Match) {
  const t = now()
  const b = m.bomb
  if (m.phase !== 'live') {
    // cancel any progress when round not live
    for (const p of m.players.values()) { p.plantingSince = 0; p.defusingSince = 0 }
    b.defuseProgress = 0
    return
  }

  if (b.planted && !b.exploded && !b.defused) {
    // defuse handling
    let defuser: PlayerState | null = null
    if (b.defusingBy) {
      const p = m.players.get(b.defusingBy)
      if (p && p.alive && p.team === 'CT' && dist2d(p, b) < 2.2 && p.defusingSince > 0) defuser = p
    }
    if (!defuser) {
      // any CT holding use near bomb?
      defuser = aliveOf(m, 'CT').find(p => p.defusingSince > 0 && dist2d(p, b) < 2.2) ?? null
    }
    if (defuser) {
      if (b.defusingBy !== defuser.id) { b.defusingBy = defuser.id; b.plantedAt = b.plantedAt } // keep timer
      const dt = (t - defuser.defusingSince) / 1000
      // Phase 8: defuse kit halves the 10 s channel (plan 8.2)
      const defuseSec = (ROUND.defuseMs / 1000) / (defuser.hasKit ? 2 : 1)
      b.defuseProgress = clamp(dt / defuseSec, 0, 1)
      broadcast(m, 'plantProgress', { id: defuser.id, action: 'defuse', progress: b.defuseProgress })
      if (b.defuseProgress >= 1) {
        b.defused = true
        defuser.money = clamp(defuser.money + 300, 0, ECONOMY.maxMoney)
        broadcast(m, 'bomb', { defused: true })
        endRound(m, 'CT', 'defuse')
        return
      }
    } else {
      if (b.defusingBy) {
        broadcast(m, 'plantProgress', { id: b.defusingBy, action: 'defuse', progress: 0 })
      }
      b.defusingBy = null
      b.defuseProgress = 0
    }
    if (t >= b.explodeAt) {
      b.exploded = true
      broadcast(m, 'bomb', { exploded: true, pos: [b.x, b.y, b.z] })
      // explosion damage
      for (const p of aliveOf(m, 'CT')) {
        const d = dist2d(p, b)
        if (d < 14) {
          const blocked = !hasLOS(m, b.x, b.y + 0.5, b.z, p.x, eyeY(p), p.z)
          const dmg = Math.round((1 - d / 14) * 500 * (blocked ? 0.4 : 1))
          p.hp = Math.max(0, p.hp - dmg)
          if (p.hp <= 0) {
            p.alive = false; p.deaths++
            broadcast(m, 'kill', { killer: null, victim: p.id, weapon: 'c4' as WeaponId, headshot: false, killerName: 'C4', victimName: p.name, killerTeam: 'T', victimTeam: p.team })
          }
        }
      }
      endRound(m, 'T', 'bomb')
    }
    return
  }

  if (!b.planted) {
    // planting progress
    for (const p of m.players.values()) {
      if (p.plantingSince <= 0) continue
      const site = inSite(m, p)
      if (!p.alive || !p.hasBomb || p.team !== 'T' || !site || p.moving || !inBoundsSpawnCheck(p)) {
        broadcast(m, 'plantProgress', { id: p.id, action: 'plant', progress: 0 })
        p.plantingSince = 0
        continue
      }
      const dt = (t - p.plantingSince) / 1000
      if (dt >= ROUND.plantMs / 1000) {
        b.planted = true
        b.x = p.x; b.y = p.y; b.z = p.z
        b.plantedAt = t
        b.explodeAt = t + ROUND.bombMs
        p.hasBomb = false
        p.inventory = p.inventory.filter(w => w !== 'c4')
        p.plantingSince = 0
        sendInvSync(p)
        p.money = clamp(p.money + ECONOMY.plantBonus, 0, ECONOMY.maxMoney)
        m.phaseEndsAt = b.explodeAt // live timer now bomb timer
        broadcast(m, 'bomb', { planted: true, pos: [b.x, b.y, b.z], explodeIn: ROUND.bombMs })
        broadcast(m, 'toast', { msg: `${p.name} planted the bomb` })
        return
      }
      broadcast(m, 'plantProgress', { id: p.id, action: 'plant', progress: clamp(dt / (ROUND.plantMs / 1000), 0, 1) })
    }
  }
}

function inBoundsSpawnCheck(p: PlayerState): boolean {
  return Math.abs(p.x) < 60 && Math.abs(p.z) < 60
}

function sendInvSync(p: PlayerState) {
  if (!p.bot && p.socketId) {
    io.to(p.socketId).emit('invSync', { inventory: p.inventory, wIdx: p.wIdx })
  }
}

// ---------------------------------------------------------------- buy
function handleBuy(m: Match, p: PlayerState, item: string) {
  if (!p.alive) return { ok: false, msg: 'You are dead' }
  const buyTime = m.phase === 'freeze' || (m.phase === 'live' && m.phaseEndsAt - now() > ROUND.liveMs - ROUND.buyWindowMs)
  if (!buyTime) return { ok: false, msg: 'Buy time is over' }

  const def = WEAPONS[item as WeaponId]
  if (item === 'kevlar' || item === 'kevlarhelm') {
    const price = item === 'kevlar' ? 650 : 1000
    if (p.money < price) return { ok: false, msg: 'Not enough money' }
    p.money -= price
    p.armor = 100
    if (item === 'kevlarhelm') p.helmet = true
    return { ok: true, money: p.money, armor: p.armor, helmet: p.helmet }
  }
  // Phase 8: defuse kit (CT gear) — halves the 10 s defuse, lost on death
  if (item === 'defusekit') {
    if (p.team !== 'CT') return { ok: false, msg: 'CT only' }
    if (p.hasKit) return { ok: false, msg: 'Already have a kit' }
    if (p.money < 400) return { ok: false, msg: 'Not enough money' }
    p.money -= 400
    p.hasKit = true
    return { ok: true, money: p.money, kit: true }
  }
  // Phase 8: grenades STACK in slot 5 up to their carry limit — never replace
  // (plan 8.3: max 1 HE / 2 flash / 1 smoke / 1 molly / 1 decoy). Same gates
  // as guns: team lock + affordability, then the money is charged.
  if (def?.throwable) {
    if (def.team && def.team !== p.team) return { ok: false, msg: 'Wrong team weapon' }
    if (p.money < def.price) return { ok: false, msg: 'Not enough money' }
    const have = p.inventory.filter(w => w === item).length
    const max = grenadeLimitOf(def)
    if (have >= max) return { ok: false, msg: `Max ${max} ${def.name}` }
    p.money -= def.price
    p.inventory.push(item as WeaponId)
    return { ok: true, money: p.money, weapon: item }
  }
  if (!def || def.price <= 0) return { ok: false, msg: 'Unknown item' }
  if (def.team && def.team !== p.team) return { ok: false, msg: 'Wrong team weapon' }
  if (p.money < def.price) return { ok: false, msg: 'Not enough money' }

  p.money -= def.price
  // replace weapon in same slot
  p.inventory = p.inventory.filter(w => WEAPONS[w]?.slot !== def.slot || w === 'knife')
  p.inventory.unshift(item as WeaponId)
  p.ammo[item as WeaponId] = { mag: def.mag, reserve: def.reserve }
  p.wIdx = 0
  return { ok: true, money: p.money, weapon: item }
}

// ---------------------------------------------------------------- broadcast
function broadcast(m: Match, event: string, data: unknown) {
  io.to(m.roomId).emit(event, data)
}

function snapshot(m: Match) {
  const ps: unknown[] = []
  for (const p of m.players.values()) {
    ps.push([
      p.id, p.x, p.y, p.z, p.yaw, p.pitch,
      p.crouch ? 1 : 0, p.wIdx, p.moving ? 1 : 0, p.walking ? 1 : 0,
      p.hp, p.armor, p.alive ? 1 : 0, p.hasBomb ? 1 : 0,
      p.inventory[p.wIdx] ?? 'knife', p.name, p.team, p.bot ? 1 : 0,
      p.kills, p.deaths, p.money,
      p.hasKit ? 1 : 0,   // 21: Phase 8 defuse kit (own-row HUD sync)
    ])
  }
  // Phase 8 entity overlays — only present when non-empty (20 Hz stream stays
  // lean on the 99% of ticks with no grenades in flight)
  const t = now()
  const gs = m.nades.map(n => [
    n.id, n.kind, +n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2),
    +n.vx.toFixed(2), +n.vy.toFixed(2), +n.vz.toFixed(2), n.restAt !== null ? 1 : 0,
  ])
  const sm = m.smokes.map(s => [s.id, +s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2), Math.max(0, s.endsAt - t)])
  const fi = m.fires.map(f => [f.id, +f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2), Math.max(0, f.endsAt - t)])
  io.to(m.roomId).emit('snapshot', {
    t, ps,
    ...(gs.length ? { gs } : {}),
    ...(sm.length ? { sm } : {}),
    ...(fi.length ? { fi } : {}),
  })
}

// ---------------------------------------------------------------- main loops
const SNAPSHOT_MS = 50
const BOT_MS = 100
const LOGIC_MS = 100

setInterval(() => {
  for (const m of matches.values()) {
    const t = now()
    // drop stale player states
    for (const p of m.players.values()) {
      if (!p.bot && t - p.lastStateAt > 10000) {
        // human silent: keep but mark; disconnect handles removal
      }
    }
    // phase machine
    if (m.phase === 'warmup') {
      if (humans(m).length > 0) {
        m.started = true
        startRound(m)
      }
    } else if (m.phase === 'freeze') {
      if (t >= m.phaseEndsAt) {
        m.phase = 'live'
        m.phaseEndsAt = t + ROUND.liveMs
        broadcast(m, 'round', matchState(m))
        broadcast(m, 'toast', { msg: 'GO! GO! GO!' })
      }
    } else if (m.phase === 'live') {
      if (!m.bomb.planted && t >= m.phaseEndsAt) {
        endRound(m, 'CT', 'time')
      }
      updateBomb(m)
    } else if (m.phase === 'post') {
      if (t >= m.phaseEndsAt) startRound(m)
    } else if (m.phase === 'over') {
      if (t >= m.phaseEndsAt || humans(m).length === 0) {
        // reset match
        m.scores = { CT: 0, T: 0 }
        m.round = 0
        m.lossStreak = { CT: 0, T: 0 }
        for (const p of m.players.values()) {
          p.money = ECONOMY.startMoney
          p.kills = 0; p.deaths = 0
        }
        if (humans(m).length > 0) startRound(m)
        else { m.phase = 'warmup'; m.started = false }
      }
    }
    if (m.phase === 'live') updateBomb(m)
  }
}, LOGIC_MS)

setInterval(() => {
  for (const m of matches.values()) if (m.started) snapshot(m)
}, SNAPSHOT_MS)

setInterval(() => {
  for (const m of matches.values()) if (m.started && m.botFill) updateBots(m, now())
}, BOT_MS)

// cleanup empty rooms
setInterval(() => {
  for (const [id, m] of matches) {
    if (humans(m).length === 0 && now() - m.lastHumanAt > 5 * 60_000) matches.delete(id)
  }
}, 60_000)

// ---------------------------------------------------------------- sockets
io.on('connection', (socket) => {
  let joinedRoom: string | null = null
  let playerId: string | null = null

  socket.on('join', (data: { name?: string; room?: string; team?: string; botFill?: boolean; botDifficulty?: string; winTarget?: number; map?: string }) => {
    const name = String(data.name || 'Player').slice(0, 16)
    const roomId = String(data.room || 'dust2').slice(0, 24).replace(/[^a-zA-Z0-9_-]/g, '') || 'dust2'
    const reqMap = (VALID_MAPS as readonly string[]).includes(String(data.map)) ? data.map as MapId : 'dust2'
    const m = getMatch(roomId, { mapId: reqMap })
    if (humans(m).length >= 10) { socket.emit('joinError', { msg: 'Room is full' }); return }

    let team: TeamId | 'auto' = (data.team === 'CT' || data.team === 'T') ? data.team : 'auto'
    if (team === 'auto') {
      const ct = teamOf(m, 'CT').length, t = teamOf(m, 'T').length
      team = ct <= t ? 'CT' : 'T'
    }
    if (data.botFill === false) m.botFill = false
    if (data.botFill === true) m.botFill = true
    if (data.botDifficulty === 'easy' || data.botDifficulty === 'normal' || data.botDifficulty === 'hard') m.botDifficulty = data.botDifficulty
    if (data.winTarget && [4, 8, 13, 16].includes(data.winTarget)) m.winTarget = data.winTarget

    const p = makePlayer(socket.id, name, team, false)
    p.socketId = socket.id
    m.players.set(p.id, p)
    m.lastHumanAt = now()
    joinedRoom = roomId
    playerId = p.id
    socket.join(roomId)
    if (m.listed) serverListDirty = true

    balanceTeams(m)

    // if joining mid-live, spawn dead and wait for next round; warmup/freeze → alive
    if (m.phase === 'warmup') {
      // will start on next logic tick
    } else if (m.phase === 'freeze') {
      const spawns = mapOf(m).spawns[team]
      const sp = spawns[hashId(p.id) % spawns.length]
      p.x = sp.x; p.y = sp.y; p.z = sp.z
      p.yaw = mapOf(m).spawnYaw?.[team] ?? (team === 'T' ? 0 : Math.PI)
      p.alive = true
    } else {
      p.alive = false
      const spawns = mapOf(m).spawns[team]
      const sp = spawns[hashId(p.id) % spawns.length]
      p.x = sp.x; p.y = sp.y; p.z = sp.z
    }

    socket.emit('init', {
      youId: p.id, name: p.name, team: p.team, money: p.money,
      inventory: p.inventory, mapId: m.mapId, mapVersion: mapOf(m).version,
      players: [...m.players.values()].map(publicPlayer),
      match: matchState(m),
    })
    socket.to(roomId).emit('playerJoined', publicPlayer(p))
  })

  // ---- server browser ----
  socket.on('listMaps', () => {
    socket.emit('maps', { maps: MAP_LIST })
  })

  socket.on('watchServers', () => {
    serverWatchers.add(socket.id)
    serverListDirty = true
    socket.emit('serverList', { servers: serverListEntries() })
  })

  socket.on('unwatchServers', () => {
    serverWatchers.delete(socket.id)
  })

  socket.on('createServer', (data: { name?: string; map?: string; botFill?: boolean; botDifficulty?: string; winTarget?: number; team?: string }, cb?: (r: unknown) => void) => {
    const srvName = String(data.name || 'Server').slice(0, 32)
    const mapId = (VALID_MAPS as readonly string[]).includes(String(data.map)) ? data.map as MapId : 'dust2'
    let roomId = ''
    do {
      roomId = 'srv-' + Math.random().toString(36).slice(2, 8)
    } while (matches.has(roomId))
    const m = getMatch(roomId, { mapId, serverName: srvName, listed: true, ownerId: socket.id })
    m.botFill = data.botFill !== false
    if (data.botDifficulty === 'easy' || data.botDifficulty === 'normal' || data.botDifficulty === 'hard') m.botDifficulty = data.botDifficulty
    if (data.winTarget && [4, 8, 13, 16].includes(data.winTarget)) m.winTarget = data.winTarget
    serverListDirty = true
    if (typeof cb === 'function') cb({ ok: true, roomId, mapId })
  })

  socket.on('state', (data: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number; crouch?: boolean; moving?: boolean; walking?: boolean; wIdx?: number }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p || typeof data.x !== 'number' || typeof data.z !== 'number') return
    // basic speed sanity (anti-teleport): max 12m per 50ms tick
    const maxMove = 12
    const dx = Math.abs(data.x - p.x), dz = Math.abs(data.z - p.z)
    const bd = mapOf(m).bounds
    if (dx < maxMove && dz < maxMove) {
      p.x = clamp(data.x, bd.minX, bd.maxX)
      p.z = clamp(data.z, bd.minZ, bd.maxZ)
    }
    p.y = clamp(data.y ?? p.y, -5, 30)
    p.yaw = typeof data.yaw === 'number' && Number.isFinite(data.yaw) ? data.yaw : p.yaw
    p.pitch = clamp(data.pitch ?? 0, -1.5, 1.5)
    p.crouch = !!data.crouch
    p.moving = !!data.moving
    p.walking = !!data.walking
    if (typeof data.wIdx === 'number' && data.wIdx >= 0 && data.wIdx < p.inventory.length) p.wIdx = data.wIdx
    p.lastStateAt = now()
  })

  socket.on('shoot', (data: { weapon?: string; origin?: number[]; dir?: number[]; seed?: number }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p || !p.alive) return
    const w = WEAPONS[(data.weapon ?? '') as WeaponId]
    if (!w) return
    const t = now()
    // fire rate + ammo validation. Burst guns (plan 5.2): in-burst shots are
    // gated by burstDelayMs and capped at burstRounds per window; the next
    // burst needs a fireDelay gap — the anti-cheat lives HERE, not client-side.
    //
    // Machine guns (plan 7.1, m249/negev): sustained ~13 rps needs NO batch
    // validation and puts ZERO pressure on the 20 Hz tick — this gate is two
    // subtractions and a compare per claim, the ray/LOS work happens on the
    // claim event itself (never per-tick), and weapons never appear in the
    // tick loop. The MGs ride this exact same gate: 80ms/75ms fireDelay with
    // the -12ms jitter tolerance (see test-phase7-e2e: 25 sustained claims
    // all accepted, 40ms spam rejected).
    if (fireModeOf(w) === 'burst') {
      const gap = t - p.lastShotAt
      if (gap >= w.fireDelay - 12) {
        p.burstShots = 1                        // burst opens
      } else {
        const cadence = (w.burstDelayMs ?? 75) - 10
        if (gap < cadence || p.burstShots >= (w.burstRounds ?? 3)) return
        p.burstShots++
      }
    } else if (t - p.lastShotAt < w.fireDelay - 12) {
      return
    }
    const am = p.ammo[w.id]
    if (am && am.mag <= 0) return
    if (p.reloadEndsAt > t) return
    p.lastShotAt = t
    if (am) am.mag--
    // Phase 6: shotguns stamp the shell in flight — the client's seed + aim
    // dir drive pellet-cone validation later, and ride the 'shot' broadcast
    // so remote clients render the identical deterministic fan
    let seed: number | undefined
    if (pelletsOf(w) > 1) {
      const d = data.dir ?? [0, 0, 1]
      const dl = Math.hypot(d[0], d[1], d[2]) || 1
      seed = (Number(data.seed) >>> 0) || 1
      p.shot = {
        seed, dir: [d[0] / dl, d[1] / dl, d[2] / dl], at: t, claims: 0,
      }
    } else {
      p.shot = undefined
    }
    socket.to(m.roomId).emit('shot', {
      id: p.id, weapon: w.id,
      origin: data.origin ?? [p.x, eyeY(p), p.z], dir: data.dir ?? [0, 0, 1],
      ...(seed !== undefined ? { seed } : {}),
    })
  })

  socket.on('hit', (data: { target?: string; part?: string; dist?: number; weapon?: string }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const attacker = m?.players.get(socket.id)
    const victim = m?.players.get(String(data.target ?? ''))
    if (!m || !attacker || !victim || !attacker.alive || !victim.alive) return
    if (attacker.team === victim.team && attacker.id !== victim.id) return
    const w = WEAPONS[(data.weapon ?? '') as WeaponId]
    if (!w) return
    // Phase 6: shotguns damage exclusively through the 'pellets' report
    // (per-shot claim budget + cone gates) — the single-ray path would let a
    // spammer bypass the pellet accounting
    if (pelletsOf(w) > 1) return
    const part = (data.part === 'head' || data.part === 'body' || data.part === 'legs') ? data.part as HitPart : 'body'
    const dist = clamp(Number(data.dist) || 5, 0, 120)
    // LOS validation (cheat deterrence)
    const losOK = hasLOS(m, attacker.x, eyeY(attacker), attacker.z, victim.x, eyeY(victim), victim.z)
    if (!losOK && dist > 3) return
    // zeus: melee-range arc — a "taser hit" from beyond reach is rejected
    if (w.id === 'taser' && dist > 8) return
    applyDamage(m, victim, attacker, w.id, part, dist, part === 'head')
  })

  // Phase 6: shotgun pellet report — per-pellet {target, part} claims, one
  // message per shell. Routed by the weapon's pellet count, so a legacy
  // single-ray 'hit' for a shotgun (no pellets array) is ignored — no double
  // counting. Validation + damage in handleShotgunHit.
  socket.on('pellets', (data: { weapon?: string; pellets?: Array<{ target?: string; part?: string }> }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const attacker = m?.players.get(socket.id)
    if (!m || !attacker || !attacker.alive) return
    const w = WEAPONS[(data.weapon ?? '') as WeaponId]
    if (!w || pelletsOf(w) <= 1) return
    if (!Array.isArray(data.pellets)) return
    handleShotgunHit(m, attacker, w, data.pellets)
  })

  // Phase 8: grenade throw — LMB full power / RMB underhand. Server owns
  // origin (anti-teleport-gated position), velocity and physics; the client
  // only aims. Anti-cheat: inventory + phase + rate gate + team weapon check
  // (all handled inside throwGrenade, same path bots use).
  socket.on('throw', (data: { weapon?: string; dir?: number[]; power?: number }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p) return
    const w = WEAPONS[(data.weapon ?? '') as WeaponId]
    if (!w?.throwable) return
    const d = data.dir ?? [0, 0, 1]
    const dl = Math.hypot(d[0], d[1], d[2]) || 1
    const power = clamp(Number(data.power) || 1, 0.25, 1)
    throwGrenade(m, p, w.id, { x: d[0] / dl, y: d[1] / dl, z: d[2] / dl }, power)
  })

  socket.on('selfdamage', (data: { dmg?: number; reason?: string }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p || !p.alive || m.phase !== 'live') return
    const dmg = Math.round(clamp(Number(data.dmg) || 0, 0, 85))
    if (dmg < 4) return
    const t = now()
    if (t - (p.lastSelfDmgAt ?? 0) < 400) return
    p.lastSelfDmgAt = t
    p.hp = Math.max(0, p.hp - dmg)
    broadcast(m, 'hitConfirm', {
      victimId: p.id, attackerId: null, dmg, part: 'body', hs: false, hp: p.hp, victimTeam: p.team,
    })
    if (p.hp <= 0) {
      p.alive = false
      p.deaths++
      p.plantingSince = 0; p.defusingSince = 0
      if (p.hasBomb && !m.bomb.planted) {
        p.hasBomb = false
        p.inventory = p.inventory.filter(w => w !== 'c4')
        const ts = aliveOf(m, 'T')
        if (ts.length) {
          const heir = ts.find(q => !q.bot) ?? ts[0]
          heir.hasBomb = true
          if (!heir.inventory.includes('c4')) heir.inventory.push('c4')
          sendInvSync(heir)
          broadcast(m, 'toast', { msg: `${heir.name} picked up the bomb` })
        }
      }
      broadcast(m, 'kill', {
        killer: null, victim: p.id, weapon: 'fall' as WeaponId, headshot: false,
        killerName: '', victimName: p.name, killerTeam: p.team, victimTeam: p.team,
      })
      checkElimination(m)
    }
  })

  socket.on('reload', (data: { weapon?: string }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p || !p.alive) return
    const w = WEAPONS[(data.weapon ?? '') as WeaponId]
    if (!w || w.mag === Infinity) return
    const am = p.ammo[w.id]
    if (!am || am.mag >= w.mag || am.reserve <= 0 || p.reloadEndsAt > now()) return
    const endsAt = now() + w.reloadMs
    p.reloadEndsAt = endsAt
    setTimeout(() => {
      const mm = matches.get(joinedRoom!)
      const pp = mm?.players.get(socket.id)
      const amm = pp?.ammo[w.id]
      if (!mm || !pp || !amm || !pp.alive) return
      // canceled by weapon switch / death / round reset (they all clear reloadEndsAt)
      if (pp.reloadEndsAt !== endsAt) return
      const need = w.mag - amm.mag
      const take = Math.min(need, amm.reserve)
      amm.mag += take; amm.reserve -= take
      // sync the refilled ammo back to the player (their local copy drives HUD + fire gate)
      socket.emit('ammo', { weapon: w.id, mag: amm.mag, reserve: amm.reserve })
    }, w.reloadMs)
    socket.to(m.roomId).emit('reloadFx', { id: p.id })
  })

  socket.on('switch', (data: { wIdx?: number }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p || typeof data.wIdx !== 'number') return
    if (data.wIdx >= 0 && data.wIdx < p.inventory.length) {
      p.wIdx = data.wIdx
      p.reloadEndsAt = 0
    }
  })

  socket.on('buy', (data: { item?: string }, cb?: (r: unknown) => void) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p) return
    const res = handleBuy(m, p, String(data.item ?? ''))
    if (res.ok) socket.emit('buyOk', { money: p.money, armor: p.armor, helmet: p.helmet, inventory: p.inventory, wIdx: p.wIdx, hasKit: !!p.hasKit })
    else socket.emit('buyError', { msg: res.msg })
    cb?.(res)
  })

  socket.on('useDown', () => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p || !p.alive || m.phase !== 'live') return
    const site = inSite(m, p)
    if (p.team === 'T' && p.hasBomb && site) p.plantingSince = now()
    else if (p.team === 'CT' && m.bomb.planted && dist2d(p, m.bomb) < 2.2) p.defusingSince = now()
  })

  socket.on('useUp', () => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p) return
    p.plantingSince = 0
    p.defusingSince = 0
    if (m.bomb.defusingBy === p.id) m.bomb.defusingBy = null
  })

  socket.on('chat', (data: { text?: string }) => {
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(socket.id)
    if (!m || !p) return
    const text = String(data.text ?? '').slice(0, 100)
    if (!text.trim()) return
    broadcast(m, 'chat', { id: p.id, name: p.name, team: p.team, text })
  })

  socket.on('disconnect', () => {
    serverWatchers.delete(socket.id)
    if (!joinedRoom) return
    const m = matches.get(joinedRoom)
    const p = m?.players.get(playerId ?? '')
    if (m && p) {
      m.players.delete(p.id)
      broadcast(m, 'playerLeft', { id: p.id })
      if (p.hasBomb && !m.bomb.planted && m.phase === 'live') {
        const ts = aliveOf(m, 'T')
        if (ts.length) {
          const heir = ts[0]
          heir.hasBomb = true
          if (!heir.inventory.includes('c4')) heir.inventory.push('c4')
          sendInvSync(heir)
        }
      }
      if (humans(m).length === 0) m.lastHumanAt = now()
      if (m.listed) serverListDirty = true
      balanceTeams(m)
      checkElimination(m)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`[CS2-clone] game server (bomb defusal, dust2) on :${PORT}`)
})

// inject damage/LOS/grenades into bot module (avoid circular imports)
setBotContext({ applyDamage, applyShotgunDamage, hasLOS, botThrowGrenade,
  // Task 80: bot gunfire rides the SAME 'shot' room broadcast humans emit —
  // gunshot + tracer + muzzle flash + impact fx for every witness. Shotguns
  // carry a deterministic seed so all clients draw the identical pellet fan.
  onShot: (m, p, weapon, origin, dir) => {
    const wd = WEAPONS[weapon]
    broadcast(m, 'shot', {
      id: p.id, weapon, origin, dir,
      ...(wd && pelletsOf(wd) > 1 ? { seed: ((Math.random() * 0xffffffff) >>> 0) || 1 } : {}),
    })
  },
  // Task 80: bot reloads broadcast 'reloadFx' exactly like a human's mag swap
  onReload: (m, p) => { broadcast(m, 'reloadFx', { id: p.id }) } })

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
