// PHASE 0 + 1 test — category buy menu data model + single stat source
// 1. every weapon has a category (backfill complete)
// 2. BUY_MENU = the six fixed 1.6 slots, numbering 1-6
// 3. BUY_ENTRIES derived from WEAPONS + GEAR (old flat BUY_ITEMS dissolved)
// 4. per-category grouping is correct (incl. empty shotgun/heavy today)
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
  'mp5:1500', 'ak47:2700@T', 'm4:3100@CT', 'awp:4750',
  'kevlar:650', 'kevlarhelm:1000',
]
check('BUY_ENTRIES derived set + prices + teams', JSON.stringify(got) === JSON.stringify(want), got.join(', '))
check('no price-0 starters/knife/c4 in buy list',
  !client.BUY_ENTRIES.some(e => ['knife', 'glock', 'usp', 'c4'].includes(e.id)))

// --- 4. grouping ---
const groups: Record<string, string[]> = {
  pistol: ['deagle', 'p250', 'fiveseven', 'tec9', 'cz75', 'elites', 'hkp2000', 'revolver', 'taser'],
  shotgun: [], smg: ['mp5'], rifle: ['ak47', 'm4', 'awp'],
  heavy: [], equipment: ['kevlar', 'kevlarhelm'],
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

// 7b. suppressed: USP-S and MP5-SD are the integrally suppressed pair today
check('suppressed flags: usp + mp5 only',
  shared.WEAPONS.usp.suppressed === true && shared.WEAPONS.mp5.suppressed === true &&
  Object.values(shared.WEAPONS).filter(w => w.suppressed).length === 2)

// 7c. scope: AWP = 2 levels, fov 16 (matches engine's current hardcode); others 0
check('AWP scopeLevels=2 zoomFov=16, others unsoped',
  shared.WEAPONS.awp.scopeLevels === 2 && shared.WEAPONS.awp.zoomFov === 16 &&
  shared.scopeLevelsOf(shared.WEAPONS.awp) === 2 && shared.zoomFovOf(shared.WEAPONS.awp) === 16 &&
  Object.values(shared.WEAPONS).every(w => w.id === 'awp' ? true : shared.scopeLevelsOf(w) === 0))

// 7d. kill-reward classes: where set, the class table value must equal the
//     weapon's explicit killReward (no drift between the two representations)
for (const w of Object.values(shared.WEAPONS)) {
  if (!w.killRewardClass) continue
  check(`killRewardClass[${w.id}] matches explicit value`,
    shared.KILL_REWARD_BY_CLASS[w.killRewardClass] === w.killReward,
    `${w.killRewardClass} → ${shared.KILL_REWARD_BY_CLASS[w.killRewardClass]} vs ${w.killReward}`)
}

// 7e. future-phase fields stay absent on the current roster (zero gameplay
//     change: no burst, no pellets, no throwables, no recoil seeds yet)
check('no burst/pellets/throwable/recoilPattern on current roster',
  Object.values(shared.WEAPONS).every(w =>
    w.pellets === undefined && w.throwable === undefined &&
    w.burstRounds === undefined && w.recoilPattern === undefined))

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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
