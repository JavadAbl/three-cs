// PHASE 4 test — SMGs x6: data sanity, audio wiring, viewmodels, wiring
// 1. every new SMG id exists in WEAPONS with plausible CS:GO-ish stats
// 2. audio: WEAPON_AUDIO entry per new id; every referenced sample exists on
//    disk (staged pack per policy v3 — Phase 9 accepts them); fire samples
//    are preloaded now that the weapons are live
// 3. viewmodels: buildViewModel + buildRemoteGun build real geometry for all
//    6 (both teams); every SMG carries a mag group (engine reload anim);
//    P90's mag sits ON TOP, Bizon's under the barrel
// 4. wiring: engine KICK + hud WEAPON_SHORT cover the new ids, server needs
//    no new guards (data-driven), bots' mid-economy branch references the
//    team-flavored SMGs
import './domstub'
import * as THREE from 'three'
import { WEAPONS, computeDamage, WeaponId } from '../shared/weapons'
import { WEAPON_AUDIO, weaponAudioNames, liveWeaponSoundFiles } from '../shared/weapons-audio'
import { buildViewModel, buildRemoteGun } from '../src/game/weaponmodels'
import { existsSync, readFileSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const NEW: WeaponId[] = ['mp9', 'mac10', 'mp7', 'ump45', 'p90', 'bizon']

// --- 1. data sanity ---
for (const id of NEW) {
  const w = WEAPONS[id]
  check(`[${id}] exists with stats`, !!w && w.slot === 1 && w.category === 'smg' && w.name.length > 0)
  check(`[${id}] plausible numbers`,
    w.price >= 1250 && w.price <= 2350 &&
    w.damage >= 25 && w.damage <= 36 &&
    w.armorPen > 0.5 && w.armorPen <= 0.7 &&
    w.falloff10m >= 0.7 && w.falloff10m <= 0.86 &&
    w.fireDelay >= 65 && w.fireDelay <= 95 &&
    w.mag >= 25 && w.mag <= 64 && w.reloadMs >= 2000 && w.reloadMs <= 3600 &&
    w.moveSpeed >= 4.5 && w.moveSpeed <= 4.9,
    `price ${w.price} dmg ${w.damage} delay ${w.fireDelay} mag ${w.mag}`)
  check(`[${id}] auto + $600 kill reward class`,
    w.auto === true && w.fireMode === 'auto' && w.killReward === 600 && w.killRewardClass === 'smg')
  check(`[${id}] moves faster than a rifle (CS SMG speed scale)`,
    w.moveSpeed > WEAPONS.ak47.moveSpeed && w.moveSpeed <= 4.9)
}

// --- 2. audio wiring ---
const live = liveWeaponSoundFiles()
for (const id of NEW) {
  const a = WEAPON_AUDIO[id]
  check(`[${id}] has a WEAPON_AUDIO entry`, !!a)
  if (!a) continue
  const names = weaponAudioNames(a)
  check(`[${id}] fire sample present and live-preloaded`,
    !!a.fire && live.includes(a.fire), `${a.fire ?? '(none)'}`)
  for (const n of names) {
    const onDisk = existsSync(`public/assets/sounds/${n}.ogg`) || existsSync(`public/staging/sounds/${n}.ogg`)
    check(`[${id}] sample on disk: ${n}.ogg`, onDisk)
  }
}

// --- 3. viewmodels ---
for (const id of NEW) {
  for (const team of ['CT', 'T'] as const) {
    const vm = buildViewModel(id, team)
    const meshes: THREE.Mesh[] = []
    vm.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
    check(`[${id}/${team}] viewmodel builds (${meshes.length} meshes)`,
      meshes.length >= 10 && vm.tip.z < -0.15)
    check(`[${id}/${team}] carries a mag group (engine reload anim needs it)`, !!vm.mag)
  }
  const rg = buildRemoteGun(id)
  const rmeshes: THREE.Mesh[] = []
  rg.traverse(o => { if ((o as THREE.Mesh).isMesh) rmeshes.push(o as THREE.Mesh) })
  check(`[${id}] remote gun builds (${rmeshes.length} meshes)`, rmeshes.length >= 3)
}
// P90's magazine sits on top of the shell (mag children above y 0)
const p90 = buildViewModel('p90', 'CT')
let p90Top = 0
p90.mag!.traverse(o => { if ((o as THREE.Mesh).isMesh && o.position.y > p90Top) p90Top = o.position.y })
check('P90 magazine sits ON TOP (bullpup top-loading mag)', p90Top > 0.04, `top mag y=${p90Top.toFixed(3)}`)
// Bizon's helical drum is the under-barrel cylinder: mag children BELOW y 0,
// and the drum is a cylinder mesh
const bizon = buildViewModel('bizon', 'T')
let drum: THREE.Mesh | null = null
bizon.mag!.traverse(o => {
  const m = o as THREE.Mesh
  if (m.isMesh && (m.geometry as THREE.CylinderGeometry).parameters?.radiusTop === 0.027) drum = m
})
const drumM = drum as THREE.Mesh | null   // cast: assignment happens inside the closure
check('Bizon mag is the under-barrel helical drum (cylinder, below the bore)', !!drumM && drumM.position.y < 0)
// magwell placement sanity: ump45's mag is ahead of the trigger (front), the
// compact trio's mags are inside the grip (grip)
const umpVM = buildViewModel('ump45', 'CT')
let umpMagZ = 0
umpVM.mag!.traverse(o => { if ((o as THREE.Mesh).isMesh && o.position.z < umpMagZ) umpMagZ = o.position.z })
check('UMP-45 magazine is ahead of the grip (front well)', umpMagZ < -0.1, `front z=${umpMagZ.toFixed(3)}`)

// --- 4. wiring ---
const engineSrc = readFileSync('src/game/engine.ts', 'utf8')
const kickBlock = /const KICK[^}]+}/.exec(engineSrc)?.[0] ?? ''
for (const id of NEW) {
  check(`KICK[${id}] defined in engine`, kickBlock.includes(`${id}:`))
}
const hudSrc = readFileSync('src/game/hud.tsx', 'utf8')
for (const id of NEW) {
  check(`WEAPON_SHORT[${id}] defined in hud`, hudSrc.includes(`${id}: '`))
}
const vmSrc = readFileSync('src/game/weaponmodels.ts', 'utf8')
check('dispatcher routes the 6 SMGs',
  vmSrc.includes(`case 'mp9': case 'mac10': case 'mp7': case 'ump45':`) &&
  vmSrc.includes(`case 'p90': return buildP90(team)`) && vmSrc.includes(`case 'bizon': return buildBizon(team)`))
const botsSrc = readFileSync('mini-services/game-server/bots.ts', 'utf8')
check('bot mid-economy branch covers the new SMGs (no single-mp5 fallback)',
  botsSrc.includes(`buy('p90')`) && botsSrc.includes(`buy('mp7')`) && botsSrc.includes(`buy('ump45')`) &&
  botsSrc.includes(`buy('bizon')`) && !/p\.money >= 1500\) \{ buy\('mp5'\)/.test(botsSrc))
check('bot team flavor: mac-10 T / mp9 CT at the $1250 step',
  botsSrc.includes(`p.team === 'T' ? 'mac10' : 'mp9'`))

// --- 5. damage sanity on the new roster ---
check('UMP-45 punches armor harder than MP9 (armor-pen quirk)',
  computeDamage(WEAPONS.ump45, 'body', 5, 100, true).dmg > computeDamage(WEAPONS.mp9, 'body', 5, 100, true).dmg)
check('UMP-45 falls off harder at range (short-reach quirk)',
  computeDamage(WEAPONS.ump45, 'body', 30, 0, false).dmg / computeDamage(WEAPONS.ump45, 'body', 5, 0, false).dmg <
  computeDamage(WEAPONS.mp9, 'body', 30, 0, false).dmg / computeDamage(WEAPONS.mp9, 'body', 5, 0, false).dmg)
check('SMGs cannot one-shot an armored+helmet head (rifle territory)',
  NEW.every(id => computeDamage(WEAPONS[id], 'head', 5, 100, true).dmg < 100))
check('every SMG still one-shots an unarmored head at close range',
  NEW.every(id => computeDamage(WEAPONS[id], 'head', 5, 0, false).dmg >= 100))
check('SMG kill rewards double rifle rewards ($600 vs $300)',
  NEW.every(id => WEAPONS[id].killReward === 600 && WEAPONS[id].killReward > WEAPONS.ak47.killReward))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
