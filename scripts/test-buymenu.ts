// PHASE 0 test — CS 1.6 category buy menu data model
// 1. every weapon has a category (backfill complete)
// 2. BUY_MENU = the six fixed 1.6 slots, numbering 1-6
// 3. BUY_ENTRIES derived from WEAPONS + GEAR (old flat BUY_ITEMS dissolved)
// 4. per-category grouping is correct (incl. empty shotgun/heavy today)
// 5. client and server stat tables are deep-identical (manual-sync guard
//    until Phase 1 unifies them — this is the drift early-warning)
import * as client from '../src/game/weapons'
import * as server from '../mini-services/game-server/weapons'
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
const want = ['deagle:700', 'mp5:1500', 'ak47:2700@T', 'm4:3100@CT', 'awp:4750', 'kevlar:650', 'kevlarhelm:1000']
check('BUY_ENTRIES derived set + prices + teams', JSON.stringify(got) === JSON.stringify(want), got.join(', '))
check('no price-0 starters/knife/c4 in buy list',
  !client.BUY_ENTRIES.some(e => ['knife', 'glock', 'usp', 'c4'].includes(e.id)))

// --- 4. grouping ---
const groups: Record<string, string[]> = {
  pistol: ['deagle'], shotgun: [], smg: ['mp5'], rifle: ['ak47', 'm4', 'awp'],
  heavy: [], equipment: ['kevlar', 'kevlarhelm'],
}
for (const [key, ids] of Object.entries(groups)) {
  const gotIds = client.buyEntriesFor(key as client.BuyMenuKey).map(e => e.id)
  check(`group[${key}]`, JSON.stringify(gotIds) === JSON.stringify(ids), gotIds.join(',') || '(empty)')
}

// --- 5. client/server table parity (the pre-Phase-1 drift guard) ---
check('WEAPONS identical client vs server',
  JSON.stringify(client.WEAPONS) === JSON.stringify(server.WEAPONS))
check('BUY_ENTRIES identical client vs server',
  JSON.stringify(client.BUY_ENTRIES) === JSON.stringify(server.BUY_ENTRIES))
check('GEAR identical client vs server',
  JSON.stringify(client.GEAR) === JSON.stringify(server.GEAR))
check('ECONOMY/ROUND/PART_MULT identical client vs server',
  JSON.stringify({ e: client.ECONOMY, r: client.ROUND, p: client.PART_MULT }) ===
  JSON.stringify({ e: server.ECONOMY, r: server.ROUND, p: server.PART_MULT }))

// --- 6. every buy entry is actually purchasable server-side ---
for (const e of client.BUY_ENTRIES) {
  const w = client.WEAPONS[e.id as client.WeaponId]
  const ok = w ? w.price > 0 : e.kind === 'gear'
  check(`server can buy ${e.id}`, ok)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
