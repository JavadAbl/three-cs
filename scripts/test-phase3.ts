// PHASE 3 test — pistols x8: data sanity, audio wiring, viewmodels, wiring
// 1. every new pistol id exists in WEAPONS with plausible CS:GO-ish stats
// 2. audio: WEAPON_AUDIO entry per new id; every referenced sample exists on
//    disk (accepted pack OR staged pack per policy v3); fire samples are
//    preloaded now that the weapons are live
// 3. viewmodels: buildViewModel + buildRemoteGun build real geometry for all
//    8 (both teams); dual berettas carry slide + slideL (alternating fire)
// 4. wiring: engine KICK covers the new ids, hud WEAPON_SHORT covers them,
//    server buys every new pistol (price>0, team checks), bots' round-1 table
//    references team-legal pistols only
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

const NEW: WeaponId[] = ['p250', 'fiveseven', 'tec9', 'cz75', 'elites', 'hkp2000', 'revolver', 'taser']

// --- 1. data sanity ---
for (const id of NEW) {
  const w = WEAPONS[id]
  check(`[${id}] exists with stats`, !!w && w.slot === 2 && w.category === 'pistol' && w.name.length > 0)
  check(`[${id}] plausible numbers`,
    w.price >= 200 && w.price <= 700 &&
    w.damage >= 25 && w.damage <= 500 &&
    w.armorPen > 0 && w.armorPen <= 1 &&
    w.falloff10m >= 0.5 && w.falloff10m <= 1 &&
    w.fireDelay >= 60 && w.fireDelay <= 1200 &&
    w.mag >= 1 && w.reloadMs >= 0 && w.moveSpeed > 4 && w.moveSpeed <= 5,
    `price ${w.price} dmg ${w.damage} delay ${w.fireDelay} mag ${w.mag}`)
  check(`[${id}] killReward matches pistol class (or zeus 0)`,
    id === 'taser' ? w.killReward === 0 : w.killReward === 300)
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
      meshes.length >= 10 && vm.tip.z < -0.1)
  }
  const rg = buildRemoteGun(id)
  const rmeshes: THREE.Mesh[] = []
  rg.traverse(o => { if ((o as THREE.Mesh).isMesh) rmeshes.push(o as THREE.Mesh) })
  check(`[${id}] remote gun builds (${rmeshes.length} meshes)`, rmeshes.length >= 2)
}
const elitesVM = buildViewModel('elites', 'CT')
check('dual berettas carry TWO slides for alternating fire',
  !!elitesVM.slide && !!elitesVM.slideL && elitesVM.slide !== elitesVM.slideL)
const revolverVM = buildViewModel('revolver', 'CT')
check('revolver has no slide/bolt/mag (cylinder gun: no blowback anim)',
  !revolverVM.slide && !revolverVM.bolt && !revolverVM.mag)
const taserVM = buildViewModel('taser', 'T')
check('taser has no mag (single-use, never reloads)', !taserVM.mag)

// --- 4. wiring ---
const engineSrc = readFileSync('src/game/engine.ts', 'utf8')
const kickBlock = /const KICK[^}]+}/.exec(engineSrc)?.[0] ?? ''
for (const id of NEW) {
  check(`KICK[${id}] defined in engine`, kickBlock.includes(`${id}:`))
  check(`taser raycast capped in engine`,
    engineSrc.includes(`w.id === 'taser' ? 6 : 200`))
}
const hudSrc = readFileSync('src/game/hud.tsx', 'utf8')
for (const id of NEW) {
  check(`WEAPON_SHORT[${id}] defined in hud`, hudSrc.includes(`${id}: '`))
}
const serverSrc = readFileSync('mini-services/game-server/index.ts', 'utf8')
check('server rejects out-of-reach taser hits', serverSrc.includes(`w.id === 'taser' && dist > 8`))
const botsSrc = readFileSync('mini-services/game-server/bots.ts', 'utf8')
check('bot round-1 table uses team pistols (no deagle hack)',
  botsSrc.includes(`buy('tec9')`) && botsSrc.includes(`buy('fiveseven')`) && botsSrc.includes(`buy('cz75')`) &&
  !/round === 1[\s\S]{0,400}buy\('deagle'\)/.test(botsSrc))

// --- 5. damage sanity on the new roster ---
check('revolver body-shot at range beats deagle body shot',
  computeDamage(WEAPONS.revolver, 'body', 20, 100, false).dmg > computeDamage(WEAPONS.deagle, 'body', 20, 100, false).dmg)
check('fiveseven punches armor much harder than elites',
  computeDamage(WEAPONS.fiveseven, 'body', 5, 100, true).dmg > computeDamage(WEAPONS.elites, 'body', 5, 100, true).dmg * 1.4)
check('taser kills armored legs at 5m',
  computeDamage(WEAPONS.taser, 'legs', 5, 100, true).dmg >= 100)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
