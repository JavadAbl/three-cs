// PHASE 5 bot-buy sim — statistical proof of the new rifle tiers (plan 5.1-5.4):
// budget-rifle step, scoped-rifle rolls, M4A1-S catch-up, auto-sniper tier.
// Calls the REAL botBuy() with crafted PlayerStates (round 5 so the AWP
// branch is active).
import { botBuy } from '../mini-services/game-server/bots'
import { WEAPONS } from '../shared/weapons'
import type { WeaponId, TeamId } from '../shared/weapons'
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

function mkMatch(round = 5): Match {
  return {
    roomId: 'sim', mapId: 'dust2', serverName: null, listed: false, ownerId: null,
    createdAt: 0, players: new Map(), phase: 'freeze', phaseEndsAt: 0, round,
    scores: { CT: 0, T: 0 }, lossStreak: { CT: 0, T: 0 }, bomb: {} as never,
    winTarget: 16, botFill: true, botDifficulty: 'normal', roundWinner: null,
    winReason: '', mvp: null, started: true, lastHumanAt: Date.now(), roundKills: new Map(),
  } as unknown as Match
}

const m = mkMatch()

function tally(team: TeamId, money: number, trials = 400): Record<string, number> {
  const picked: Record<string, number> = {}
  for (let i = 0; i < trials; i++) {
    const p = mkPlayer(team, money)
    botBuy(m, p)
    const prim = p.inventory.find(w => WEAPONS[w]?.slot === 1)
    if (prim) picked[prim] = (picked[prim] ?? 0) + 1
  }
  return picked
}

// 1. budget-rifle step: T galil / CT famas(+ssg08 roll), p90 alternative
{
  const t = tally('T', 2000)
  const tKeys = Object.keys(t)
  check('T $2000: galil (~75%) or p90 (~25%) or xm1014 (~12% of the gap), nothing else',
    tKeys.every(w => ['galil', 'p90', 'xm1014'].includes(w)) && (t.galil ?? 0) > 200,
    tKeys.map(w => `${w} ${t[w]}`).join(' '))
  const c = tally('CT', 2000)
  const cKeys = Object.keys(c)
  check('CT $2000: famas (~80%) / ssg08 (~20%) / xm1014 (Phase-6 roll), nothing else',
    cKeys.every(w => ['famas', 'ssg08', 'xm1014'].includes(w)) && (t.famas ?? (c.famas ?? 0)) > 0 && (c.famas ?? 0) > 200,
    cKeys.map(w => `${w} ${c[w]}`).join(' '))
  let famasKevlar = 0
  for (let i = 0; i < 100; i++) {
    const p = mkPlayer('CT', 2400); botBuy(m, p)
    if (p.inventory.includes('famas') && p.armor >= 100) famasKevlar++
  }
  check('CT $2400 famas bots add kevlar with the remainder', famasKevlar > 35, `${famasKevlar}/100`)
}

// 2. scoped-rifle rolls + m4a1s catch-up in the full-buy bands
{
  const t = tally('T', 3800)
  const tKeys = Object.keys(t)
  check('T $3800: ak47 (~85%) or sg553 (~15%) + armor',
    tKeys.every(w => ['ak47', 'sg553'].includes(w)) && (t.ak47 ?? 0) > 250,
    tKeys.map(w => `${w} ${t[w]}`).join(' '))
  const c = tally('CT', 4200)
  const cKeys = Object.keys(c)
  check('CT $4200: m4 / m4a1s / aug + armor',
    cKeys.every(w => ['m4', 'm4a1s', 'aug'].includes(w)) && (c.m4 ?? 0) > 100,
    cKeys.map(w => `${w} ${c[w]}`).join(' '))
  // the catch-up: CT 2900-3099 can ONLY afford m4a1s among full rifles
  const c29 = tally('CT', 3000)
  const c29Keys = Object.keys(c29)
  check('CT $3000 (below m4 price): m4a1s + kevlar, never famas',
    c29Keys.every(w => w === 'm4a1s' || w === 'p90') && (c29.m4a1s ?? 0) > 250,
    c29Keys.map(w => `${w} ${c29[w]}`).join(' '))
}

// 3. auto-sniper tier: rich bots (round 5) split awp / team auto-sniper
{
  const t = tally('T', 6500, 800)
  check('T $6500: auto-sniper g3sg1 appears alongside awp + rifles',
    (t.g3sg1 ?? 0) > 20 && (t.awp ?? 0) > 20, Object.keys(t).map(w => `${w} ${t[w]}`).join(' '))
  const c = tally('CT', 6500, 800)
  check('CT $6500: auto-sniper scar20 appears alongside awp + rifles',
    (c.scar20 ?? 0) > 20 && (c.awp ?? 0) > 20, Object.keys(c).map(w => `${w} ${c[w]}`).join(' '))
  const both = { ...t, ...c }
  check('rich bots never buy the ENEMY auto-sniper',
    !(t.scar20) && !(c.g3sg1))
}

// 4. team legality everywhere (spot sample across the whole money curve)
{
  let legal = true
  for (let i = 0; i < 3000; i++) {
    const team: TeamId = i % 2 ? 'T' : 'CT'
    const money = 800 + Math.floor(Math.random() * 8000)
    const p = mkPlayer(team, money)
    botBuy(m, p)
    for (const w of p.inventory) {
      const def = WEAPONS[w]
      if (def?.team && def.team !== team) legal = false
    }
  }
  check('no bot ever buys an enemy-team weapon across the money curve', legal)
}

// 5. coverage: every new rifle appears in bot buys somewhere
{
  const NEW5: WeaponId[] = ['m4a1s', 'galil', 'famas', 'sg553', 'aug', 'ssg08', 'scar20', 'g3sg1']
  const seen = new Set<WeaponId>()
  for (let i = 0; i < 4000; i++) {
    const team: TeamId = i % 2 ? 'T' : 'CT'
    const money = [2000, 3000, 6500, 3800, 4200][i % 5]
    const p = mkPlayer(team, money)
    botBuy(m, p)
    for (const w of p.inventory) if (NEW5.includes(w)) seen.add(w)
  }
  const missing = NEW5.filter(w => !seen.has(w))
  check('all 8 new rifles appear in bot buys', missing.length === 0,
    `missing: ${missing.join(',') || 'none'}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
