// PHASE 7 test — machine guns x2: data sanity (CS:GO fandom values), accuracy
// ramp schema + math, single-ray ballistics routing, audio wiring (staged
// box samples), viewmodels (box-mag MG family, bipod, no bolt/pump), buy-menu
// heavy category, engine spool wiring, bots-never-buy-MGs source proof.
// Run: bun scripts/test-phase7.ts
import './domstub'
import * as THREE from 'three'
import { WEAPONS, computeDamage, pelletsOf, KILL_REWARD_BY_CLASS, fireModeOf, accuracyRampOf, buyEntriesFor, WeaponId } from '../shared/weapons'
import { WEAPON_AUDIO, liveWeaponSoundFiles } from '../shared/weapons-audio'
import { buildViewModel, buildRemoteGun } from '../src/game/weaponmodels'
import { existsSync, readFileSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const NEW: WeaponId[] = ['negev', 'm249']
const STAGED = '/home/z/my-project/public/staging/sounds'

// --- 1. data sanity (CS:GO fandom infobox values, plan 7) ---
const EXPECT: Record<string, { price: number; dmg: number; pen: number; delay: number; mag: number; res: number; speed: number; reload: number }> = {
  negev: { price: 1700, dmg: 35, pen: 0.71, delay: 75, mag: 150, res: 300, speed: 3.0, reload: 5700 },
  m249: { price: 5200, dmg: 31, pen: 0.80, delay: 80, mag: 100, res: 200, speed: 3.9, reload: 5700 },
}
for (const id of NEW) {
  const w = WEAPONS[id]
  const e = EXPECT[id]
  check(`[${id}] exists, slot-1 heavy primary`, !!w && w.slot === 1 && w.category === 'heavy')
  check(`[${id}] exact CS:GO stats (price/dmg/pen/RPM/mag/speed/reload)`,
    w.price === e.price && w.damage === e.dmg && w.armorPen === e.pen &&
    w.fireDelay === e.delay && w.mag === e.mag && w.reserve === e.res &&
    w.moveSpeed === e.speed && w.reloadMs === e.reload,
    `$${w.price} ${w.damage}dmg pen ${w.armorPen} ${w.fireDelay}ms ${w.mag}/${w.reserve} ${w.moveSpeed}m/s ${w.reloadMs}ms`)
  check(`[${id}] auto trigger (plan 7: sustained fire)`, w.auto && fireModeOf(w) === 'auto')
  check(`[${id}] $300 kill reward (heavy class)`,
    w.killReward === 300 && w.killRewardClass === 'heavy' &&
    KILL_REWARD_BY_CLASS['heavy'] === w.killReward)
  check(`[${id}] both teams can buy (no team lock)`, w.team === undefined)
  check(`[${id}] slowest band of the roster (heavy moveSpeed penalty, plan 7)`,
    w.moveSpeed <= 3.9, `${w.moveSpeed} m/s`)
  check(`[${id}] single-ray ballistics (rides the classic 'hit' path, not 'pellets')`, pelletsOf(w) === 1)
}

// --- 2. the negev accuracy ramp (plan 7: "first bullets wild, settles") ---
{
  const n = WEAPONS.negev
  const m = WEAPONS.m249
  check('negev carries the Phase 7 accuracy ramp',
    accuracyRampOf(n)?.startSpread === 4.4 && accuracyRampOf(n)?.shots === 15,
    `start ${accuracyRampOf(n)?.startSpread}deg → settled ${n.accurate}deg over ${accuracyRampOf(n)?.shots} shots`)
  check('m249 has NO ramp (steadier platform, trades rate for accuracy)', accuracyRampOf(m) === null)
  check('every other weapon has no ramp (default stays null)',
    Object.values(WEAPONS).filter(w => accuracyRampOf(w) !== null).length === 1)
  // ramp lerp math (mirrors engine spreadDeg): cold → linear settle → laser
  const ramp = accuracyRampOf(n)!
  const spool = (k: number) => ramp.startSpread + (n.accurate - ramp.startSpread) * Math.min(k / ramp.shots, 1)
  check('ramp math: shot 0 sprays the full wild cone', Math.abs(spool(0) - 4.4) < 1e-9)
  check('ramp math: shot 7 is mid-spool', Math.abs(spool(7) - (4.4 + (0.10 - 4.4) * (7 / 15))) < 1e-9, `${spool(7).toFixed(2)}deg`)
  check('ramp math: shot 15 settles to laser accuracy', Math.abs(spool(15) - 0.10) < 1e-9)
  check('ramp math: counter past 15 clamps at settled', Math.abs(spool(150) - 0.10) < 1e-9)
  check('spooled negev is the most accurate automatic in the game',
    WEAPONS.negev.accurate < Math.min(WEAPONS.m4a1s.accurate, WEAPONS.aug.accurate), `${WEAPONS.negev.accurate}deg`)
  check('cold negev is wilder than an unscoped AWP cone minus margin',
    ramp.startSpread >= 4.4 && ramp.startSpread < 5.2)
  // kick fade formula (mirrors engine fireShot): 1 - 0.75*t
  const kickT = (k: number) => 1 - 0.75 * Math.min(k / ramp.shots, 1)
  check('kick fade: cold shot kicks full, shot 15 kicks 25%', Math.abs(kickT(0) - 1) < 1e-9 && Math.abs(kickT(15) - 0.25) < 1e-9)
}

// --- 3. damage math (single-ray, computeDamage) ---
{
  const n = WEAPONS.negev, m = WEAPONS.m249
  check('negev body @ 9.4m = 35 (no falloff step below 10m)',
    computeDamage(n, 'body', 9.4, 0, false).dmg === 35)
  check('negev unarmored head = 140 (35 x 4)', computeDamage(n, 'head', 5, 0, false).dmg === 140)
  check('negev armored body = 25 (35 x 0.71)', computeDamage(n, 'body', 5, 100, false).dmg === 25)
  check('m249 body @ 25.6m = 30 (31 x 0.98^2, two falloff steps)',
    computeDamage(m, 'body', 25.6, 0, false).dmg === 30,
    `${computeDamage(m, 'body', 25.6, 0, false).dmg}`)
  check('m249 armored body = 25 (31 x 0.80)', computeDamage(m, 'body', 5, 100, false).dmg === 25)
  check('negev falloff matches rifle family (0.98)', n.falloff10m === 0.98 && m.falloff10m === 0.98)
  // sustained kill economics: 3 body hits kill at close range (35x3=105)
  let hp = 100
  for (let i = 0; i < 3; i++) hp -= computeDamage(n, 'body', 9.4, 0, false).dmg
  check('negev 3-rd body burst kills an unarmored 100hp target', hp <= 0, `hp ${hp}`)
}

// --- 4. audio wiring: staged box samples exist + live preload now includes MGs ---
{
  for (const id of NEW) {
    const a = WEAPON_AUDIO[id]
    check(`[${id}] mapped in WEAPON_AUDIO with fire + distant + box reload trio`,
      !!a && !!a.fire && !!a.distant && !!a.out && !!a.in && !!a.rack,
      a ? `${a.fire}/${a.distant}/${a.out}/${a.in}/${a.rack}` : 'MISSING')
  }
  check('m249 has a draw sample', !!WEAPON_AUDIO.m249?.draw)
  const names = liveWeaponSoundFiles()
  for (const nm of ['negev_fire', 'negev_distant', 'negev_boxout', 'negev_boxin', 'negev_coverup',
    'm249_fire', 'm249_distant', 'm249_boxout', 'm249_boxin', 'm249_coverup', 'm249_draw']) {
    check(`live preload includes ${nm}`, names.includes(nm))
    check(`staged file exists: ${nm}.ogg`, existsSync(`${STAGED}/${nm}.ogg`))
  }
  check('future weapon ids left in the map: zero (full gun roster is live)',
    Object.keys(WEAPON_AUDIO).filter(id => !(id in WEAPONS)).length === 0)
}

// --- 5. viewmodels: MG family (plan 7.3 "belt/mag box on the rifle family") ---
{
  for (const id of NEW) {
    for (const team of ['CT', 'T'] as const) {
      const vm = buildViewModel(id, team)
      const meshes: THREE.Mesh[] = []
      vm.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) meshes.push(m) })
      check(`[${id}/${team}] viewmodel builds with substance`, meshes.length >= 14, `${meshes.length} meshes`)
      check(`[${id}/${team}] muzzle tip sits in front (long gun)`, vm.tip.z <= -0.55, `tip z ${vm.tip.z}`)
      // ammo box = mag group, drops on reload (NOT fixed like tube mags)
      check(`[${id}/${team}] box mag group present + drops on reload`,
        !!vm.mag && vm.mag.children.length >= 2 && !vm.mag.userData.fixed,
        `${vm.mag?.children.length} mag parts`)
      // no bolt/pump — full-auto guns eject without a rechamber cycle
      check(`[${id}/${team}] no bolt/pump groups (auto gun)`, !vm.bolt && !vm.pump)
      // the box hangs below the receiver: some mag mesh below y -0.08
      let boxLow = false
      vm.mag!.traverse(o => {
        const mm = o as THREE.Mesh
        if (mm.isMesh) { mm.updateWorldMatrix(true, false); if (mm.getWorldPosition(new THREE.Vector3()).y < -0.08) boxLow = true }
      })
      check(`[${id}/${team}] ammo box hangs under the receiver`, boxLow)
      check(`[${id}/${team}] eject port defined`, !!vm.eject)
    }
  }
  // family distinction: m249 is the LONGER gun, negev the chunkier shroud
  const m249 = buildViewModel('m249', 'CT')
  const negev = buildViewModel('negev', 'CT')
  check('m249 outranges the negev silhouette (longer barrel/SAAW)',
    m249.tip.z < negev.tip.z, `${m249.tip.z} vs ${negev.tip.z}`)
  // bipod: both MGs have the folded legs — thin cylinders under the shroud.
  // Count thin long cylinders near the muzzle line as the bipod proxy.
  const bipodish = (vm: ReturnType<typeof buildViewModel>) => {
    let found = 0
    vm.group.traverse(o => {
      const mm = o as THREE.Mesh
      if (!mm.isMesh) return
      const geo = mm.geometry as THREE.CylinderGeometry
      if (geo.type === 'CylinderGeometry' && geo.parameters.radiusTop <= 0.005 && geo.parameters.height >= 0.09) found++
    })
    return found
  }
  check('m249 shows folded bipod legs (2 thin cylinders)', bipodish(m249) === 2, `${bipodish(m249)} legs`)
  check('negev shows folded bipod legs (2 thin cylinders)', bipodish(negev) === 2, `${bipodish(negev)} legs`)
  // remote guns: witnesses see the MG silhouette
  for (const id of NEW) {
    const rg = buildRemoteGun(id)
    const cnt: THREE.Mesh[] = []
    rg.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) cnt.push(mm) })
    check(`[${id}] remote gun silhouette builds`, cnt.length >= 6, `${cnt.length} meshes`)
  }
}

// --- 6. buy menu: the heavy category goes live (CS 1.6 slot 5) ---
{
  const heavy = buyEntriesFor('heavy')
  check('heavy category: exactly negev + m249, negev first (cheap-first order)',
    JSON.stringify(heavy.map(e => e.id)) === JSON.stringify(['negev', 'm249']),
    heavy.map(e => `${e.id} $${e.price}`).join(', '))
  check('heavy category fits one menu page (<= 8 rows)', heavy.length <= 8)
  check('total roster = 43 weapons, 39 priced (37 guns + 6 grenades from Phase 8; knife/starters/c4 are free)',
    Object.values(WEAPONS).length === 43 && Object.values(WEAPONS).filter(w => w.price > 0).length === 39)
}

// --- 7. wiring source checks (engine spool + KICK + bots exclusion) ---
{
  const eng = readFileSync('/home/z/my-project/src/game/engine.ts', 'utf8')
  check('engine imports accuracyRampOf (ramp actually consumed)', eng.includes('accuracyRampOf'))
  check('engine tracks the sustained-shot counter', eng.includes('private sustained = 0'))
  check('engine spool resets on >400ms pause', eng.includes('now - prevShotAt > 400'))
  check('engine spool resets on weapon switch + round start',
    eng.includes('this.sustained = 0') && (eng.match(/this\.sustained = 0/g) ?? []).length >= 3)
  check('engine kick fades with the spool (1 - 0.75*t)', eng.includes('1 - 0.75 * spoolT'))
  check('KICK table covers both MGs', eng.includes('m249: 0.5, negev: 0.55'))
  check('__eng.state() exposes the spool for browser verification', eng.includes('sustained: this.sustained'))

  const bots = readFileSync('/home/z/my-project/mini-services/game-server/bots.ts', 'utf8')
  check('bots.ts NEVER references the MGs (plan 7.4: bots never buy MGs)',
    !bots.includes('m249') && !bots.includes('negev'))

  const srv = readFileSync('/home/z/my-project/mini-services/game-server/index.ts', 'utf8')
  check('server rate-gate documents the sustained-fire O(1) argument (plan 7.1)',
    srv.includes('Machine guns (plan 7.1'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
