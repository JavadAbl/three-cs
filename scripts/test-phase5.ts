// PHASE 5 test — rifles x8: data sanity, mechanics schema, audio wiring,
// viewmodels, wiring (engine/scope/burst/suppressed/paging/server/bots)
import './domstub'
import * as THREE from 'three'
import { WEAPONS, computeDamage, fireModeOf, scopeLevelsOf, zoomFovOf, KILL_REWARD_BY_CLASS, WeaponId } from '../shared/weapons'
import { WEAPON_AUDIO, weaponAudioNames, liveWeaponSoundFiles } from '../shared/weapons-audio'
import { buildViewModel, buildRemoteGun } from '../src/game/weaponmodels'
import { existsSync, readFileSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const NEW: WeaponId[] = ['m4a1s', 'galil', 'famas', 'sg553', 'aug', 'ssg08', 'scar20', 'g3sg1']

// --- 1. data sanity ---
for (const id of NEW) {
  const w = WEAPONS[id]
  check(`[${id}] exists with stats`, !!w && w.slot === 1 && w.category === 'rifle' && w.name.length > 0)
  check(`[${id}] plausible numbers`,
    w.price >= 1700 && w.price <= 5000 &&
    w.damage >= 28 && w.damage <= 88 &&
    w.armorPen > 0.65 && w.armorPen <= 1 &&
    w.falloff10m >= 0.97 && w.falloff10m <= 1 &&
    w.fireDelay >= 90 && w.fireDelay <= 1300 &&
    w.mag >= 10 && w.mag <= 35 && w.reloadMs >= 2800 && w.reloadMs <= 4800 &&
    w.moveSpeed >= 4.2 && w.moveSpeed <= 4.9,
    `price ${w.price} dmg ${w.damage} delay ${w.fireDelay} mag ${w.mag} speed ${w.moveSpeed}`)
  check(`[${id}] rifle $300 kill reward (snipers $100, scout $300)`,
    (id === 'ssg08' ? w.killReward === 300 : ['scar20', 'g3sg1'].includes(id) ? w.killReward === 100 : w.killReward === 300) &&
    !!w.killRewardClass && KILL_REWARD_BY_CLASS[w.killRewardClass] === w.killReward)
  check(`[${id}] rifle speed scale (≤ 240-class, slower than knife)`,
    w.moveSpeed <= 4.8 && w.moveSpeed < WEAPONS.knife.moveSpeed, `speed ${w.moveSpeed}`)
}

// --- 2. mechanics schema ---
const famas = WEAPONS.famas
check('famas is the 3-round burst gun (schema)',
  famas.fireMode === 'burst' && famas.burstRounds === 3 && famas.burstDelayMs === 75 &&
  famas.fireDelay === 400 && famas.auto === false && fireModeOf(famas) === 'burst')
check('famas is the ONLY burst weapon',
  Object.values(WEAPONS).every(w => w.id === 'famas' ? w.fireMode === 'burst' : w.fireMode !== 'burst'))
check('scoped rifles: sg553/aug 1 level + zoomFov 25',
  scopeLevelsOf(WEAPONS.sg553) === 1 && zoomFovOf(WEAPONS.sg553) === 25 &&
  scopeLevelsOf(WEAPONS.aug) === 1 && zoomFovOf(WEAPONS.aug) === 25)
check('snipers: ssg08/scar20/g3sg1/awp 2 levels + zoomFov 16',
  ['ssg08', 'scar20', 'g3sg1', 'awp'].every(id => scopeLevelsOf(WEAPONS[id as WeaponId]) === 2 && zoomFovOf(WEAPONS[id as WeaponId]) === 16))
check('suppressed set: usp + mp5 + m4a1s (and only those)',
  WEAPONS.m4a1s.suppressed === true &&
  Object.values(WEAPONS).filter(w => w.suppressed).map(w => w.id).sort().join(',') === 'm4a1s,mp5,usp')
check('team locks: galil/sg553/g3sg1 T, m4a1s/famas/aug/scar20 CT, ssg08 free',
  WEAPONS.galil.team === 'T' && WEAPONS.sg553.team === 'T' && WEAPONS.g3sg1.team === 'T' &&
  WEAPONS.m4a1s.team === 'CT' && WEAPONS.famas.team === 'CT' && WEAPONS.aug.team === 'CT' && WEAPONS.scar20.team === 'CT' &&
  WEAPONS.ssg08.team === undefined)
check('auto-snipers are auto; ssg08 is semi (bolt-action)',
  WEAPONS.scar20.auto === true && WEAPONS.g3sg1.auto === true && WEAPONS.ssg08.auto === false)
check('m4a1s pairs with m4 (both CT slot-1: owning one replaces the other)',
  WEAPONS.m4a1s.slot === 1 && WEAPONS.m4.slot === 1 && WEAPONS.m4a1s.team === WEAPONS.m4.team)

// --- 3. audio wiring ---
const live = liveWeaponSoundFiles()
for (const id of NEW) {
  const a = WEAPON_AUDIO[id]
  check(`[${id}] has a WEAPON_AUDIO entry`, !!a)
  if (!a) continue
  const names = weaponAudioNames(a)
  check(`[${id}] fire sample present and live-preloaded`, !!a.fire && live.includes(a.fire), `${a.fire ?? '(none)'}`)
  for (const n of names) {
    const onDisk = existsSync(`public/assets/sounds/${n}.ogg`) || existsSync(`public/staging/sounds/${n}.ogg`)
    check(`[${id}] sample on disk: ${n}.ogg`, onDisk)
  }
}

// --- 4. viewmodels ---
for (const id of NEW) {
  for (const team of ['CT', 'T'] as const) {
    const vm = buildViewModel(id, team)
    const meshes: THREE.Mesh[] = []
    vm.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
    check(`[${id}/${team}] viewmodel builds (${meshes.length} meshes)`, meshes.length >= 10 && vm.tip.z < -0.3)
    check(`[${id}/${team}] carries a mag group`, !!vm.mag)
  }
  const rg = buildRemoteGun(id)
  const rmeshes: THREE.Mesh[] = []
  rg.traverse(o => { if ((o as THREE.Mesh).isMesh) rmeshes.push(o as THREE.Mesh) })
  check(`[${id}] remote gun builds (${rmeshes.length} meshes)`, rmeshes.length >= 4)
}
// ssg08 has the bolt group (bolt-action anim); auto-snipers don't
const ssg = buildViewModel('ssg08', 'CT')
check('ssg08 carries the bolt assembly (bolt-action cycle anim)', !!ssg.bolt)
const scarVM = buildViewModel('scar20', 'CT')
const g3VM = buildViewModel('g3sg1', 'T')
check('auto-snipers carry NO bolt group (semi-auto: no cycle anim)',
  !scarVM.bolt && !g3VM.bolt)
// m4a1s: fat suppressor cylinder beyond the muzzle — a cylinder mesh with
// radius 0.0165 near the tip
const m4a1sVM = buildViewModel('m4a1s', 'CT')
let canR = 0
m4a1sVM.group.traverse(o => {
  const m = o as THREE.Mesh
  const c = m.geometry as THREE.CylinderGeometry
  if (m.isMesh && c.parameters?.radiusTop === 0.0165) canR = Math.max(canR, c.parameters.height)
})
check('m4a1s viewmodel carries the fat suppressor can (0.15 cylinder)', canR >= 0.15, `can len ${canR.toFixed(3)}`)
// scoped models have glass lenses (basic-material dark discs)
const augVM = buildViewModel('aug', 'CT')
let lensFound = false
augVM.group.traverse(o => {
  const m = o as THREE.Mesh
  if (m.isMesh && (m.material as THREE.MeshBasicMaterial)?.isMeshBasicMaterial) lensFound = true
})
check('aug viewmodel has the integrated optic lens', lensFound)

// --- 5. wiring ---
const engineSrc = readFileSync('src/game/engine.ts', 'utf8')
const kickBlock = /const KICK[^}]+}/.exec(engineSrc)?.[0] ?? ''
for (const id of NEW) check(`KICK[${id}] defined in engine`, kickBlock.includes(`${id}:`))
check('engine cycles multi-level scopes (setScopeLevel + scopeLevel field)',
  engineSrc.includes('setScopeLevel') && engineSrc.includes('scopeLevel') &&
  engineSrc.includes('scopeLevelsOf(w) + 1'))
check('engine sens scales with scoped FOV',
  engineSrc.includes('this.camera.fov / this.opts.fov'))
check('engine burst queue + retrigger gate present',
  engineSrc.includes('burstRemaining') && engineSrc.includes('burstDelayMs'))
check('engine suppressed: no tracer + small flash (own + remote paths)',
  /if \(!w\.suppressed\) this\.fx\.tracer/.test(engineSrc) &&
  /muzzleFlash\(muzzle, !!w\.suppressed\)/.test(engineSrc) &&
  /if \(!sup\) this\.fx\.tracer/.test(engineSrc))
check('auto scoped guns stay scoped while firing (only semi unscopes)',
  engineSrc.includes('this.scoped && !w.auto'))
const fxSrc = readFileSync('src/game/fx.ts', 'utf8')
check('fx.muzzleFlash has the suppressed small mode', fxSrc.includes('muzzleFlash(at: THREE.Vector3, small = false)'))
const audioSrc = readFileSync('src/game/audio.ts', 'utf8')
check('audio skips the distant crack + quiets suppressed guns',
  audioSrc.includes('wa.distant && !sup') && audioSrc.includes('sup ? 0.55 : 1'))
const serverSrc = readFileSync('mini-services/game-server/index.ts', 'utf8')
check('server validates burst cadence + burst cap (anti-cheat)',
  serverSrc.includes(`fireModeOf(w) === 'burst'`) && serverSrc.includes('burstShots') &&
  serverSrc.includes('burstDelayMs ?? 75') && serverSrc.includes('burstRounds ?? 3'))
check('PlayerState carries burstShots',
  readFileSync('mini-services/game-server/types.ts', 'utf8').includes('burstShots: number'))
const hudSrc = readFileSync('src/game/hud.tsx', 'utf8')
for (const id of NEW) check(`WEAPON_SHORT[${id}] defined in hud`, hudSrc.includes(`${id}: '`))
check('buy menu pages categories over 8 entries (1.6-style NEXT)',
  hudSrc.includes('const PAGE = 8') && hudSrc.includes('setPage(page + 1)') && hudSrc.includes('page * PAGE + n - 1'))
const vmSrc = readFileSync('src/game/weaponmodels.ts', 'utf8')
check('dispatcher routes the 8 new rifles/snipers',
  vmSrc.includes(`case 'galil': case 'famas': case 'sg553': case 'aug': case 'm4a1s':`) &&
  vmSrc.includes(`case 'ssg08': case 'scar20': case 'g3sg1':`))
const botsSrc = readFileSync('mini-services/game-server/bots.ts', 'utf8')
check('bot ladder: budget rifles + scoped rolls + auto-sniper + m4a1s catch-up',
  botsSrc.includes(`'galil'`) && botsSrc.includes(`budgetRifle`) && botsSrc.includes(`'famas'`) &&
  botsSrc.includes(`buy('ssg08')`) && botsSrc.includes(`buy('sg553')`) && botsSrc.includes(`buy('aug')`) &&
  botsSrc.includes(`buy('m4a1s')`) && /g3sg1.*scar20|scar20.*g3sg1/.test(botsSrc))

// --- 6. damage sanity (the CS quirks) ---
check('sg553 one-taps a helmeted head at 30m (100% armor pen quirk)',
  computeDamage(WEAPONS.sg553, 'head', 30, 100, true).dmg >= 100)
check('ak47 also one-taps helmeted heads; m4 does NOT',
  computeDamage(WEAPONS.ak47, 'head', 5, 100, true).dmg >= 100 &&
  computeDamage(WEAPONS.m4, 'head', 5, 100, true).dmg < 100)
check('m4a1s one-taps a helmeted head (its famous quirk)',
  computeDamage(WEAPONS.m4a1s, 'head', 5, 100, true).dmg >= 100)
check('ssg08 body shot does not one-shot armor, but headshots kill',
  computeDamage(WEAPONS.ssg08, 'body', 5, 100, true).dmg < 100 &&
  computeDamage(WEAPONS.ssg08, 'head', 5, 100, true).dmg >= 100)
check('auto-snipers kill armored victims in 2 body shots',
  computeDamage(WEAPONS.scar20, 'body', 5, 100, true).dmg * 2 >= 100 &&
  computeDamage(WEAPONS.g3sg1, 'body', 5, 100, true).dmg * 2 >= 100)
check('budget rifles are cheaper than team rifles',
  WEAPONS.galil.price < WEAPONS.ak47.price && WEAPONS.famas.price < WEAPONS.m4.price)
check('every new rifle one-shots an unarmored head at close range',
  NEW.every(id => computeDamage(WEAPONS[id], 'head', 5, 0, false).dmg >= 100))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
