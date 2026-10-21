// TASK 79 bot-AI regression suite — the three reported symptoms, each pinned
// by a test that FAILS on the old code:
//   1. "AI one-shots us, even in easy mode"  → lethality stats vs difficulty
//      (hitCap ceiling, reaction floor, headshot rarity, easy never buys AWPs)
//   2. "sometimes kill when we're behind cover" → fire-time LOS gate: once the
//      victim breaks LOS the bot must land ZERO damage and must HUNT the cover
//      on foot instead of wallbanging (old code kept firing ~2.6 s through walls)
//   3. "counter side always standing, no movements" → holders reposition /
//      crouch / scan-sweep; hurt bots turn toward unseen shooters
// Drives updateBots directly with a stubbed ctx — no server needed.
import { updateBots, defaultBrain, botBuy, setBotContext, DIFFS } from '../mini-services/game-server/bots'
import { WEAPONS } from '../shared/weapons'
import type { TeamId } from '../shared/weapons'
import type { PlayerState, Match } from '../mini-services/game-server/types'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

function mkPlayer(team: TeamId, x = 0, z = 0): PlayerState {
  return {
    id: 'sim-' + Math.random().toString(36).slice(2, 8), name: 'Sim', team, bot: true, socketId: null,
    x, y: 0, z, yaw: 0, pitch: 0, crouch: false, moving: false, walking: false,
    hp: 100, armor: 100, helmet: true, money: 16000, kills: 0, deaths: 0, alive: true,
    inventory: [team === 'T' ? 'ak47' : 'm4', 'knife'], wIdx: 0,
    ammo: { ak47: { mag: 30, reserve: 90 }, m4: { mag: 30, reserve: 90 } },
    lastShotAt: 0, reloadEndsAt: 0, burstShots: 0,
    hasBomb: false, plantingSince: 0, hasKit: false, blindUntil: 0, lastThrowAt: 0,
    ai: defaultBrain(),
  } as unknown as PlayerState
}

function mkMatch(difficulty: string): Match {
  return {
    roomId: 'sim', mapId: 'dust2', serverName: null, listed: false, ownerId: null,
    createdAt: 0, players: new Map(), phase: 'live', phaseEndsAt: Date.now() + 100000, round: 5,
    scores: { CT: 0, T: 0 }, lossStreak: { CT: 0, T: 0 },
    bomb: { planted: false, x: 0, y: 0, z: 0, plantedAt: 0, explodeAt: 0, defuseProgress: 0, defusingBy: null, exploded: false, defused: false },
    nades: [], smokes: [], fires: [], decoys: [], nadeSeq: 0,
    winTarget: 16, botFill: true, botDifficulty: difficulty, roundWinner: null,
    winReason: '', mvp: null, started: true, lastHumanAt: Date.now(), roundKills: new Map(),
  } as unknown as Match
}

// ---------------------------------------------------------------- stub ctx
// LOS is a controllable flag; damage calls are recorded.
let losFlag = true
const dmgCalls: Array<{ at: number; dmg: number; head: boolean }> = []
setBotContext({
  applyDamage: (_m, _victim, _attacker, _weapon, _part, _dist, hs, scale = 1) => {
    dmgCalls.push({ at: 0, dmg: 25 * scale, head: hs })  // 25 ≈ AK body vs armor
  },
  applyShotgunDamage: (_m, _victim, _attacker, _weapon, pellets, _dist, scale = 1) => {
    dmgCalls.push({ at: 0, dmg: pellets.length * 20 * scale, head: pellets.some(p => p.part === 'head') })
    return pellets.length
  },
  hasLOS: () => losFlag,
})

// arm the bot's mag so it never reloads during a sim
function armInfinite(p: PlayerState) {
  const w = p.inventory[0] as never as string
  const def = (WEAPONS as Record<string, { mag: number; reserve: number }>)[w]
  p.ammo[w] = { mag: def.mag, reserve: 9999 }
}

// ================================================================ 1. COVER
// Bot acquires a visible target, fires; the target ducks behind cover; the
// bot must land ZERO damage while LOS is broken and must start a HUNT.
{
  const m = mkMatch('normal')
  const bot = mkPlayer('CT', 0, -20)
  const foe = mkPlayer('T', 0, -5)        // 15 m: close enough for real hit rolls
  foe.bot = false                        // human stand-in: updateBots must not drive it
  bot.yaw = Math.atan2(-(foe.x - bot.x), -(foe.z - bot.z))   // pre-aimed: inside scan FOV
  m.players.set(bot.id, bot)
  m.players.set(foe.id, foe)
  armInfinite(bot)

  let t = Date.now()
  losFlag = true
  dmgCalls.length = 0
  let acquired = false
  for (let i = 0; i < 80 && !acquired; i++) {  // up to 8 s to acquire + react
    updateBots(m, t + i * 100)
    bot.ammo[bot.inventory[0] as string]!.mag = 30   // test: timers never fire — keep it fed
    if (bot.ai!.engageTarget === foe.id && dmgCalls.length > 0) acquired = true
  }
  check('cover: bot acquires and fires on a visible target', acquired, `${dmgCalls.length} hits first phase`)

  const hitsBeforeCover = dmgCalls.length
  losFlag = false                                    // ← target behind cover
  let hunted = false
  for (let i = 0; i < 40; i++) {                     // 4 s behind cover
    updateBots(m, t + 6000 + i * 100)
    bot.ammo[bot.inventory[0] as string]!.mag = 30
    if (bot.ai!.goal.startsWith('hunt:')) hunted = true
  }
  const coverHits = dmgCalls.length - hitsBeforeCover
  check('cover: ZERO damage lands while the target is behind cover', coverHits === 0,
    `${coverHits} illegal wallbang hits (old code: ~2.6 s of through-wall fire)`)
  check('cover: bot gives the target up and HUNTS the cover position', hunted,
    `goal=${bot.ai!.goal} path=${bot.ai!.path.length}`)
}

// ================================================================ 2. LETHALITY
// 30 easy engagements of 6 s at 12 m vs a standing target: easy must not
// reliably kill; first hit must respect the reaction floor; headshots rare.
{
  let kills = 0
  let firstHitMsMin = Infinity
  let headHits = 0
  let totalHits = 0
  const ENG = 30
  for (let e = 0; e < ENG; e++) {
    const m = mkMatch('easy')
    const bot = mkPlayer('CT', 0, -32)
    const foe = mkPlayer('T', 0, -20)   // 12 m apart
    m.players.set(bot.id, bot)
    m.players.set(foe.id, foe)
    armInfinite(bot)
    losFlag = true
    dmgCalls.length = 0
    let hp = 100
    const t0 = Date.now()
    for (let i = 0; i < 60; i++) {
      updateBots(m, t0 + i * 100)
      for (const c of dmgCalls) {
        totalHits++
        hp -= c.dmg
        if (c.head) headHits++
        if (firstHitMsMin === Infinity) firstHitMsMin = i * 100
      }
      dmgCalls.length = 0
      if (hp <= 0) { kills++; break }
    }
  }
  check('lethality: easy kills a standing 12 m target in ≤4/30 six-second duels',
    kills <= 4, `${kills}/${ENG} kills`)
  check('lethality: easy first hit never lands before the reaction floor (~800 ms)',
    firstHitMsMin >= 800, `earliest ${firstHitMsMin} ms`)
  check('lethality: easy headshot rate ≤ 8% of hits', totalHits === 0 || headHits / totalHits <= 0.08,
    `${headHits}/${totalHits}`)
}

// damage scale: easy outgoing damage is reduced, hard is full
{
  const e = DIFFS.easy, h = DIFFS.hard, n = DIFFS.normal
  check('lethality: dmgScale easy < normal < hard', e.dmgScale < n.dmgScale && n.dmgScale < h.dmgScale,
    `${e.dmgScale}/${n.dmgScale}/${h.dmgScale}`)
  check('lethality: hitCap easy 0.30 ≪ old universal 0.9, hard ≤ 0.85',
    e.hitCap <= 0.32 && n.hitCap <= 0.6 && h.hitCap <= 0.85, `${e.hitCap}/${n.hitCap}/${h.hitCap}`)
  check('lethality: easy reaction ≥ 1 s (old: 600 ms)', e.reaction >= 1000, `${e.reaction} ms`)
}

// AWP gate: easy bots NEVER buy one-shot snipers; hard sometimes do
{
  const SNIPERS = ['awp', 'g3sg1', 'scar20']
  let easySnipers = 0, hardSnipers = 0
  for (let i = 0; i < 400; i++) {
    const me = mkMatch('easy')
    const pe = mkPlayer('T'); pe.money = 16000
    botBuy(me, pe)
    if (pe.inventory.some(w => SNIPERS.includes(w))) easySnipers++
    const mh = mkMatch('hard')
    const ph = mkPlayer('T'); ph.money = 16000
    botBuy(mh, ph)
    if (ph.inventory.some(w => SNIPERS.includes(w))) hardSnipers++
  }
  check('lethality: ZERO easy bots buy AWP/auto-snipers at $16k', easySnipers === 0, `${easySnipers}/400`)
  check('lethality: some hard bots still buy snipers (difficulty is a curve, not a wall)',
    hardSnipers > 10, `${hardSnipers}/400`)
}

// ================================================================ 3. MOVEMENT
// A CT holder with NO enemies on the map must not be a statue: it walks
// between spots, crouches, and sweeps its aim.
{
  const m = mkMatch('normal')
  const bot = mkPlayer('CT', 4, 24)
  bot.ai!.site = 'A'
  m.players.set(bot.id, bot)
  losFlag = true
  const xs: number[] = [], zs: number[] = [], yaws: number[] = []
  let movingTicks = 0, crouches = 0
  const t0 = Date.now()
  for (let i = 0; i < 600; i++) {          // 60 s of idle holding
    updateBots(m, t0 + i * 100)
    xs.push(bot.x); zs.push(bot.z); yaws.push(bot.yaw)
    if (bot.moving) movingTicks++
    if (bot.crouch) crouches++
  }
  const spread = Math.max(...xs) - Math.min(...xs) + (Math.max(...zs) - Math.min(...zs))
  const yawSpread = Math.max(...yaws) - Math.min(...yaws)
  check('movement: idle holder changes position over 60 s (no statue)',
    spread > 3, `position spread ${spread.toFixed(1)} m (old code: rooted at one spot)`)
  check('movement: holder walks (p.moving ticks present)', movingTicks > 15, `${movingTicks}/600 ticks moving`)
  check('movement: holder scans a wide arc (yaw sweep > 45°)', yawSpread > 0.8,
    `yaw spread ${(yawSpread * 57.3).toFixed(0)}°`)

  // stance change: deterministic — force the reposition roll into the crouch
  // branch for exactly one at-goal tick (statistically ~35% per ~9 s beat,
  // too thin to wait for in a 60 s sim)
  {
    const g0 = bot.ai!.goal
    bot.ai!.path = []                       // force the at-goal branch
    bot.ai!.repositionAt = 0                // beat is due
    bot.ai!.engageTarget = null
    const crouchBefore = bot.crouch
    const realRandom = Math.random
    Math.random = () => 0.1                // roll < 0.35 → stance change
    updateBots(m, Date.now() + 65000)
    Math.random = realRandom
    check('movement: idle reposition beat flips stance (crouch toggle)',
      bot.crouch === !crouchBefore, `crouch ${crouchBefore} → ${bot.crouch}`)
  }
}

// hurt reaction: a holding bot shot from behind turns toward the shooter
{
  const m = mkMatch('normal')
  const bot = mkPlayer('CT', 0, 24)
  bot.ai!.site = 'A'
  m.players.set(bot.id, bot)
  losFlag = true
  const t0 = Date.now()
  for (let i = 0; i < 200; i++) updateBots(m, t0 + i * 100)   // settle into the hold
  bot.ai!.hurtAt = t0 + 20000
  bot.ai!.hurtFromX = bot.x + 15                       // shooter 15 m due east of the bot
  bot.ai!.hurtFromZ = bot.z
  bot.ai!.engageTarget = null
  updateBots(m, t0 + 20100)
  const wantYaw = -Math.PI / 2                        // atan2(-15, -0): facing +x
  let d = bot.yaw - wantYaw
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  check('movement: shot from behind → bot turns toward the shooter within a tick',
    Math.abs(d) < 0.35, `yaw error ${(d * 57.3).toFixed(0)}°`)
}

// strafe clamp: an engaged bot cannot drift through a wall (LOS-blocked step
// is refused and the strafe direction reverses)
{
  const m = mkMatch('normal')
  const bot = mkPlayer('CT', 0, -20)
  const foe = mkPlayer('T', 0, 10)
  foe.bot = false
  bot.yaw = Math.atan2(-(foe.x - bot.x), -(foe.z - bot.z))   // pre-aimed: engages instantly
  m.players.set(bot.id, bot)
  m.players.set(foe.id, foe)
  armInfinite(bot)
  // LOS: long rays (aim/scans) true, short steps (strafe probes) false = wall
  setBotContext({
    applyDamage: () => {},
    applyShotgunDamage: () => 0,
    hasLOS: (_m, ax, _ay, az, bx, _by, bz) => !(Math.hypot(bx - ax, bz - az) < 0.8),
  })
  const sx0 = bot.x, sz0 = bot.z
  const t0 = Date.now()
  let reversed = false
  const dirAtStart = bot.ai!.strafeDir
  let engagedTicks = 0
  for (let i = 0; i < 50; i++) {
    updateBots(m, t0 + i * 100)
    bot.ammo[bot.inventory[0] as string]!.mag = 30
    if (bot.ai!.engageTarget === foe.id) engagedTicks++
    if (bot.ai!.strafeDir !== dirAtStart) reversed = true
  }
  const drift = Math.hypot(bot.x - sx0, bot.z - sz0)
  check('movement: strafe-clamp sim actually engages (sanity)', engagedTicks > 30, `${engagedTicks}/50 engaged ticks`)
  check('movement: engaged strafe is wall-clamped (no drift through walls)',
    drift < 0.9, `drifted ${drift.toFixed(2)} m (old unclamped wiggle could enter walls)`)
  check('movement: blocked strafe reverses direction', reversed, `strafeDir ${dirAtStart} → ${bot.ai!.strafeDir}`)

  // restore the standard ctx for any later sections
  setBotContext({
    applyDamage: (_m, _victim, _attacker, _weapon, _part, _dist, hs, scale = 1) => {
      dmgCalls.push({ at: 0, dmg: 25 * scale, head: hs })
    },
    applyShotgunDamage: (_m, _victim, _attacker, _weapon, pellets, _dist, scale = 1) => {
      dmgCalls.push({ at: 0, dmg: pellets.length * 20 * scale, head: pellets.some(p => p.part === 'head') })
      return pellets.length
    },
    hasLOS: () => losFlag,
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
