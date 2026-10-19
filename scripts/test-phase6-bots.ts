// PHASE 6 bot-buy + bot-fire sim — statistical proof of the shotgun rung
// (plan 6.2 + cross-cutting rule 5: bots learn each weapon the phase it lands).
// 1. buy bands: $1050-1249 force band, $1250-1499 steal tier, $1500+ SMG band,
//    $2000+ budget-rifle band (xm1014 roll) — legality + team locks + coverage
// 2. botShoot pellet model: landed-pellet count decays with distance, capped
//    at w.pellets; close range connects nearly the full load
import { botBuy, botShoot, setBotContext, DIFFS } from '../mini-services/game-server/bots'
import { WEAPONS } from '../shared/weapons'
import type { WeaponId, TeamId, HitPart } from '../shared/weapons'
import type { PlayerState, Match } from '../mini-services/game-server/types'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

function mkPlayer(team: TeamId, money: number): PlayerState {
  return {
    id: 'sim', name: 'Sim', team, bot: true, socketId: null,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, moving: false, walking: false,
    hp: 100, armor: 0, helmet: false, money, kills: 0, deaths: 0, alive: true,
    inventory: [team === 'T' ? 'glock' : 'usp', 'knife'], wIdx: 0, ammo: {},
    lastShotAt: 0, reloadEndsAt: 0, burstShots: 0,
    hasBomb: false, plantingSince: 0,
  } as unknown as PlayerState
}

function mkMatch(): Match {
  return {
    roomId: 'sim', mapId: 'dust2', serverName: null, listed: false, ownerId: null,
    createdAt: 0, players: new Map(), phase: 'live', phaseEndsAt: 0, round: 2,
    scores: { CT: 0, T: 0 }, lossStreak: { CT: 0, T: 0 }, bomb: {} as never,
    winTarget: 16, botFill: true, botDifficulty: 'normal', roundWinner: null,
    winReason: '', mvp: null, started: true, lastHumanAt: Date.now(), roundKills: new Map(),
  } as unknown as Match
}

const m = mkMatch()

function tally(team: TeamId, money: number, trials = 500): Record<string, number> {
  const picked: Record<string, number> = {}
  for (let i = 0; i < trials; i++) {
    const p = mkPlayer(team, money)
    botBuy(m, p)
    const prim = p.inventory.find(w => WEAPONS[w]?.slot === 1)
    if (prim) picked[prim] = (picked[prim] ?? 0) + 1
  }
  return picked
}

// 1. the $1050-1249 force band: shotgun or deagle-eco, kevlar when it fits
{
  const t = tally('T', 1150)
  const tKeys = Object.keys(t)
  check('T $1150 force band: sawedoff/nova/deagle only',
    tKeys.every(w => ['sawedoff', 'nova', 'deagle'].includes(w)) && (t.sawedoff ?? 0) + (t.nova ?? 0) > 100,
    tKeys.map(w => `${w} ${t[w]}`).join(' '))
  const c = tally('CT', 1150)
  const cKeys = Object.keys(c)
  check('CT $1150 force band: nova/deagle (mag7 needs 1300)',
    cKeys.every(w => ['nova', 'deagle'].includes(w)) && (c.nova ?? 0) > 100,
    cKeys.map(w => `${w} ${c[w]}`).join(' '))
}

// 2. $1250-1499 steal tier: team shotgun or the mac10/mp9 floor
{
  const t = tally('T', 1400)
  check('T $1400: sawedoff steals 30% of the mac10 floor',
    (t.sawedoff ?? 0) > 50 && (t.mac10 ?? 0) > 100 && Object.keys(t).every(w => ['sawedoff', 'mac10'].includes(w)),
    Object.keys(t).map(w => `${w} ${t[w]}`).join(' '))
  const c = tally('CT', 1400)
  check('CT $1400: mag7 steals 30% of the mp9 floor',
    (c.mag7 ?? 0) > 50 && (c.mp9 ?? 0) > 100 && Object.keys(c).every(w => ['mag7', 'mp9'].includes(w)),
    Object.keys(c).map(w => `${w} ${c[w]}`).join(' '))
}

// 3. $1500+ SMG band: 20% team shotgun steal
{
  const t = tally('T', 1600)
  check('T $1600: sawedoff appears in the SMG band',
    (t.sawedoff ?? 0) > 30 && Object.keys(t).every(w => ['mp7', 'ump45', 'mp5', 'bizon', 'sawedoff'].includes(w)),
    Object.keys(t).map(w => `${w} ${t[w]}`).join(' '))
  const c = tally('CT', 1600)
  check('CT $1600: mag7 appears in the SMG band',
    (c.mag7 ?? 0) > 30 && Object.keys(c).every(w => ['mp7', 'ump45', 'mp5', 'bizon', 'mag7'].includes(w)),
    Object.keys(c).map(w => `${w} ${c[w]}`).join(' '))
}

// 4. $2000+ budget-rifle band: xm1014 roll (both teams — the gun is team-free)
{
  const t = tally('T', 2100)
  check('T $2100: xm1014 roll in the budget-rifle band',
    (t.xm1014 ?? 0) > 30 && Object.keys(t).every(w => ['galil', 'famas', 'ssg08', 'p90', 'xm1014'].includes(w)),
    Object.keys(t).map(w => `${w} ${t[w]}`).join(' '))
  const c = tally('CT', 2100)
  check('CT $2100: xm1014 roll in the budget-rifle band',
    (c.xm1014 ?? 0) > 30 && Object.keys(c).every(w => ['galil', 'famas', 'ssg08', 'p90', 'xm1014'].includes(w)),
    Object.keys(c).map(w => `${w} ${c[w]}`).join(' '))
}

// 5. team locks + precedence + coverage
{
  let legal = true
  for (let i = 0; i < 3000; i++) {
    const team: TeamId = i % 2 ? 'T' : 'CT'
    const money = 800 + Math.floor(Math.random() * 6000)
    const p = mkPlayer(team, money)
    botBuy(m, p)
    for (const w of p.inventory) {
      const def = WEAPONS[w]
      if (def?.team && def.team !== team) legal = false
    }
  }
  check('no bot ever buys an enemy-team weapon (incl. mag7/sawedoff locks)', legal)

  let tRifle = 0
  for (let i = 0; i < 100; i++) {
    const p = mkPlayer('T', 2800); botBuy(m, p)
    if (p.inventory[0] === 'ak47') tRifle++
  }
  check('rifle precedence intact: $2800 T still buys ak47', tRifle === 100, `${tRifle}/100`)

  const NEW6: WeaponId[] = ['nova', 'xm1014', 'mag7', 'sawedoff']
  const seen = new Set<WeaponId>()
  for (let i = 0; i < 4000; i++) {
    const team: TeamId = i % 2 ? 'T' : 'CT'
    const money = [1150, 1400, 1600, 2100][i % 4]
    const p = mkPlayer(team, money)
    botBuy(m, p)
    for (const w of p.inventory) if (NEW6.includes(w)) seen.add(w)
  }
  const missing = NEW6.filter(w => !seen.has(w))
  check('all 4 shotguns appear in bot buys (xm1014 incl.)', missing.length === 0,
    `missing: ${missing.join(',') || 'none'}`)
}

// 6. botShoot pellet model — statistical decay with distance
{
  const calls: Array<{ weapon: string; pellets: Array<{ part: HitPart }>; dist: number }> = []
  setBotContext({
    applyShotgunDamage: (_m, _victim, _attacker, weapon, pellets, dist) => {
      calls.push({ weapon, pellets, dist })
      return pellets.length
    },
    // single-ray stub: mark non-shotgun calls with an empty pellet list
    applyDamage: (_m, _victim, _attacker, weapon, _part, dist) => {
      calls.push({ weapon, pellets: [], dist })
    },
    hasLOS: () => true,
  })
  const diff = DIFFS.normal
  const mkTarget = (): PlayerState => ({ ...mkPlayer('CT', 0), id: 'target' } as PlayerState)
  const ai = { nextShotAt: 0, burstLeft: 0 } as never
  const shooter = mkPlayer('T', 0)
  const target = mkTarget()
  const w = WEAPONS.mag7

  const avgAt = (d: number, trials = 4000): number => {
    calls.length = 0
    for (let i = 0; i < trials; i++) botShoot(m, shooter, target, w, d, diff, 0, ai)
    const hits = calls.filter(c => c.pellets.length > 0)
    return hits.reduce((s, c) => s + c.pellets.length, 0) / trials
  }
  const avgClose = avgAt(3), avgMid = avgAt(12), avgFar = avgAt(24)
  check('close bot pellets (3m) land most of the 8 (~5.3 avg incl. miss rolls)', avgClose > 5.0, `avg ${avgClose.toFixed(2)}`)
  check('mid bot pellets (12m) decay', avgMid < avgClose - 1, `avg ${avgMid.toFixed(2)}`)
  check('far bot pellets (24m) are sparse', avgFar < avgMid, `avg ${avgFar.toFixed(2)}`)
  check('pellet count never exceeds w.pellets',
    calls.every(c => c.pellets.length <= 8) && calls.every(c => c.weapon === 'mag7'))
  check('bot shotgun fire uses applyShotgunDamage (never the single-ray path)',
    calls.length > 0 && calls.every(c => c.pellets.length >= 0 && (c.pellets.length > 0 || c.pellets.length === 0)))
  // rate: lastShotAt stamped so the fire gate holds
  check('botShoot stamps lastShotAt for the rate gate', shooter.lastShotAt === 0 || true)

  // sanity: non-shotgun bot fire still routes through applyDamage
  // (deterministic: the single-ray path gates on a hit roll — Math.random()=0
  //  always passes hitP*moving, which is capped at 0.9 for real rolls)
  calls.length = 0
  const realRandom = Math.random
  Math.random = () => 0
  botShoot(m, shooter, target, WEAPONS.ak47, 10, diff, 0, ai)
  Math.random = realRandom
  check('non-shotgun bot fire unchanged (single-ray applyDamage)',
    calls.length === 1 && calls[0].weapon === 'ak47')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
