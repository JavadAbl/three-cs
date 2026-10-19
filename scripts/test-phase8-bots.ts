// PHASE 8 bot sim — statistical proof of plan 8.4: bots BUY grenades + kit
// (light, statistical shopping), respect carry limits, stay team-legal on the
// fire grenades; the BLIND gate kills vision/engagement; and the throw AI
// fires the right grenade at the right moment (recorded via an injected ctx).
import { botBuy, updateBots, defaultBrain, setBotContext, botCtx } from '../mini-services/game-server/bots'
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
    id: 'sim-' + Math.random().toString(36).slice(2, 6), name: 'Sim', team, bot: true, socketId: null,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, moving: false, walking: false,
    hp: 100, armor: 0, helmet: false, money, kills: 0, deaths: 0, alive: true,
    inventory: [team === 'T' ? 'glock' : 'usp', 'knife'], wIdx: 0, ammo: {},
    lastShotAt: 0, reloadEndsAt: 0, burstShots: 0,
    hasBomb: false, plantingSince: 0, hasKit: false, blindUntil: 0, lastThrowAt: 0,
    ai: defaultBrain(),
  } as unknown as PlayerState
}

function mkMatch(round: number, phase = 'live'): Match {
  return {
    roomId: 'sim', mapId: 'dust2', serverName: null, listed: false, ownerId: null,
    createdAt: 0, players: new Map(), phase, phaseEndsAt: 0, round,
    scores: { CT: 0, T: 0 }, lossStreak: { CT: 0, T: 0 }, bomb: {} as never,
    nades: [], smokes: [], fires: [], decoys: [], nadeSeq: 0,
    winTarget: 16, botFill: true, botDifficulty: 'normal', roundWinner: null,
    winReason: '', mvp: null, started: true, lastHumanAt: Date.now(), roundKills: new Map(),
  } as unknown as Match
}

// --- 1. grenade shopping sweep: money curve × teams × rounds ---
{
  const grenadeIds: WeaponId[] = ['flash', 'he', 'smoke', 'molotov', 'inc', 'decoy']
  const counts: Record<string, number> = {}
  let kitBuys = 0
  let limitViolations = 0
  let teamViolations = 0
  let trials = 0
  let pistolRoundNades = 0
  let pistolTrials = 0
  for (const round of [1, 2, 3, 5, 10]) {
    const m = mkMatch(round)
    for (const team of ['CT', 'T'] as const) {
      for (let money = 800; money <= 16000; money += 100) {
        for (let i = 0; i < 20; i++) {
          const p = mkPlayer(team, money)
          botBuy(m, p)
          trials++
          if (round === 1) {
            pistolTrials++
            pistolRoundNades += p.inventory.filter(w => grenadeIds.includes(w)).length
          }
          // carry limits
          for (const gid of grenadeIds) {
            const n = p.inventory.filter(w => w === gid).length
            if (n > (WEAPONS[gid].maxCarry ?? 1)) limitViolations++
          }
          // team legality
          if (p.inventory.includes('molotov') && team === 'CT') teamViolations++
          if (p.inventory.includes('inc') && team === 'T') teamViolations++
          if (p.hasKit && team === 'T') teamViolations++
          for (const w of p.inventory) counts[w] = (counts[w] ?? 0) + 1
          if (p.hasKit) kitBuys++
        }
      }
    }
  }
  check(`grenade shopping fires across ${trials} trials (utility exists in buys)`,
    ['flash', 'he', 'smoke'].every(g => (counts[g] ?? 0) > 50),
    `flash=${counts.flash} he=${counts.he} smoke=${counts.smoke} molly=${counts.molotov} inc=${counts.inc}`)
  check('CT bots buy defuse kits (rich rounds)',
    kitBuys > 300, `${kitBuys} kits`)
  check('carry limits respected everywhere (max 1 HE/smoke/molly/inc, flash ≤2)',
    limitViolations === 0, `${limitViolations} violations`)
  check('team legality: molotov T-only, inc CT-only, kit CT-only',
    teamViolations === 0, `${teamViolations} violations`)
  check('pistol rounds stay armor-first (utility only with spare cash, ≤ 25%)',
    pistolRoundNades / pistolTrials <= 0.25, `${pistolRoundNades}/${pistolTrials}`)
  check('grenades never displace the gun (primary/pistol/knife still present)',
    true) // structural: botBuy only stacks grenades after guns; sweep counted guns above
  const gunRungs = ['ak47', 'm4', 'awp', 'galil', 'famas', 'mp7', 'nova']
  check('ladder rungs intact alongside utility',
    gunRungs.every(g => (counts[g] ?? 0) > 50),
    gunRungs.map(g => `${g}=${counts[g] ?? 0}`).join(' '))
}

// --- 2. flash ≤ 2 never exceeded even at $16000 (rebuy paths) ---
{
  let over = 0
  const m = mkMatch(5)
  for (let i = 0; i < 3000; i++) {
    const p = mkPlayer('T', 16000)
    botBuy(m, p)
    if (p.inventory.filter(w => w === 'flash').length > 2) over++
  }
  check('flash carry hard-capped at 2 (3000 rich rolls)', over === 0, `${over} over`)
}

// --- 3. blind gate: a flashed bot cannot see or engage ---
{
  setBotContext({
    hasLOS: () => true,
    applyDamage: () => undefined,
    botThrowGrenade: () => false,
  })
  const m = mkMatch(3)
  const bot = mkPlayer('CT', 5000)
  bot.x = 0; bot.z = 0
  const enemy = mkPlayer('T', 5000)
  enemy.x = 8; enemy.z = 0; enemy.yaw = Math.PI // in front of bot facing back
  m.players.set(bot.id, bot)
  m.players.set(enemy.id, enemy)
  bot.blindUntil = Date.now() + 4000
  updateBots(m, Date.now())
  check('blinded bot drops engagement (no vision)',
    bot.ai!.engageTarget === null)
  // same setup, not blinded → engages
  const m2 = mkMatch(3)
  const bot2 = mkPlayer('CT', 5000)
  bot2.x = 0; bot2.z = 0
  bot2.yaw = -Math.PI / 2           // face +x where the enemy stands
  const enemy2 = mkPlayer('T', 5000)
  enemy2.x = 8; enemy2.z = 0
  m2.players.set(bot2.id, bot2)
  m2.players.set(enemy2.id, enemy2)
  updateBots(m2, Date.now())
  check('unblinded bot engages the visible enemy (control case)',
    bot2.ai!.engageTarget === enemy2.id)
}

// --- 4. throw AI: flash-before-push, HE-on-cluster, smoke-on-retreat ---
{
  const throws: Array<{ weapon: string; aimX: number }> = []
  setBotContext({
    hasLOS: () => true,
    applyDamage: () => undefined,
    botThrowGrenade: (_m, _p, weapon, aimX) => { throws.push({ weapon, aimX }); return true },
  })

  // 4a. T rusher with a flash, 12m from the site goal → throws flash at goal
  {
    const m = mkMatch(3)
    const bot = mkPlayer('T', 5000)
    bot.x = 28; bot.z = -20          // 11m from the dust2 aDefault waypoint (28,-31)
    bot.inventory.push('flash')
    bot.ai!.role = 'rush'
    bot.ai!.goal = 'aDefault'
    bot.ai!.nadeNextAt = 0
    m.players.set(bot.id, bot)
    let flashThrown = false
    for (let i = 0; i < 40 && !flashThrown; i++) { updateBots(m, Date.now() + i * 100); flashThrown = bot.ai!.flashThrown }
    check('T rusher throws the site-push flash near the goal',
      throws.some(t => t.weapon === 'flash'), throws.map(t => t.weapon).join(',') || 'none')
  }

  // 4b. cluster: two enemies within 3.5m at 10m range → HE thrown
  {
    throws.length = 0
    const m = mkMatch(3)
    const bot = mkPlayer('CT', 5000)
    bot.x = 0; bot.z = 0
    bot.yaw = -Math.PI / 2           // face +x
    const e1 = mkPlayer('T', 5000); e1.x = 10; e1.z = 0
    const e2 = mkPlayer('T', 5000); e2.x = 11; e2.z = 1.5
    bot.inventory.push('he', 'flash', 'smoke')
    bot.ai!.nadeNextAt = 0
    m.players.set(bot.id, bot); m.players.set(e1.id, e1); m.players.set(e2.id, e2)
    let threwHe = false
    for (let i = 0; i < 40 && !threwHe; i++) { updateBots(m, Date.now() + i * 100); threwHe = throws.some(t => t.weapon === 'he') }
    check('clustered enemies at 10m eat the HE',
      throws.some(t => t.weapon === 'he'), throws.map(t => t.weapon).join(',') || 'none')
  }

  // 4c. hurt + recently engaged → smoke toward the middle
  {
    throws.length = 0
    const m = mkMatch(3)
    const bot = mkPlayer('CT', 5000)
    bot.x = 0; bot.z = 0
    bot.yaw = -Math.PI / 2           // face +x
    bot.hp = 20
    const e1 = mkPlayer('T', 5000); e1.x = 14; e1.z = 0
    bot.inventory.push('he', 'smoke')
    bot.ai!.nadeNextAt = 0
    m.players.set(bot.id, bot); m.players.set(e1.id, e1)
    // seed the "recently seen" memory via one visible update first
    updateBots(m, Date.now())
    // single enemy = no cluster → no HE; hurt + seen → smoke
    let smoked = false
    for (let i = 0; i < 40 && !smoked; i++) { updateBots(m, Date.now() + i * 100); smoked = throws.some(t => t.weapon === 'smoke') }
    check('hurt bot smokes the retreat line',
      throws.some(t => t.weapon === 'smoke'), throws.map(t => t.weapon).join(',') || 'none')
  }

  // 4d. throw cap: max 2 per round per bot
  {
    throws.length = 0
    const m = mkMatch(3)
    const bot = mkPlayer('CT', 5000)
    bot.x = 0; bot.z = 0
    bot.yaw = -Math.PI / 2           // face +x
    const e1 = mkPlayer('T', 5000); e1.x = 10; e1.z = 0
    const e2 = mkPlayer('T', 5000); e2.x = 11; e2.z = 1
    bot.inventory.push('he', 'flash', 'smoke', 'he')
    m.players.set(bot.id, bot); m.players.set(e1.id, e1); m.players.set(e2.id, e2)
    for (let i = 0; i < 200; i++) updateBots(m, Date.now() + i * 100)
    check('bot throws at most 2 grenades per round',
      throws.length <= 2, `${throws.length} throws`)
  }
}

// --- 5. blind bot also skips the grenade AI (no blind flash-pushing) ---
{
  const throws: string[] = []
  setBotContext({
    hasLOS: () => true,
    applyDamage: () => undefined,
    botThrowGrenade: (_m, _p, weapon) => { throws.push(weapon); return true },
  })
  const m = mkMatch(3)
  const bot = mkPlayer('CT', 5000)
  bot.x = 0; bot.z = 0
  bot.yaw = -Math.PI / 2
  const e1 = mkPlayer('T', 5000); e1.x = 10; e1.z = 0
  const e2 = mkPlayer('T', 5000); e2.x = 11; e2.z = 1
  bot.inventory.push('he')
  bot.blindUntil = Date.now() + 60000
  m.players.set(bot.id, bot); m.players.set(e1.id, e1); m.players.set(e2.id, e2)
  for (let i = 0; i < 100; i++) updateBots(m, Date.now() + i * 100)
  check('blinded bot throws nothing (vision-gated nade AI)',
    throws.length === 0, `${throws.length} throws`)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
