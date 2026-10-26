import { WEAPONS, ROUND } from './weapons'
import type { WeaponId, TeamId, HitPart } from './weapons'
import { pelletsOf } from '../../shared/weapons'
import { MAPS } from './mapdata'
import type { MapDef, WP } from './mapdata'
import type { PlayerState, Match, BotBrain } from './types'

export const BOT_NAMES = [
  'Wolf', 'Cobra', 'Viper', 'Rex', 'Blaze', 'Ghost', 'Falcon', 'Storm',
  'Steel', 'Stormy', 'Rock', 'Bull', 'Hawk', 'Fox', 'Rhino', 'Panther',
]

// Task 79 difficulty model. The old table had FOUR knobs and two hidden bugs:
// (1) hit probability was capped at 0.9 (0.95 shotgun) for ALL difficulties —
//     easy bots were 90%-accurate inside 10 m, which is why they "one-shotted"
//     players; (2) nothing gated the AWP purchase, so 15% of EASY bots
//     carried a one-shot-kill sniper from round 3. New knobs: hitCap (the
//     close-range accuracy ceiling — the real difficulty lever), burst
//     length/pause (machine-gun bursts → human cadence), sprayDecay (shots
//     degrade through a burst like real recoil), trackMs (aim-memory without
//     LOS — see the fire-time LOS gate below), dmgScale (easy is forgiving),
//     turnRate (aim eases toward the target — instant perfect tracking reads
//     as an aimbot), awpChance (easy: never), repositionMs (idle holders
//     shift stance/spot — no more statues).
interface Diff {
  reaction: number      // ms before the first shot on a fresh acquisition
  aimErr: number        // simulated aim cone (rad): hitP = bodyAng / aimErr
  headChance: number    // per-hit headshot roll
  hitCap: number        // MAX per-shot hit probability (close-range ceiling)
  burstMin: number      // burst length range (shots)
  burstMax: number
  pauseMin: number      // inter-burst re-aim pause (ms)
  pauseMax: number
  sprayDecay: number    // accuracy lost per consecutive burst shot (0..1)
  trackMs: number       // keep a no-LOS target this long (aiming at last-seen, NOT firing)
  dmgScale: number      // outgoing damage multiplier (easy = forgiving TTK)
  awpChance: number    // sniper purchase probability (easy: 0 — no one-shot guns)
  repositionMs: number  // idle holders shift stance/spot period
  turnRate: number      // per-tick aim easing toward the target (0..1)
}
export const DIFFS: Record<string, Diff> = {
  easy:   { reaction: 1150, aimErr: 0.16,  headChance: 0.012, hitCap: 0.30, burstMin: 2, burstMax: 3, pauseMin: 900,  pauseMax: 1600, sprayDecay: 0.14, trackMs: 500,  dmgScale: 0.70, awpChance: 0,    repositionMs: 7000,  turnRate: 0.28 },
  normal: { reaction: 700,  aimErr: 0.085, headChance: 0.05,  hitCap: 0.55, burstMin: 3, burstMax: 5, pauseMin: 550,  pauseMax: 1100, sprayDecay: 0.10, trackMs: 900,  dmgScale: 0.85, awpChance: 0.08, repositionMs: 9000,  turnRate: 0.45 },
  hard:   { reaction: 400,  aimErr: 0.038, headChance: 0.15,  hitCap: 0.85, burstMin: 4, burstMax: 6, pauseMin: 350,  pauseMax: 800,  sprayDecay: 0.08, trackMs: 1400, dmgScale: 1.0,  awpChance: 0.15, repositionMs: 11000, turnRate: 0.8 },
}

// context injected by index.ts to avoid circular imports
interface BotCtx {
  applyDamage?: (m: Match, victim: PlayerState, attacker: PlayerState | null, weapon: WeaponId, part: HitPart, dist: number, hs: boolean, scale?: number) => void
  applyShotgunDamage?: (m: Match, victim: PlayerState, attacker: PlayerState, weapon: WeaponId, pellets: Array<{ part: HitPart }>, dist: number, scale?: number) => number
  hasLOS?: (m: Match, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean
  // Phase 8: server-side grenade throw (validated + physics'd by index.ts)
  botThrowGrenade?: (m: Match, p: PlayerState, weapon: WeaponId, aimX: number, aimY: number, aimZ: number) => boolean
  // Task 80: bot gunfire/reload must be audible+visible — bots ride the SAME
  // 'shot'/'reloadFx' room broadcasts humans emit (gunshot, tracer, muzzle
  // flash, impact fx). Before this, bot-vs-bot fights were pantomime: damage
  // applied server-side, zero audiovisual feedback for any witness.
  onShot?: (m: Match, p: PlayerState, weapon: WeaponId, origin: [number, number, number], dir: [number, number, number]) => void
  onReload?: (m: Match, p: PlayerState) => void
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
    // v4 face-driven conversion (ramp side skirts sliced — regen changed wp ids): CT west terrace (site A), T east terrace (site B), mid = valley
    aHold: ['ah111', 'ah876', 'ah875', 'ah112'],
    bHold: ['ah1360', 'ah993', 'ah992', 'ah444'],
    midHold: ['ah1169', 'ah1168', 'ah323', 'ah237'],
    aRoutes: [['ah1360', 'ah111']],
    bRoutes: [['ah111', 'ah1360']],
    tHoldA: 'ah1360',
    tHoldB: 'ah111',
    plantA: 'ah111',
    plantB: 'ah1360',
    watch: {
      // CT holds face east (toward T), T holds face west
      ah111: [25, 0], ah876: [25, 0], ah875: [25, 0], ah112: [25, 0],
      ah1169: [-25, 0], ah993: [-25, 0], ah992: [-25, 0], ah444: [-25, 0],
      ah1360: [-25, 0], ah1168: [-25, 0], ah323: [25, 0], ah237: [25, 0],
    },
  }),
  aimdepot: buildGraph(MAPS.aimdepot, {
    // CT north / T south crate-yard: CTs hold their half + the lane entries,
    // Ts push via mid junction or the outside lanes. plantA/plantB are inert
    // (bomb:false) but must be valid node ids. Watch: holders face the
    // enemy half (CT -> south/+z, T -> north/-z).
    aHold: ['ctWJ', 'ctEJ', 'ctMid', 'midN'],
    bHold: ['tWJ', 'tEJ', 'tMid', 'midS'],
    midHold: ['hNW', 'hNE', 'midN', 'midS'],
    aRoutes: [['tSpawn', 'ctMid'], ['tEJ', 'midN']],
    bRoutes: [['ctSpawn', 'tMid'], ['ctEJ', 'midS']],
    tHoldA: 'tWJ',
    tHoldB: 'tEJ',
    plantA: 'ctMid',
    plantB: 'tMid',
    watch: {
      // CT-side holders face south (+z)
      ctSpawn: [0, 20], ctMid: [0, 20], ctWJ: [4, 14], ctEJ: [-4, 14],
      ctWL: [4, 12], ctER: [-4, 12], midN: [0, 20], midW: [0, 18], midE: [0, 18],
      hNW: [5, 12], hNE: [-5, 12], laneWN: [-14, 16], laneWS: [-14, 20],
      laneEN: [14, 16], laneES: [14, 20],
      // T-side holders face north (-z)
      tSpawn: [0, -20], tMid: [0, -20], tWJ: [-4, -14], tEJ: [4, -14],
      tWL: [-4, -12], tER: [4, -12], midS: [0, -20], hSW: [5, -12], hSE: [-5, -12],
    },
  }),
  office: buildGraph(MAPS.office, {
    // Task 126 — cs_office BSP import (elimination, no hostages). CT spawn =
    // the SW garage/courtyard side, T spawn = the E office wing. Holds sit at
    // the spawn ledges, mid = the front-office/long-hall centroid. watch
    // offsets face the ENEMY spawn (computed by convert-office.ts).
    aHold: ["of124", "of125", "of155", "of156"],
    bHold: ["of3989", "of4054", "of4055", "of3985"],
    midHold: ["of3279", "of3247", "of3271", "of3275"],
    aRoutes: [["of3989", "of3279"], ["of3279", "of124"]],
    bRoutes: [["of124", "of3279"], ["of3279", "of3989"]],
    tHoldA: "of3989",
    tHoldB: "of124",
    plantA: "of124",
    plantB: "of3989",
    watch: {
      of124: [64.9, -54.0], of125: [64.9, -54.0], of155: [64.9, -52.0], of156: [64.9, -52.0],
      of3989: [-64.5, 53.1], of4054: [-65.2, 52.7], of4055: [-64.3, 52.4], of3985: [-65.2, 52.4],
      of3279: [-31.2, 28.0], of3247: [33.6, -28.0], of3271: [34.5, -26.6], of3275: [-32.1, 28.9],
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
    nadeNextAt: 0, nadesThrown: 0, flashThrown: false, lastEnemyX: 0, lastEnemyZ: 0,
    // Task 79: fair-fight + aliveness fields
    seenX: 0, seenZ: 0, burstLen: 0, huntUntil: 0,
    repositionAt: 0, rotateAt: 0, hurtAt: 0, hurtFromX: 0, hurtFromZ: 0,
  }
}

export function resetBotForRound(m: Match, p: PlayerState) {
  p.ai ??= defaultBrain()
  const ai = p.ai
  ai.path = []; ai.goal = ''
  ai.engageTarget = null; ai.nextShotAt = 0; ai.burstLeft = 0
  ai.stuckAt = 0; ai.lastX = p.x; ai.lastZ = p.z
  ai.nadeNextAt = 0; ai.nadesThrown = 0; ai.flashThrown = false; ai.lastEnemyX = 0; ai.lastEnemyZ = 0
  ai.seenX = 0; ai.seenZ = 0; ai.burstLen = 0; ai.huntUntil = 0
  ai.repositionAt = 0; ai.rotateAt = 0; ai.hurtAt = 0
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
    if (w.throwable) {
      // grenades stack in slot 5 (never replace); carry limit respected
      if (p.inventory.filter(x => x === id).length >= (w.maxCarry ?? 1)) return false
      p.inventory.push(id)
      return true
    }
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
  const kit = (): boolean => {
    if (p.team !== 'CT' || p.hasKit || p.money < 400) return false
    p.money -= 400
    p.hasKit = true
    return true
  }
  // Phase 8 (plan 8.4): light grenade shopping — statistical, not tactical.
  // Full buys grab kit + a utility roll; mid-economy adds cheaper utility.
  const nade = (id: WeaponId, chance: number): boolean => {
    const w = WEAPONS[id]
    if (!w || Math.random() >= chance) return false
    if (p.money < w.price + 300) return false       // never spend the last of it
    return buy(id)
  }
  if (m.round === 1) {
    // pistol round: team-flavored sidearm table (plan 3.4) — replaces the old
    // `Math.random() < 0.5 → deagle` hack. $800 start: upgrade pistol OR
    // kevlar + stock starter, never deagle (CS pistol rounds don't deagle).
    const roll = Math.random()
    if (p.team === 'T') {
      if (roll < 0.35) buy('tec9')            // $500, aggressive T sidearm
      else if (roll < 0.55) buy('p250')       // $300
    } else {
      if (roll < 0.30) buy('fiveseven')       // $500, CT armor-puncher
      else if (roll < 0.45) buy('cz75')       // $500, full-auto gambit
      else if (roll < 0.55) buy('p250')       // $300
    }
    if (p.money >= 650) armor(false)          // else: kevlar + stock starter
    if (p.money >= 500 && Math.random() < 0.20) buy('flash')  // some pistol-round utility
    return
  }
  const awpChance = m.round > 2 ? (DIFFS[m.botDifficulty]?.awpChance ?? 0.15) : 0
  if (awpChance > 0 && Math.random() < awpChance && p.money >= 4750) {
    // rich snipers split between the AWP and the team auto-sniper (plan 5.3)
    const auto = p.money >= 6000 && Math.random() < 0.4
    buy(auto ? (p.team === 'T' ? 'g3sg1' : 'scar20') : 'awp')
    armor(true)
    kit()
    nade('flash', 0.40); nade('smoke', 0.25); nade('he', 0.25)
    nade(p.team === 'T' ? 'molotov' : 'inc', 0.25)
    return
  }
  const rifle: WeaponId = p.team === 'T' ? 'ak47' : 'm4'
  if (p.money >= WEAPONS[rifle].price + 650) {
    // full-buy flavor (plan 5.1/5.4): scoped rifles + the CT M4A1-S roll
    const roll = Math.random()
    if (p.team === 'T' && roll < 0.15 && p.money >= 3650) buy('sg553')
    else if (p.team === 'CT' && roll < 0.15 && p.money >= 3950) buy('aug')
    else if (p.team === 'CT' && roll < 0.35 && p.money >= 3550) buy('m4a1s')
    else buy(rifle)
    armor(true)
    kit()
    nade('flash', 0.40); nade('smoke', 0.25); nade('he', 0.25)
    nade(p.team === 'T' ? 'molotov' : 'inc', 0.25)
    return
  }
  if (p.money >= WEAPONS[rifle].price) {
    const roll = Math.random()
    if (p.team === 'T' && roll < 0.15 && p.money >= 3000) buy('sg553')
    else if (p.team === 'CT' && roll < 0.15 && p.money >= 3300) buy('aug')
    else if (p.team === 'CT' && roll < 0.4 && p.money >= 2900) buy('m4a1s') // cheaper full rifle
    else buy(rifle)
    return
  }
  // CT with $2900-3099: the M4A1-S is the affordable full rifle (m4 is 3100)
  if (p.team === 'CT' && p.money >= 2900) { buy('m4a1s'); if (p.money >= 650) armor(false); return }
  // budget-rifle step (plan 5.1) — between SMG and full rifle: galil T /
  // famas CT (+ ssg08 scout roll); p90 alternative for spray lovers; the
  // XM1014 force-buy (plan 6.2) takes the $2000-2349 gap below the p90 tier
  const budgetRifle: WeaponId = p.team === 'T' ? 'galil' : 'famas'
  const budgetPrice = WEAPONS[budgetRifle].price
  if (p.money >= budgetPrice) {
    const roll = Math.random()
    if (p.money >= 2000 && roll < 0.12) {
      buy('xm1014')                                  // $2000 auto-shotgun force-buy
      if (p.money >= 650) armor(false)
      return
    }
    if (p.money >= 2350 && roll < 0.25) { buy('p90'); if (p.money >= 650) armor(false); return }
    if (p.team === 'CT' && roll > 0.8 && p.money >= 1700) buy('ssg08')   // scout gambit
    else buy(budgetRifle)
    if (p.money >= 650) armor(false)
    kit()
    nade('flash', 0.30); nade('he', 0.20)
    return
  }
  // mid-economy SMG branch (plan 4.4) — $1500 class mixes mp7/ump45/mp5 +
  // bizon's 64-rd anti-eco spray; the shotgun rung (plan 6) steals 20% of the
  // band for close-quarters team flavor (mag7 CT / sawedoff T)
  if (p.money >= 1500) {
    const roll = Math.random()
    if (roll < 0.20) {
      buy(p.team === 'T' ? 'sawedoff' : 'mag7')
    } else if (roll < 0.45) buy('mp7')            // $1500, 900 RPM, PDW-accurate
    else if (roll < 0.70) buy('ump45')            // $1500, armor puncher
    else if (roll < 0.90) buy('mp5')              // $1500, suppressed allrounder
    else buy('bizon')                             // $1400, 64-round spray
    if (p.money >= 650) armor(false)
    nade('flash', 0.20)
    return
  }
  if (p.money >= 1250) {
    // $1250-1499: 30% team shotgun steals the mac10/mp9 floor (mag7 needs 1300)
    const sg: WeaponId = p.team === 'T' ? 'sawedoff' : 'mag7'
    if (!(Math.random() < 0.30 && buy(sg))) buy(p.team === 'T' ? 'mac10' : 'mp9')
    return
  }
  // shotgun force band (plan 6): $1050-1249 — nova / team cut-down, deagle
  // fallback on the miss roll; kevlar with the remainder when it fits
  if (p.money >= 1050) {
    const roll = Math.random()
    if (roll < 0.45) {
      const first: WeaponId = p.team === 'T' ? (Math.random() < 0.6 ? 'sawedoff' : 'nova')
        : (p.money >= 1300 && Math.random() < 0.6 ? 'mag7' : 'nova')
      if (!buy(first)) buy('nova')
    } else if (p.money >= 700) {
      buy('deagle')
    }
    if (p.money >= 650) armor(false)
    return
  }
  // eco / force rounds: deagle if they can, p250 if they almost can
  if (p.money >= 700) buy('deagle')
  else if (p.money >= 300 && Math.random() < 0.5) buy('p250')
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

  // ---------- Phase 8: flashblind (plan 8.2 — "no vision", real counterplay) ----------
  // A blinded bot cannot scan, engage or shoot; it keeps navigating blind.
  const blinded = t < (p.blindUntil ?? 0)

  // ---------- enemy scan ----------
  let best: PlayerState | null = null
  let bestD = Infinity
  if (!blinded) {
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
  } else {
    ai.engageTarget = null   // eyes full of white — lose the target
  }

  if (best) {
    if (ai.engageTarget !== best.id) {
      ai.engageTarget = best.id
      const reaction = diff.reaction * (0.7 + Math.random() * 0.6)
      ai.reactAt = t + reaction
      ai.nextShotAt = t + reaction
      ai.burstLen = ai.burstLeft = diff.burstMin + Math.floor(Math.random() * (diff.burstMax - diff.burstMin + 1))
      ai.lastSeenAt = t
    } else {
      ai.lastSeenAt = t
    }
    ai.seenX = best.x; ai.seenZ = best.z   // Task 79: confirmed-LOS aim memory
  } else {
    const cur = ai.engageTarget ? m.players.get(ai.engageTarget) : null
    // Task 79: the engage block's trackMs gate is the PRIMARY target-loss
    // path (it converts a lost target into a cover HUNT). This scan-side net
    // is only a safety catch for pathological gaps (6 s ≫ any trackMs) —
    // the old 2600 ms value raced the hunt conversion and silently ate the
    // target first (bot went back to holding instead of pushing the cover).
    if (!cur || !cur.alive || t - ai.lastSeenAt > 6000) ai.engageTarget = null
  }

  const target = ai.engageTarget ? m.players.get(ai.engageTarget) ?? null : null

  // ---------- Phase 8: grenade AI (light, plan 8.4 — statistical, not tactical) ----------
  // HE on spotted clustered enemies · flash before the site push (p<0.3) ·
  // smoke on the hurt-retreat. Capped 2 throws/round, 2.5 s between attempts.
  if (m.phase === 'live' && !blinded && t >= ai.nadeNextAt && ai.nadesThrown < 2 && botCtx.botThrowGrenade) {
    let throwId: WeaponId | null = null
    if (target && target.alive) {
      ai.lastEnemyX = target.x; ai.lastEnemyZ = target.z
      const d = Math.hypot(target.x - p.x, target.z - p.z)
      // HE: cluster — target plus another enemy within 3.5 m, mid range
      const cluster = [...m.players.values()].some(e => e !== target && e.alive && e.team !== p.team &&
        Math.hypot(e.x - target.x, e.z - target.z) < 3.5)
      if (cluster && d > 6 && d < 20 && p.inventory.includes('he')) throwId = 'he'
      // smoke: hurt + recently engaged → cover the retreat
      else if (p.hp < 35 && t - ai.lastSeenAt < 5000 && p.inventory.includes('smoke')) throwId = 'smoke'
    } else if (!ai.flashThrown && p.team === 'T' && ai.role === 'rush' && p.inventory.includes('flash')) {
      // flash before push: within 16 m of the site goal (plan 8.4)
      const g = graphFor(m)
      const goal = g.nodeById.get(ai.goal.replace(/^def/, '').replace(/^bomb:/, ''))
      if (goal && Math.hypot(goal.x - p.x, goal.z - p.z) < 16 && Math.random() < 0.3) throwId = 'flash'
    }
    let thrown = false
    if (throwId === 'he') thrown = botCtx.botThrowGrenade(m, p, 'he', target!.x, 1.0, target!.z)
    else if (throwId === 'smoke') thrown = botCtx.botThrowGrenade(m, p, 'smoke', (p.x + ai.lastEnemyX) / 2, 1.0, (p.z + ai.lastEnemyZ) / 2)
    else if (throwId === 'flash') {
      const g = graphFor(m)
      const goal = g.nodeById.get(ai.goal.replace(/^def/, '').replace(/^bomb:/, ''))
      thrown = botCtx.botThrowGrenade(m, p, 'flash', goal ? goal.x : p.x, 1.6, goal ? goal.z : p.z)
      if (thrown) ai.flashThrown = true
    }
    if (thrown) { ai.nadesThrown++; ai.nadeNextAt = t + 2500 }
    else ai.nadeNextAt = t + 900
  }

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

    // ---------- FIRE-TIME LOS GATE (Task 79 cover fix) ----------
    // The scan gates ACQUISITION, but the victim can duck behind cover any
    // tick after. The old code kept firing at the target's LIVE position for
    // up to 2.6 s with no LOS check at all — kills through walls. Now: no
    // LOS -> HOLD FIRE, aim at the last CONFIRMED position, and after
    // trackMs give the target up and HUNT the cover (push it on foot —
    // real counterplay, which wallbanging never gave the victim).
    const losNow = botCtx.hasLOS?.(m, p.x, eyeY(p), p.z, target.x, target.y + 1.3, target.z) ?? true
    if (!losNow) {
      p.moving = false
      if (t - ai.lastSeenAt > diff.trackMs) {
        ai.engageTarget = null
        armHunt(m, p, ai, t)
      } else {
        // face where they vanished — a beat of aim-memory, not a wallbang
        const sx = ai.seenX - p.x, sz = ai.seenZ - p.z
        if (Math.abs(sx) + Math.abs(sz) > 0.2) { p.yaw = Math.atan2(-sx, -sz); p.pitch = 0 }
      }
      return
    }

    // aim: HUMAN turn — ease toward the target instead of an instant perfect
    // lock (an aimbot snap is exactly what the old per-tick p.yaw = aimYaw
    // looked like in third person), plus a light wobble inside the aim cone
    const aimYaw = Math.atan2(-dx, -dz)
    const aimPitch = Math.atan2((target.y + 1.2) - eyeY(p), d)
    p.yaw += angleDiff(aimYaw, p.yaw) * diff.turnRate
    p.pitch += (aimPitch - p.pitch) * diff.turnRate
    p.yaw += (Math.random() - 0.5) * diff.aimErr * 0.15

    // strafe wiggle — WALL-CLAMPED (the old unclamped drift could push bots
    // into/through walls), and it counts as movement (footsteps + the moving
    // accuracy penalty apply, like any human counter-strafing)
    if (t > ai.strafeUntil) {
      ai.strafeDir = Math.random() < 0.5 ? -1 : 1
      ai.strafeUntil = t + 500 + Math.random() * 900
    }
    const w = WEAPONS[p.inventory[p.wIdx] ?? 'knife']
    const sSpeed = w.moveSpeed * 0.6
    const perpX = -dz / d, perpZ = dx / d
    // far fight with a rifle: close the gap a little instead of pure strafe
    const closing = d > 30 && !w.scope ? (dx / d) * w.moveSpeed * 0.05 : 0
    const closingZ = d > 30 && !w.scope ? (dz / d) * w.moveSpeed * 0.05 : 0
    const nx = p.x + perpX * ai.strafeDir * sSpeed * 0.1 + closing * 0.1
    const nz = p.z + perpZ * ai.strafeDir * sSpeed * 0.1 + closingZ * 0.1
    if (botCtx.hasLOS?.(m, p.x, p.y + 1.2, p.z, nx, p.y + 1.2, nz) ?? true) {
      p.x = nx; p.z = nz
      p.moving = true
    } else {
      ai.strafeDir *= -1   // wall that way — strafe the other way
      p.moving = false
    }

    // shooting
    if (t >= ai.reactAt && t >= ai.nextShotAt) {
      const am = p.ammo[w.id]
      if (w.id === 'knife') {
        if (d < 2.2) { botShoot(m, p, target, w, d, diff, t, ai); ai.nextShotAt = t + w.fireDelay }
      } else if (!am || am.mag > 0) {
        if (ai.burstLeft <= 0) {
          ai.nextShotAt = t + diff.pauseMin + Math.random() * (diff.pauseMax - diff.pauseMin)
          ai.burstLen = ai.burstLeft = diff.burstMin + Math.floor(Math.random() * (diff.burstMax - diff.burstMin + 1))
        } else {
          botShoot(m, p, target, w, d, diff, t, ai)
          if (am) am.mag--
          ai.burstLeft--
          ai.nextShotAt = t + w.fireDelay
        }
      } else if (am && am.reserve > 0) {
        // reload
        const fresh = p.reloadEndsAt <= t   // Task 80: broadcast on reload START only (per-tick re-entry must stay silent)
        p.reloadEndsAt = t + w.reloadMs
        if (fresh) botCtx.onReload?.(m, p)   // distant mag-swap clatter, same as humans
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
  navigate(m, p, ai, t, diff)

  // ---------- hurt reaction (Task 79) ----------
  // Shot from an unseen angle → snap attention toward the shooter (even while
  // walking — a flinch toward the threat reads far more alive than the old
  // bot eating bullets from behind while staring at a doorway).
  if (!target && ai.hurtAt && t - ai.hurtAt < 2200) {
    const hx = ai.hurtFromX - p.x, hz = ai.hurtFromZ - p.z
    if (Math.hypot(hx, hz) > 0.5) { p.yaw = Math.atan2(-hx, -hz); p.pitch = 0 }
  }
}

// Task 79: target lost behind cover → walk to where it vanished. This is the
// counterplay replacement for the old wallbang: the bot PUSHES your position
// on foot, so you hear it coming and can re-peek/rotate.
function armHunt(m: Match, p: PlayerState, ai: BotBrain, t: number) {
  const g = graphFor(m)
  const node = nearestNode(ai.seenX, ai.seenZ, g)
  ai.goal = 'hunt:' + node
  ai.path = bfs(nearestNode(p.x, p.z, g), node, g)
  ai.huntUntil = t + 9000
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h % 100) / 100
}

function navigate(m: Match, p: PlayerState, ai: BotBrain, t: number, diff: Diff) {
  const bomb = m.bomb
  const g = graphFor(m)
  const sites = g.def.sites

  // ---------- hunt lifecycle (Task 79) ----------
  // a hunt is a short-lived grudge-push toward where the target vanished;
  // on expiry or arrival hand control back to the objective logic (the CT
  // branch then picks a fresh hold spot — a free reposition, very natural)
  if (ai.goal.startsWith('hunt:') && (ai.path.length === 0 || t > ai.huntUntil)) ai.goal = ''

  // ---------- round pressure (Task 79: no more all-round statues) ----------
  // A round with no contact is exactly when the old bots froze forever.
  // Now: late round, bomb down, nothing seen → CTs rotate out of dead spots
  // and T holders finally join the push. elapsed = time since GO (only
  // valid pre-plant — after plant the timer is the bomb clock).
  if (m.phase === 'live' && !bomb.planted && !ai.engageTarget && !ai.goal.startsWith('hunt:')) {
    const elapsed = ROUND.liveMs - (m.phaseEndsAt - t)
    if (t > ai.rotateAt && t - ai.lastSeenAt > 12000) {
      if (p.team === 'CT' && elapsed > 50000) {
        ai.site = Math.random() < 0.5 ? 'MID' : (ai.site === 'A' ? 'B' : 'A')
        ai.goal = ''                        // next branch re-goals from the new pool
        ai.rotateAt = t + 20000             // at most one rotate per 20 s (no flip-flop)
      } else if (p.team === 'T' && ai.role === 'hold' && elapsed > 40000) {
        ai.role = 'rush'                    // holders stop waiting — push the site
        ai.goal = ''
        ai.rotateAt = t + 20000
      }
    }
  }

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
      // escort to site (a live hunt overrides the escort goal until it expires)
      const goalNode = ai.site === 'A' ? (ai.role === 'hold' ? g.tHoldA : g.plantA) : (ai.role === 'hold' ? g.tHoldB : g.plantB)
      if (ai.goal !== goalNode && !ai.goal.startsWith('hunt:')) {
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
    const holdId = ai.goal.replace(/^def/, '').replace(/^bomb:/, '')
    const hold = g.nodeById.get(holdId)

    // ---------- idle reposition (Task 79: holders stay ALIVE) ----------
    // Every repositionMs beat, shift stance or take a short walk (one hop to
    // a neighbor node / another pool spot). The old bot stood rooted at the
    // exact same coordinates all round — free kills for anyone who pre-fired.
    if (ai.goal && !ai.goal.startsWith('hunt:') && !ai.engageTarget && t > ai.repositionAt) {
      ai.repositionAt = t + diff.repositionMs * (0.7 + Math.random() * 0.6)
      const roll = Math.random()
      if (roll < 0.35) {
        p.crouch = !p.crouch                    // stance change: crouch ↔ stand
      } else if (roll < 0.80) {
        const from = nearestNode(p.x, p.z, g)
        const neighbors = g.adj.get(from) ?? []
        const pool = p.team === 'CT'
          ? (ai.site === 'A' ? g.aHold : ai.site === 'B' ? g.bHold : g.midHold)
          : null
        const dest = (neighbors.length && Math.random() < 0.6)
          ? neighbors[Math.floor(Math.random() * neighbors.length)]
          : pool?.length ? pool[Math.floor(Math.random() * pool.length)] : ''
        if (dest && dest !== from) { ai.path = bfs(from, dest, g); p.crouch = false }
      } // else: just a look-around beat — the sweep below covers it
    }

    // watch point + SCAN SWEEP (was: ±0.06 rad dead stare all round)
    if (hold) {
      let watchX = 0, watchZ = p.team === 'CT' ? 40 : -40
      const w = g.watch[holdId]
      if (w) { watchX = w[0]; watchZ = w[1] }
      const dx = watchX - p.x, dz = watchZ - p.z
      if (Math.hypot(dx, dz) > 1) {
        const base = Math.atan2(-dx, -dz)
        // slow guard sweep ±(26..43)° around the watch direction, per-bot phase
        p.yaw = base + Math.sin(t / 2800 + hash(p.id) * 6.28) * (0.45 + hash(p.id + 's') * 0.3)
      }
    }
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

// exported for scripts/test-phase6-bots.ts (statistical pellet-count sim)
export function botShoot(m: Match, p: PlayerState, target: PlayerState, w: (typeof WEAPONS)[WeaponId], d: number, diff: Diff, t: number, _ai: BotBrain) {
  // Task 80: every fired round rides the 'shot' broadcast (hit OR miss) —
  // origin = the bot's eye, dir = aim at the target's chest. The hit roll is
  // simulated server-side and independent of this vector, so witnesses just
  // get honest-looking fire toward the target.
  const ex = eyeY(p)
  let vx = target.x - p.x, vy = target.y + 1.2 - ex, vz = target.z - p.z
  const vl = Math.hypot(vx, vy, vz) || 1
  vx /= vl; vy /= vl; vz /= vl
  botCtx.onShot?.(m, p, w.id, [p.x, ex, p.z], [vx, vy, vz])
  const pellets = pelletsOf(w)
  // Task 79: shots degrade through a burst like real recoil (the old constant
  // per-shot accuracy was the machine-gun feel). Shot index = how far into
  // the burst we are (burstLen counts down via burstLeft). Stub brains from
  // the stat tests lack burstLen — default 3 (a mid-burst shot).
  const shotIdx = Math.max(0, (_ai.burstLen ?? 3) - _ai.burstLeft)
  const spray = Math.pow(1 - diff.sprayDecay, shotIdx)
  // Phase 6 shotguns: the wide cone + falloff make close-range hits nearly
  // certain and far hits sparse — model K landed pellets decaying with range,
  // then feed the SAME server aggregation the human 'pellets' path uses.
  // (Shotguns keep their own decay model — no spray factor: pump rhythm.)
  if (pellets > 1) {
    if (!botCtx.applyShotgunDamage) return
    const bodyAng = Math.atan2(0.38, d) + (w.pelletSpread ?? 0) * (Math.PI / 180) * 0.8
    const hitP = Math.max(0.05, Math.min(0.95, bodyAng / Math.max(diff.aimErr, 0.001)))
    const moving = p.moving || target.moving ? 0.75 : 1
    if (Math.random() < hitP * moving) {
      // pellets that connect: most in the victim's grill up close, 1-2 at range
      const frac = Math.max(0, 1 - d / 28)
      let k = Math.round(pellets * (0.2 + 0.8 * frac) * (0.55 + Math.random() * 0.45))
      k = Math.max(1, Math.min(pellets, k))
      const pels: Array<{ part: HitPart }> = []
      for (let i = 0; i < k; i++) {
        const r = Math.random()
        const headP = diff.headChance * Math.max(0.1, Math.min(1, Math.atan2(0.13, d) / Math.max(diff.aimErr, 0.001)))
        if (r < headP) pels.push({ part: 'head' })
        else if (r > 0.86) pels.push({ part: 'legs' })
        else pels.push({ part: 'body' })
      }
      botCtx.applyShotgunDamage(m, target, p, w.id, pels, d, diff.dmgScale)
    }
    p.lastShotAt = t
    return
  }
  if (!botCtx.applyDamage) return
  // angular size of target body — hitCap is the Task-79 difficulty ceiling:
  // the old universal 0.9 cap meant easy bots were 90% accurate in your face
  const bodyAng = Math.atan2(0.38, d)
  const headAng = Math.atan2(0.13, d)
  const hitP = Math.max(0.05, Math.min(diff.hitCap, bodyAng / Math.max(diff.aimErr, 0.001))) * moving_(p, target) * spray
  if (Math.random() < hitP) {
    const headP = diff.headChance * Math.max(0.15, Math.min(1, headAng / Math.max(diff.aimErr, 0.001)))
    let part: HitPart = 'body'
    const r = Math.random()
    if (r < headP) part = 'head'
    else if (r > 0.86) part = 'legs'
    botCtx.applyDamage(m, target, p, w.id, part, d, part === 'head', diff.dmgScale)
  }
  // fake shot event time so fire validation passes (not needed for bots)
  p.lastShotAt = t
}

function moving_(p: PlayerState, target: PlayerState): number {
  return p.moving || target.moving ? 0.75 : 1
}
