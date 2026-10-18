// PHASE 4 bot-buy sim — statistical proof that the mid-economy SMG branch
// picks team-legal, money-legal SMGs across the ladder bands (plan 4.4).
// Calls the REAL botBuy() with crafted PlayerStates (round 2+, money bands).
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
    lastShotAt: 0, reloadEndsAt: 0, hasBomb: false, plantingSince: 0,
  } as unknown as PlayerState
}

function mkMatch(): Match {
  return {
    roomId: 'sim', mapId: 'dust2', serverName: null, listed: false, ownerId: null,
    createdAt: 0, players: new Map(), phase: 'freeze', phaseEndsAt: 0, round: 2,
    scores: { CT: 0, T: 0 }, lossStreak: { CT: 0, T: 0 }, bomb: {} as never,
    winTarget: 16, botFill: true, botDifficulty: 'normal', roundWinner: null,
    winReason: '', mvp: null, started: true, lastHumanAt: Date.now(), roundKills: new Map(),
  } as unknown as Match
}

const NEW_SMGS: WeaponId[] = ['mp9', 'mac10', 'mp7', 'ump45', 'p90', 'bizon']
const m = mkMatch()
const TRIALS = 400

// Band table: [money, allowed weapon set] — mirrors the plan-4.4 ladder
const BANDS: Array<{ money: number; label: string; allowed: WeaponId[] }> = [
  { money: 2500, label: 'rich ($2500, p90 tier)', allowed: ['p90'] },
  { money: 2000, label: 'mid ($2000, $1500 class + bizon)', allowed: ['mp7', 'ump45', 'mp5', 'bizon'] },
  { money: 1300, label: 'low-mid ($1300, team flavor tier)', allowed: ['mp9', 'mac10'] },
]

for (const band of BANDS) {
  for (const team of ['CT', 'T'] as const) {
    const picked: Record<string, number> = {}
    let legal = true
    let spentOk = true
    let slotOk = true
    for (let i = 0; i < TRIALS; i++) {
      const p = mkPlayer(team, band.money)
      botBuy(m, p)
      const prim = p.inventory.find(w => WEAPONS[w]?.slot === 1)
      if (prim) picked[prim] = (picked[prim] ?? 0) + 1
      // legality: picked primary is in the band's allowed set (or nothing)
      if (prim && !band.allowed.includes(prim)) legal = false
      // money: spent at most the band money, ≥ 0 left
      if (p.money < 0 || p.money > band.money) spentOk = false
      // slot: primary present → inventory sane
      if (prim && !(p.inventory.includes('knife') && p.inventory.includes(team === 'T' ? 'glock' : 'usp'))) slotOk = false
    }
    const dist = Object.entries(picked).map(([w, n]) => `${w} ${(100 * n / TRIALS).toFixed(0)}%`).join(' ') || '(none)'
    check(`[${team}] ${band.label} picks stay in the band`, legal, dist)
    check(`[${team}] ${band.label} money math sane`, spentOk)
    check(`[${team}] ${band.label} keeps pistol+knife`, slotOk)
  }
}

// Team flavor: at $1300, T NEVER picks mp9 (CT) and CT NEVER picks mac10 (T)
{
  let tSawCtGun = false, ctSawTGun = false
  for (let i = 0; i < 200; i++) {
    const t = mkPlayer('T', 1300); botBuy(m, t)
    if (t.inventory.includes('mp9')) tSawCtGun = true
    const c = mkPlayer('CT', 1300); botBuy(m, c)
    if (c.inventory.includes('mac10')) ctSawTGun = true
  }
  check('team flavor holds: T never buys mp9, CT never buys mac10', !tSawCtGun && !ctSawTGun)
}

// Coverage: with enough trials, every one of the 6 new SMGs appears somewhere
{
  const seen = new Set<WeaponId>()
  for (let i = 0; i < 2000; i++) {
    const team: TeamId = Math.random() < 0.5 ? 'T' : 'CT'
    const money = [2500, 2000, 1300, 1500][Math.floor(Math.random() * 4)]
    const p = mkPlayer(team, money)
    botBuy(m, p)
    for (const w of p.inventory) if (NEW_SMGS.includes(w)) seen.add(w)
  }
  const missing = NEW_SMGS.filter(w => !seen.has(w))
  check('all 6 new SMGs appear in bot buys across the ladder', missing.length === 0,
    `missing: ${missing.join(',') || 'none'}`)
}

// p90 tier is REACHABLE only below the rifle branches (T < $2700, CT < $3100);
// max remainder (CT 3099-2350=749) never fits helm — kevlar only, or bare
{
  const p = mkPlayer('CT', 3050); botBuy(m, p)
  check('$3050 CT bot takes p90 + plain kevlar (remainder 700 ≥ 650)',
    p.inventory.includes('p90') && p.armor === 100 && p.helmet === false,
    `inv=${p.inventory.join(',')} armor=${p.armor} helm=${p.helmet}`)
  const p2 = mkPlayer('T', 2400); botBuy(m, p2)
  check('$2400 T bot takes p90 bare (armor does not fit)', p2.inventory.includes('p90') && p2.armor === 0,
    `inv=${p2.inventory.join(',')} armor=${p2.armor}`)
  const p3 = mkPlayer('T', 2800); botBuy(m, p3)
  check('rifle precedence intact: $2800 T bot still buys ak47 over p90',
    p3.inventory.includes('ak47') && !p3.inventory.includes('p90'), `inv=${p3.inventory.join(',')}`)
  const p4 = mkPlayer('CT', 3500); botBuy(m, p4)
  check('rifle precedence intact: $3500 CT bot still buys m4 over p90',
    p4.inventory.includes('m4') && !p4.inventory.includes('p90'), `inv=${p4.inventory.join(',')}`)
}

// Eco floor intact: below $1250 still falls through to deagle/p250/kevlar
{
  let sawOldBehavior = false
  for (let i = 0; i < 100; i++) {
    const p = mkPlayer('T', 800); botBuy(m, p)
    if (p.inventory.includes('deagle') || p.armor > 0) sawOldBehavior = true
  }
  check('eco floor intact: $800 bots still deagle/kevlar (no SMG)', sawOldBehavior)
  const smgAt800 = (() => {
    for (let i = 0; i < 50; i++) {
      const p = mkPlayer('CT', 800); botBuy(m, p)
      if (p.inventory.some(w => WEAPONS[w]?.category === 'smg')) return true
    }
    return false
  })()
  check('$800 bots never buy an SMG', !smgAt800)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
