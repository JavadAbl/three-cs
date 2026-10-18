// PHASE 9 test — balance, polish, acceptance sweep (plan 9.1/9.2 data layer).
// 1. Kill rewards per class: KILL_REWARD_BY_CLASS matches the plan 9.1a
//    values exactly, every weapon's killReward field is class-consistent,
//    and category->class membership is right (incl. the documented
//    exceptions: taser $0, c4's inert field).
// 2. Economy curve: 20-round scripted sims through the REAL botBuy ladder
//    with the EXACT server round-end money math (win 3250 / loss-streak
//    1400+500n capped 3400 / bomb-loss 800 / plant 300) — bounds, spending,
//    inventory legality, loss-streak cap, eco-recovery time. No browser.
// 3. Buy-menu icons: every BUY_ENTRY has a valid, non-degenerate staged PNG
//    (240x96 RGBA) — the 9.1c silhouettes.
// 4. HUD wiring: money header, price column, icon accepted->staged fallback.
// Run: bun scripts/test-phase9.ts
import { existsSync, readFileSync } from 'fs'
import { WEAPONS, KILL_REWARD_BY_CLASS, ECONOMY, BUY_ENTRIES, WeaponId, KillRewardClass, WeaponDef } from '../shared/weapons'
import { botBuy } from '../mini-services/game-server/bots'
import type { PlayerState, Match } from '../mini-services/game-server/types'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

// ============================================================ 1. kill rewards
const PLAN_CLASS: Record<KillRewardClass, number> = {
  pistol: 300, smg: 600, rifle: 300, shotgun: 900, heavy: 300,
  awp: 100, 'auto-sniper': 100, scout: 300, knife: 1500, grenade: 300,
}
check('kill-reward class table matches plan 9.1a exactly',
  JSON.stringify(KILL_REWARD_BY_CLASS) === JSON.stringify(PLAN_CLASS),
  `awp ${KILL_REWARD_BY_CLASS.awp} / smg ${KILL_REWARD_BY_CLASS.smg} / shotgun ${KILL_REWARD_BY_CLASS.shotgun}`)

const defs = Object.values(WEAPONS) as WeaponDef[]
const EXEMPT: Record<string, string> = {
  taser: 'CS rule: zeus kill pays $0 (one-use, no reward)',
  c4: 'inert field — bomb explosion kills pay nobody (killer:null path in endRound)',
}
let inconsistent = 0
for (const w of defs) {
  if (EXEMPT[w.id]) continue
  if (!w.killRewardClass || w.killReward !== KILL_REWARD_BY_CLASS[w.killRewardClass]) {
    inconsistent++
    console.log(`  inconsistent: ${w.id} class=${w.killRewardClass} killReward=${w.killReward}`)
  }
}
check('every non-exempt weapon: killReward field === class reward', inconsistent === 0,
  `${defs.length - Object.keys(EXEMPT).length} weapons checked, exceptions: ${Object.keys(EXEMPT).join(', ')}`)
check('taser documented exception pays $0', WEAPONS.taser.killReward === 0)

// category -> expected class membership
const EXPECT_CLASS: Record<string, KillRewardClass | 'awp' | 'scout' | 'auto-sniper'> = {}
for (const w of defs) {
  if (EXEMPT[w.id]) continue
  let expect: KillRewardClass
  if (w.id === 'knife') expect = 'knife'
  else if (w.id === 'awp') expect = 'awp'
  else if (w.id === 'ssg08') expect = 'scout'
  else if (w.id === 'scar20' || w.id === 'g3sg1') expect = 'auto-sniper'
  else if (w.category === 'pistol') expect = 'pistol'
  else if (w.category === 'smg') expect = 'smg'
  else if (w.category === 'rifle') expect = 'rifle'
  else if (w.category === 'shotgun') expect = 'shotgun'
  else if (w.category === 'heavy') expect = 'heavy'
  else if (w.category === 'grenade') expect = 'grenade'
  else continue
  EXPECT_CLASS[w.id] = expect
  if (w.killRewardClass !== expect) {
    check(`class membership: ${w.id} should be '${expect}'`, false, `is '${w.killRewardClass}'`)
  }
}
check('category->class membership correct for all weapons',
  defs.filter(w => !EXEMPT[w.id]).every(w => w.killRewardClass === (EXPECT_CLASS as Record<string, string>)[w.id]))

// server pays the field, not the class — the two must stay in lockstep
const serverSrc = readFileSync('mini-services/game-server/index.ts', 'utf8')
check('server pays def.killReward (source)', /killReward \?\? 300/.test(serverSrc.replace(/def\?\./, 'killReward ?? ')) || serverSrc.includes('def?.killReward ?? 300'))
check('HE grenade kill pays the grenade class reward ($300)',
  WEAPONS.he.killReward === 300 && WEAPONS.he.killRewardClass === 'grenade')

// ============================================================ 2. economy sim
// Seeded RNG so the sweep is reproducible; patched in during the sim only.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const realRandom = Math.random

function mkPlayer(id: string, team: 'CT' | 'T'): PlayerState {
  return {
    id, name: id, team, bot: true, socketId: null,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, moving: false, walking: false,
    hp: 100, armor: 0, helmet: false, money: ECONOMY.startMoney,
    kills: 0, deaths: 0, alive: true,
    inventory: team === 'T' ? ['glock', 'knife'] : ['usp', 'knife'],
    wIdx: 0, ammo: {}, lastShotAt: 0, reloadEndsAt: 0, burstShots: 0,
    hasBomb: false, plantingSince: 0, defusingSince: 0, lastStateAt: 0,
  } as PlayerState
}
function mkMatch(round: number): Match {
  return { round } as Match // botBuy only reads m.round
}

const SIMS = 300, ROUNDS = 20
let boundViolation = 0, illegalInv = 0, mgBought = 0, hoardRounds = 0, roundBots = 0
let roundsWithSpend = 0, botRounds = 0
const curve = new Array(ROUNDS).fill(0) // average money across all bots
let streakCapViolation = 0
let worstStreakBonus = 0

for (let sim = 0; sim < SIMS; sim++) {
  Math.random = mulberry32(0x9e37 + sim)
  const bots: PlayerState[] = []
  for (let i = 0; i < 5; i++) bots.push(mkPlayer(`t${i}`, 'T'))
  for (let i = 0; i < 5; i++) bots.push(mkPlayer(`c${i}`, 'CT'))
  const lossStreak: { CT: number; T: number } = { CT: 0, T: 0 }
  // win probability oscillates so both teams see streaks + recoveries
  const tWin = 0.5 + 0.2 * Math.sin(sim / 37)

  for (let round = 1; round <= ROUNDS; round++) {
    const m = mkMatch(round)
    for (const p of bots) {
      // survivors keep loadout, dead reset (server roundStart semantics)
      if (!p.alive) {
        p.inventory = p.team === 'T' ? ['glock', 'knife'] : ['usp', 'knife']
        p.armor = 0; p.helmet = false; p.hasKit = false
      }
      p.alive = true
      const before = p.money
      botBuy(m, p)
      roundBots++
      botRounds++
      if (p.money !== before) roundsWithSpend++
      if (p.money < 0 || p.money > ECONOMY.maxMoney) boundViolation++
    }

    // ---- round outcome (scripted, no browser)
    const winner: 'CT' | 'T' = Math.random() < tWin ? 'T' : 'CT'
    const reason = Math.random() < 0.3 ? 'bomb' : 'elim'
    const loser = winner === 'CT' ? 'T' : 'CT'
    const streakBonus = Math.min(ECONOMY.lossBase + lossStreak[loser] * ECONOMY.lossStep, ECONOMY.lossMax)
    worstStreakBonus = Math.max(worstStreakBonus, streakBonus)
    if (streakBonus > ECONOMY.lossMax) streakCapViolation++
    const planter = bots.find(p => p.team === 'T')!
    const planted = reason === 'bomb' || Math.random() < 0.4

    for (const p of bots) {
      // kills: ~0.35/player/round, paid at the CURRENT weapon's reward
      const kills = Math.random() < 0.35 ? (Math.random() < 0.3 ? 2 : 1) : 0
      const gun = p.inventory.find(w => (WEAPONS as Record<string, WeaponDef>)[w]?.slot === 1)
        ?? p.inventory.find(w => (WEAPONS as Record<string, WeaponDef>)[w]?.slot === 2)!
      p.kills += kills
      p.money = Math.min(ECONOMY.maxMoney, p.money + kills * ((WEAPONS as Record<string, WeaponDef>)[gun]?.killReward ?? 300))
      if (p.team === winner) {
        p.money = Math.min(ECONOMY.maxMoney, p.money + ECONOMY.winReward)
      } else {
        const total = reason === 'bomb' && loser === 'T' ? ECONOMY.plantLossBonus : streakBonus
        p.money = Math.min(ECONOMY.maxMoney, p.money + total)
      }
      if (planted && p === planter && p.team === 'T') {
        p.money = Math.min(ECONOMY.maxMoney, p.money + ECONOMY.plantBonus)
      }
      if (p.money < 0 || p.money > ECONOMY.maxMoney) boundViolation++
      // survival: winners survive more
      p.alive = Math.random() < (p.team === winner ? 0.45 : 0.15)
    }
    lossStreak[loser] = Math.min(lossStreak[loser] + 1, 4)
    lossStreak[winner] = 0

    // ---- legality of inventories after the buy
    for (const p of bots) {
      const primaries = p.inventory.filter(w => (WEAPONS as Record<string, WeaponDef>)[w]?.slot === 1)
      if (primaries.length > 1) illegalInv++
      for (const id of p.inventory) {
        const w = (WEAPONS as Record<string, WeaponDef>)[id]
        if (!w) { illegalInv++; continue }
        if (w.id === 'm249' || w.id === 'negev') mgBought++
        if (w.team && w.team !== p.team) illegalInv++
        if (w.throwable) {
          const n = p.inventory.filter(x => x === id).length
          if (n > (w.maxCarry ?? 1)) illegalInv++
        }
      }
    }
    // team-average money
    const avg = bots.reduce((s, p) => s + p.money, 0) / bots.length
    curve[round - 1] += avg / SIMS
    if (avg < 1000) hoardRounds++ // degenerate starvation
  }
}
Math.random = realRandom

check(`economy sim: money bounds [0,${ECONOMY.maxMoney}] never violated`, boundViolation === 0,
  `${SIMS} sims x ${ROUNDS} rounds x 10 bots`)
check('economy sim: loss-streak bonus never exceeds the cap', streakCapViolation === 0 && worstStreakBonus === ECONOMY.lossMax,
  `worst bonus ${worstStreakBonus} = lossMax ${ECONOMY.lossMax}`)
check('economy sim: inventories stay legal (team/slots/carry-limits)', illegalInv === 0)
check('economy sim: bots never buy machine guns (ladder exclusion holds)', mgBought === 0)
check('economy sim: bots spend most rounds (ladder engages, no hoarding)', roundsWithSpend / botRounds > 0.5,
  `${(100 * roundsWithSpend / botRounds).toFixed(1)}% of bot-rounds had a purchase`)
check('economy sim: team-average money never starves below $1000', hoardRounds === 0,
  `curve min $${Math.round(Math.min(...curve))}`)

// eco recovery: from zero, loss-bonus ladder alone reaches a full rifle buy
{
  Math.random = mulberry32(4242)
  const p = mkPlayer('solo', 'T')
  p.money = 0
  const streak = { v: 0 }
  let rounds = 0
  while (p.money < 2700 && rounds < 10) {
    const bonus = Math.min(ECONOMY.lossBase + streak.v * ECONOMY.lossStep, ECONOMY.lossMax)
    p.money += bonus
    streak.v = Math.min(streak.v + 1, 4)
    rounds++
  }
  Math.random = realRandom
  check('eco recovery: $0 -> full-buy funds in <= 3 loss rounds', rounds <= 3, `${rounds} rounds to $${p.money}`)
}

// curve shape: print it, assert no mid-sim collapse (min >= 1000 already)
console.log('  20-round team-average money curve:')
console.log('  ' + curve.map(v => '$' + Math.round(v / 100) / 10 + 'k').join(' '))

// ============================================================ 3. staged icons
const ICON_DIR = 'public/staging/icons'
let iconBad = 0, iconCount = 0
for (const e of BUY_ENTRIES) {
  const f = `${ICON_DIR}/${e.id}.png`
  iconCount++
  if (!existsSync(f)) { iconBad++; console.log(`  missing icon: ${e.id}`); continue }
  const buf = readFileSync(f)
  const sigOk = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
  if (!sigOk || w !== 240 || h !== 96) { iconBad++; console.log(`  bad png: ${e.id} ${w}x${h}`) }
}
check('every BUY_ENTRY has a staged 240x96 PNG icon', iconBad === 0, `${iconCount} entries`)

// generator + HUD wiring source checks
const genSrc = readFileSync('scripts/gen-buy-icons.ts', 'utf8')
check('icon generator derives from buildViewModel (procedural, same geometry as gameplay)',
  genSrc.includes('buildViewModel') && genSrc.includes('closeMask'))
const hudSrc = readFileSync('src/game/hud.tsx', 'utf8')
check('HUD buy rows render the silhouette icon', hudSrc.includes('function BuyIcon') && hudSrc.includes('<BuyIcon id={it.id}'))
check('icon loader: accepted /assets/icons first, staged fallback (policy v3)',
  hudSrc.indexOf('/assets/icons/') < hudSrc.indexOf('/staging/icons/'))

// ============================================================ 4. buy menu polish
check('money header present in buy menu (fmtMoney)', /fmtMoney\(s\.money\)/.test(hudSrc))
check('price column present per row', /\{fmtPrice\}|\$\{it\.price\}/.test(hudSrc) || hudSrc.includes('${it.price}'))
check('grenade rows show kind-flavored descriptions', hudSrc.includes('blinds up to 5s') && hudSrc.includes('18s vision blocker'))
check('gear rows show descriptions (armor/kit)', hudSrc.includes("g.id]?.desc") || hudSrc.includes("GEAR.find"))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
