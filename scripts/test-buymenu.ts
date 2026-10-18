// PHASE 0 + 1 test — category buy menu data model + single stat source
// 1. every weapon has a category (backfill complete)
// 2. BUY_MENU = the six fixed 1.6 slots, numbering 1-6
// 3. BUY_ENTRIES derived from WEAPONS + GEAR (old flat BUY_ITEMS dissolved)
// 4. per-category grouping is correct (all six categories live — Phase 7
//    filled the heavy/MACHINE GUNS slot with negev + m249)
// 5. single source of truth: client and server shims resolve to the SAME
//    module (object identity) — Phase 1 killed the duplicated tables; this
//    catches anyone re-duplicating stats into either shim
// 6. every buy entry is actually purchasable server-side
// 7. Phase 1 schema extensions: fireMode backfill consistent with legacy
//    `auto` flag, suppressed flags, scope levels/zoomFov, kill-reward class
//    table consistent with explicit values, no burst/pellets/throwables yet
import * as client from '../src/game/weapons'
import * as server from '../mini-services/game-server/weapons'
import * as shared from '../shared/weapons'
import type { WeaponCategory } from '../src/game/weapons'
import { readFileSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const VALID_CATS: WeaponCategory[] = ['pistol', 'smg', 'shotgun', 'rifle', 'heavy', 'grenade', 'gear']
const EXPECTED_CAT: Record<string, WeaponCategory> = {
  knife: 'gear', glock: 'pistol', usp: 'pistol', deagle: 'pistol',
  mp5: 'smg', ak47: 'rifle', m4: 'rifle', awp: 'rifle', c4: 'gear',
  // Phase 3 pistols
  p250: 'pistol', fiveseven: 'pistol', tec9: 'pistol', cz75: 'pistol',
  elites: 'pistol', hkp2000: 'pistol', revolver: 'pistol', taser: 'pistol',
  // Phase 4 SMGs
  mp9: 'smg', mac10: 'smg', mp7: 'smg', ump45: 'smg', p90: 'smg', bizon: 'smg',
  // Phase 5 rifles + snipers
  m4a1s: 'rifle', galil: 'rifle', famas: 'rifle', sg553: 'rifle', aug: 'rifle',
  ssg08: 'rifle', scar20: 'rifle', g3sg1: 'rifle',
  // Phase 7 machine guns
  negev: 'heavy', m249: 'heavy',
  // Phase 8 grenades
  flash: 'grenade', he: 'grenade', smoke: 'grenade',
  molotov: 'grenade', inc: 'grenade', decoy: 'grenade',
}

// --- 1. category backfill ---
for (const [id, cat] of Object.entries(EXPECTED_CAT)) {
  const w = client.WEAPONS[id as client.WeaponId]
  check(`category[${id}] = ${cat}`, !!w && w.category === cat, w ? `got ${w.category}` : 'missing weapon')
}
check('all categories are valid enum values',
  Object.values(client.WEAPONS).every(w => VALID_CATS.includes(w.category)))

// --- 2. fixed 1.6 menu numbering ---
const labels = client.BUY_MENU.map(c => c.label)
check('BUY_MENU has 6 slots with 1.6 numbering', JSON.stringify(labels) === JSON.stringify(['PISTOLS', 'SHOTGUNS', 'SMGs', 'RIFLES', 'MACHINE GUNS', 'EQUIPMENT']), labels.join('/'))
check('BUY_MENU keys unique', new Set(client.BUY_MENU.map(c => c.key)).size === 6)

// --- 3. derived buy list (BUY_ITEMS dissolved) ---
const got = client.BUY_ENTRIES.map(e => `${e.id}:${e.price}${e.team ? '@' + e.team : ''}`)
const want = [
  'deagle:700',
  // Phase 3 pistols
  'p250:300', 'fiveseven:500@CT', 'tec9:500@T', 'cz75:500', 'elites:500',
  'hkp2000:200@CT', 'revolver:600', 'taser:200',
  'mp5:1500',
  // Phase 4 SMGs
  'mp9:1250@CT', 'mac10:1250@T', 'mp7:1500', 'ump45:1500', 'p90:2350', 'bizon:1400',
  'ak47:2700@T', 'm4:3100@CT',
  // Phase 5 rifles + snipers (rifle category: 11 entries — buy menu pages)
  'm4a1s:2900@CT', 'galil:1800@T', 'famas:1700@CT', 'sg553:3000@T', 'aug:3300@CT',
  'ssg08:1700', 'scar20:5000@CT', 'g3sg1:5000@T', 'awp:4750',
  // Phase 6 shotguns (shotgun category: 4 entries, first non-empty page)
  'nova:1050', 'xm1014:2000', 'mag7:1300@CT', 'sawedoff:1100@T',
  // Phase 7 machine guns (heavy category goes live)
  'negev:1700', 'm249:5200',
  // Phase 8: equipment = gear first (1.6-style), then grenades in table order
  'kevlar:650', 'kevlarhelm:1000', 'defusekit:400@CT',
  'flash:200', 'he:300', 'smoke:300', 'molotov:400@T', 'inc:600@CT', 'decoy:50',
]
check('BUY_ENTRIES derived set + prices + teams', JSON.stringify(got) === JSON.stringify(want), got.join(', '))
check('no price-0 starters/knife/c4 in buy list',
  !client.BUY_ENTRIES.some(e => ['knife', 'glock', 'usp', 'c4'].includes(e.id)))

// --- 4. grouping ---
const groups: Record<string, string[]> = {
  pistol: ['deagle', 'p250', 'fiveseven', 'tec9', 'cz75', 'elites', 'hkp2000', 'revolver', 'taser'],
  shotgun: ['nova', 'xm1014', 'mag7', 'sawedoff'], smg: ['mp5', 'mp9', 'mac10', 'mp7', 'ump45', 'p90', 'bizon'],
  rifle: ['ak47', 'm4', 'm4a1s', 'galil', 'famas', 'sg553', 'aug', 'ssg08', 'scar20', 'g3sg1', 'awp'],
  heavy: ['negev', 'm249'],
  equipment: ['kevlar', 'kevlarhelm', 'defusekit', 'flash', 'he', 'smoke', 'molotov', 'inc', 'decoy'],
}
check('pistol category fits the 9-digit buy menu cap', groups.pistol.length <= 9)
for (const [key, ids] of Object.entries(groups)) {
  const gotIds = client.buyEntriesFor(key as client.BuyMenuKey).map(e => e.id)
  check(`group[${key}]`, JSON.stringify(gotIds) === JSON.stringify(ids), gotIds.join(',') || '(empty)')
}

// --- 5. single source of truth (Phase 1) ---
// Object identity: both shims must resolve to the SAME shared module — a
// re-duplicated hand-written table would produce distinct objects and fail.
check('WEAPONS is the SAME object client/server/shared',
  client.WEAPONS === server.WEAPONS && client.WEAPONS === shared.WEAPONS)
check('BUY_ENTRIES is the SAME object client/server/shared',
  client.BUY_ENTRIES === server.BUY_ENTRIES && client.BUY_ENTRIES === shared.BUY_ENTRIES)
check('GEAR is the SAME object client/server/shared',
  client.GEAR === server.GEAR && client.GEAR === shared.GEAR)
check('ECONOMY/ROUND/PART_MULT are the SAME objects client/server/shared',
  client.ECONOMY === server.ECONOMY && client.ROUND === server.ROUND &&
  client.PART_MULT === server.PART_MULT && client.ECONOMY === shared.ECONOMY)
check('computeDamage behaves identically via both shims',
  JSON.stringify(client.computeDamage(client.WEAPONS.ak47, 'head', 12.3, 50, true)) ===
  JSON.stringify(server.computeDamage(server.WEAPONS.ak47, 'head', 12.3, 50, true)))

// --- 6. every buy entry is actually purchasable server-side ---
for (const e of client.BUY_ENTRIES) {
  const w = client.WEAPONS[e.id as client.WeaponId]
  const ok = w ? w.price > 0 : e.kind === 'gear'
  check(`server can buy ${e.id}`, ok)
}

// --- 7. Phase 1 schema extensions ---
// 7a. fireMode backfill must agree with the legacy auto boolean for every
//     weapon (fireModeOf resolves the default, explicit values must match).
for (const w of Object.values(shared.WEAPONS)) {
  check(`fireModeOf[${w.id}] consistent with legacy auto`,
    (shared.fireModeOf(w) === 'auto') === w.auto,
    `${shared.fireModeOf(w)} vs auto=${w.auto}`)
}
check('fireMode backfilled on all weapons',
  Object.values(shared.WEAPONS).every(w => w.fireMode !== undefined))

// 7b. suppressed: usp/mp5 (integral) + Phase-5 m4a1s
check('suppressed flags: usp + mp5 + m4a1s only',
  shared.WEAPONS.usp.suppressed === true && shared.WEAPONS.mp5.suppressed === true &&
  shared.WEAPONS.m4a1s.suppressed === true &&
  Object.values(shared.WEAPONS).filter(w => w.suppressed).length === 3)

// 7c. scopes: 2-level snipers (awp/ssg08/scar20/g3sg1), 1-level scoped
// rifles (sg553/aug), everything else 0
check('scope levels: snipers 2, scoped rifles 1, rest 0',
  ['awp', 'ssg08', 'scar20', 'g3sg1'].every(id => shared.scopeLevelsOf(shared.WEAPONS[id as shared.WeaponId]) === 2) &&
  ['sg553', 'aug'].every(id => shared.scopeLevelsOf(shared.WEAPONS[id as shared.WeaponId]) === 1) &&
  Object.values(shared.WEAPONS).every(w =>
    ['awp', 'ssg08', 'scar20', 'g3sg1', 'sg553', 'aug'].includes(w.id) ? true : shared.scopeLevelsOf(w) === 0))

// 7d. kill-reward classes: where set, the class table value must equal the
//     weapon's explicit killReward (no drift between the two representations)
for (const w of Object.values(shared.WEAPONS)) {
  if (!w.killRewardClass) continue
  check(`killRewardClass[${w.id}] matches explicit value`,
    shared.KILL_REWARD_BY_CLASS[w.killRewardClass] === w.killReward,
    `${w.killRewardClass} → ${shared.KILL_REWARD_BY_CLASS[w.killRewardClass]} vs ${w.killReward}`)
}

// 7e. future-phase fields stay absent on the current roster except where a
//     phase owns them: pellets ONLY on the 4 Phase-6 shotguns; throwables
//     ONLY on the 6 Phase-8 grenades; no recoil seeds; burst ONLY on famas
check('pellets only on shotguns; throwables only on the 6 grenades; burst only on famas',
  Object.values(shared.WEAPONS).every(w =>
    (['nova', 'xm1014', 'mag7', 'sawedoff'].includes(w.id) ? (w.pellets ?? 0) > 1 : w.pellets === undefined) &&
    (w.category === 'grenade' ? !!w.throwable : w.throwable === undefined) &&
    w.recoilPattern === undefined &&
    (w.id === 'famas' ? w.burstRounds === 3 : w.burstRounds === undefined)))

// --- 8. Phase 3 pistol mechanics (schema-level) ---
check('cz75 is the only full-auto pistol (800 RPM)',
  shared.fireModeOf(shared.WEAPONS.cz75) === 'auto' && shared.WEAPONS.cz75.auto === true &&
  shared.WEAPONS.cz75.fireDelay === 75 &&
  Object.values(shared.WEAPONS).filter(w => w.category === 'pistol' && w.auto).length === 1)
check('team-restricted pistols: fiveseven/hkp2000 CT, tec9 T, rest free',
  shared.WEAPONS.fiveseven.team === 'CT' && shared.WEAPONS.hkp2000.team === 'CT' &&
  shared.WEAPONS.tec9.team === 'T' &&
  ['p250', 'cz75', 'elites', 'revolver', 'taser'].every(id => shared.WEAPONS[id as shared.WeaponId].team === undefined))
check('taser: single shot, no reserve, no kill reward',
  shared.WEAPONS.taser.mag === 1 && shared.WEAPONS.taser.reserve === 0 &&
  shared.WEAPONS.taser.killReward === 0)
check('zeus one-shots an armored+helmet victim at close range',
  shared.computeDamage(shared.WEAPONS.taser, 'body', 4, 100, true).dmg >= 100)
check('revolver: slow trigger (>= 800ms) + heavy damage',
  shared.WEAPONS.revolver.fireDelay >= 800 && shared.WEAPONS.revolver.damage >= 80)
for (const id of ['p250', 'cz75', 'elites', 'taser'] as const) {
  const w = shared.WEAPONS[id]
  check(`[${id}] one-shots an unarmored head (pistol class)`,
    shared.computeDamage(w, 'head', 5, 0, false).dmg >= 100)
}

check('smg category fits the 9-digit buy menu cap', groups.smg.length <= 9)

// --- 9. Phase 4 SMG mechanics (schema-level) ---
check('mp9 CT / mac10 T are the only team-restricted SMGs; rest free',
  shared.WEAPONS.mp9.team === 'CT' && shared.WEAPONS.mac10.team === 'T' &&
  ['mp5', 'mp7', 'ump45', 'p90', 'bizon'].every(id => shared.WEAPONS[id as shared.WeaponId].team === undefined))
check('all six new SMGs are $600 kill-reward class',
  ['mp9', 'mac10', 'mp7', 'ump45', 'p90', 'bizon'].every(id => {
    const w = shared.WEAPONS[id as shared.WeaponId]
    return w.killReward === 600 && w.killRewardClass === 'smg' &&
      shared.KILL_REWARD_BY_CLASS[w.killRewardClass!] === w.killReward
  }))
check('bizon carries the 64-round helical mag; p90 the 50-round top mag',
  shared.WEAPONS.bizon.mag === 64 && shared.WEAPONS.p90.mag === 50)
check('mp7 is the fastest SMG (900 RPM ≈ 67ms)',
  shared.WEAPONS.mp7.fireDelay <= 67 &&
  Object.values(shared.WEAPONS).filter(w => w.category === 'smg').every(w => w.fireDelay >= shared.WEAPONS.mp7.fireDelay))
check('ump45 has the heaviest SMG damage + armor-punch quirk (p90 tops pen)',
  Object.values(shared.WEAPONS).filter(w => w.category === 'smg').every(w => w.damage <= shared.WEAPONS.ump45.damage) &&
  shared.WEAPONS.ump45.armorPen >= 0.65 && shared.WEAPONS.p90.armorPen > shared.WEAPONS.ump45.armorPen)
check('UMP is the slowest-moving SMG (230/250 speed scale)',
  Object.values(shared.WEAPONS).filter(w => w.category === 'smg').every(w =>
    w.id === 'ump45' || w.moveSpeed >= shared.WEAPONS.ump45.moveSpeed))

// --- 10. Phase 5 rifle mechanics (schema-level) ---
check('rifle category exceeds 9 rows → buy menu paging is required and wired',
  client.buyEntriesFor('rifle').length === 11 &&
  readFileSync('src/game/hud.tsx', 'utf8').includes('const PAGE = 8'))
check('famas: 3-round burst + 400ms retrigger + 75ms cadence',
  shared.WEAPONS.famas.fireMode === 'burst' && shared.WEAPONS.famas.burstRounds === 3 &&
  shared.WEAPONS.famas.burstDelayMs === 75 && shared.WEAPONS.famas.fireDelay === 400 &&
  shared.fireModeOf(shared.WEAPONS.famas) === 'burst')
check('sg553 armorPen 1.0 (helmet one-tap quirk); m4a1s suppressed',
  shared.WEAPONS.sg553.armorPen === 1.0 && shared.WEAPONS.m4a1s.suppressed === true)
check('auto-snipers: auto + $100; ssg08 scout: $300 + semi',
  shared.WEAPONS.scar20.auto === true && shared.WEAPONS.scar20.killReward === 100 &&
  shared.WEAPONS.g3sg1.auto === true && shared.WEAPONS.g3sg1.killReward === 100 &&
  shared.WEAPONS.ssg08.auto === false && shared.WEAPONS.ssg08.killReward === 300 &&
  shared.WEAPONS.ssg08.killRewardClass === 'scout')
check('m4a1s vs m4 pairing: same slot + team, cheaper, smaller mag',
  shared.WEAPONS.m4a1s.slot === shared.WEAPONS.m4.slot &&
  shared.WEAPONS.m4a1s.team === shared.WEAPONS.m4.team &&
  shared.WEAPONS.m4a1s.price < shared.WEAPONS.m4.price &&
  shared.WEAPONS.m4a1s.mag < shared.WEAPONS.m4.mag)

// --- 11. Phase 6 shotgun mechanics (schema-level) ---
check('pellet counts per plan 6.1: nova 9, xm1014/mag7/sawedoff 8',
  shared.WEAPONS.nova.pellets === 9 && shared.WEAPONS.xm1014.pellets === 8 &&
  shared.WEAPONS.mag7.pellets === 8 && shared.WEAPONS.sawedoff.pellets === 8 &&
  shared.pelletsOf(shared.WEAPONS.nova) === 9 && shared.pelletsOf(shared.WEAPONS.ak47) === 1)
check('shotgun cone spreads: mag7 tightest, sawedoff wildest',
  shared.pelletSpreadOf(shared.WEAPONS.mag7) < shared.pelletSpreadOf(shared.WEAPONS.nova) &&
  shared.pelletSpreadOf(shared.WEAPONS.sawedoff) > shared.pelletSpreadOf(shared.WEAPONS.nova) &&
  shared.pelletSpreadOf(shared.WEAPONS.ak47) === 0)
check('team locks: mag7 CT, sawedoff T, nova + xm1014 free',
  shared.WEAPONS.mag7.team === 'CT' && shared.WEAPONS.sawedoff.team === 'T' &&
  shared.WEAPONS.nova.team === undefined && shared.WEAPONS.xm1014.team === undefined)
check('all shotguns are the $900 kill-reward class',
  ['nova', 'xm1014', 'mag7', 'sawedoff'].every(id => {
    const w = shared.WEAPONS[id as shared.WeaponId]
    return w.killReward === 900 && w.killRewardClass === 'shotgun' &&
      shared.KILL_REWARD_BY_CLASS[w.killRewardClass!] === w.killReward
  }))
check('pump guns are semi; xm1014 is the auto shotgun (plan 6.2)',
  shared.WEAPONS.nova.auto === false && shared.WEAPONS.mag7.auto === false &&
  shared.WEAPONS.sawedoff.auto === false && shared.WEAPONS.xm1014.auto === true &&
  shared.fireModeOf(shared.WEAPONS.xm1014) === 'auto')
check('shotgun falloff is brutal: mag7/sawedoff 0.45, nova/xm 0.70 (close-range only)',
  shared.WEAPONS.mag7.falloff10m === 0.45 && shared.WEAPONS.sawedoff.falloff10m === 0.45 &&
  shared.WEAPONS.nova.falloff10m === 0.70 && shared.WEAPONS.xm1014.falloff10m === 0.70 &&
  Object.values(shared.WEAPONS).filter(w => w.category === 'shotgun').every(w => w.falloff10m <= 0.70))
check('shotgun category fits one buy page (4 rows, no paging needed)',
  client.buyEntriesFor('shotgun').length === 4)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

// --- 11. Phase 8 grenades + equipment (schema-level) ---
const GRENADES = ['flash', 'he', 'smoke', 'molotov', 'inc', 'decoy'] as const
check('all six grenades live in slot 5 with maxCarry set',
  GRENADES.every(id => {
    const w = shared.WEAPONS[id]
    return w.slot === 5 && (w.maxCarry ?? 0) > 0
  }))
check('carry limits per plan 8.3: flash 2, all others 1',
  shared.WEAPONS.flash.maxCarry === 2 &&
  ['he', 'smoke', 'molotov', 'inc', 'decoy'].every(id => shared.WEAPONS[id].maxCarry === 1))
check('grenadeLimitOf resolves the table limits (0 for non-throwables)',
  shared.grenadeLimitOf(shared.WEAPONS.flash) === 2 &&
  shared.grenadeLimitOf(shared.WEAPONS.he) === 1 &&
  shared.grenadeLimitOf(shared.WEAPONS.ak47) === 0)
check('team fire grenades: molotov T / incendiary CT, rest free',
  shared.WEAPONS.molotov.team === 'T' && shared.WEAPONS.inc.team === 'CT' &&
  ['flash', 'he', 'smoke', 'decoy'].every(id => shared.WEAPONS[id].team === undefined))
check('prices per plan 8.2: flash 200, he 300, smoke 300, molly 400, inc 600, decoy 50, kit 400',
  shared.WEAPONS.flash.price === 200 && shared.WEAPONS.he.price === 300 &&
  shared.WEAPONS.smoke.price === 300 && shared.WEAPONS.molotov.price === 400 &&
  shared.WEAPONS.inc.price === 600 && shared.WEAPONS.decoy.price === 50 &&
  shared.GEAR.find(g => g.id === 'defusekit')?.price === 400)
check('defuse kit is CT-only gear',
  shared.GEAR.find(g => g.id === 'defusekit')?.team === 'CT')
check('HE carries the blast numbers for shared heDamage (98 / 50% armor)',
  shared.WEAPONS.he.damage === 98 && shared.WEAPONS.he.armorPen === 0.5)
check('grenade kill rewards ride the grenade class at $300',
  GRENADES.every(id => shared.WEAPONS[id].killReward === 300 &&
    shared.WEAPONS[id].killRewardClass === 'grenade' &&
    shared.KILL_REWARD_BY_CLASS.grenade === 300))
check('equipment category has 9 entries → buy menu pages (8/page)',
  client.buyEntriesFor('equipment').length === 9)
