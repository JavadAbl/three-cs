// PHASE 7 bot-buy sim — statistical proof of plan 7.4: "Bots: never buy MGs
// (CS-realistic)". Sweeps the full money curve for both teams and multiple
// rounds; asserts ZERO m249/negev purchases anywhere (the rich tier keeps its
// awp/auto-sniper identity, the $1700 negev price point does NOT leak into the
// SMG/budget bands) while every prior rung still fires (no ladder regression).
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

function mkMatch(round: number): Match {
  return {
    roomId: 'sim', mapId: 'dust2', serverName: null, listed: false, ownerId: null,
    createdAt: 0, players: new Map(), phase: 'live', phaseEndsAt: 0, round,
    scores: { CT: 0, T: 0 }, lossStreak: { CT: 0, T: 0 }, bomb: {} as never,
    winTarget: 16, botFill: true, botDifficulty: 'normal', roundWinner: null,
    winReason: '', mvp: null, started: true, lastHumanAt: Date.now(), roundKills: new Map(),
  } as unknown as Match
}

// --- 1. the money curve sweep: MGs never appear, any band, any team, any round ---
{
  const MGs: WeaponId[] = ['m249', 'negev']
  const moneyCurve: number[] = []
  for (let m = 800; m <= 16000; m += 100) moneyCurve.push(m)
  const rounds = [1, 2, 3, 5, 10]
  let mgBuys = 0
  const everything: Record<string, number> = {}
  let trials = 0
  for (const round of rounds) {
    const m = mkMatch(round)
    for (const team of ['CT', 'T'] as const) {
      for (const money of moneyCurve) {
        for (let i = 0; i < 20; i++) {
          const p = mkPlayer(team, money)
          botBuy(m, p)
          trials++
          for (const id of [...p.inventory]) {
            everything[id] = (everything[id] ?? 0) + 1
            if (MGs.includes(id)) mgBuys++
          }
        }
      }
    }
  }
  check(`bots NEVER buy MGs across ${trials} trials (money 800-16000, rounds 1-10, both teams)`,
    mgBuys === 0, `${mgBuys} MG purchases`)

  // --- 2. the ladder still covers its rungs (no regression from the sweep) ---
  const must: Array<[string, number, string]> = [
    ['awp', 400, 'rich sniper tier intact'],
    ['scar20', 300, 'CT auto-sniper split intact'],
    ['g3sg1', 300, 'T auto-sniper split intact'],
    ['ak47', 4000, 'T full rifle intact'],
    ['m4', 4000, 'CT full rifle intact'],
    ['m4a1s', 2000, 'CT silenced roll intact'],
    ['galil', 300, 'T budget rifle intact'],
    ['famas', 300, 'CT budget rifle intact'],
    ['p90', 50, 'spray-lover tier intact'],
    ['mp7', 50, 'SMG band intact'],
    ['bizon', 20, 'anti-eco spray intact'],
    ['nova', 50, 'shotgun force band intact'],
    ['sawedoff', 50, 'T cut-down tier intact'],
    ['mag7', 40, 'CT box-mag tier intact'],
    ['xm1014', 60, 'auto-shotgun force-buy intact'],
    ['deagle', 300, 'eco deagle intact'],
    ['tec9', 500, 'pistol-round T flavor intact'],
    ['fiveseven', 400, 'pistol-round CT flavor intact'],
  ]
  for (const [id, min, why] of must) {
    check(`${id} still bought (${why})`, (everything[id] ?? 0) >= min, `${everything[id] ?? 0} buys`)
  }
  check('only known weapon ids ever appear in bot inventories',
    Object.keys(everything).every(id => id in WEAPONS),
    Object.keys(everything).join(','))

  // --- 3. the $1700 price point does not corrupt the negev's band neighbors ---
  // The negev costs exactly $1700 — famas territory for CT, SMG-band for T
  // (galil is $1800). Both bands must keep their identity, never an MG.
  {
    const m = mkMatch(3)
    const t17: Record<string, number> = {}
    const c17: Record<string, number> = {}
    for (let i = 0; i < 800; i++) {
      const t = mkPlayer('T', 1700); botBuy(m, t)
      const prim = t.inventory.find(w => WEAPONS[w]?.slot === 1)
      if (prim) t17[prim] = (t17[prim] ?? 0) + 1
      const c = mkPlayer('CT', 1700); botBuy(m, c)
      const primc = c.inventory.find(w => WEAPONS[w]?.slot === 1)
      if (primc) c17[primc] = (c17[primc] ?? 0) + 1
    }
    check('T $1700 = SMG band (galil is 1800), never the same-priced negev',
      !('negev' in t17) && (['mp7', 'ump45', 'mp5', 'bizon', 'sawedoff'] as const).every(k => (t17[k] ?? 0) > 50),
      Object.keys(t17).map(k => `${k} ${t17[k]}`).join(' '))
    check('CT $1700 = famas/ssg08 budget tier, never the same-priced negev',
      (c17.famas ?? 0) + (c17.ssg08 ?? 0) > 500 && !('negev' in c17), Object.keys(c17).map(k => `${k} ${c17[k]}`).join(' '))
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
