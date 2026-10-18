// PHASE 6 test — shotguns x4: data sanity, pellet ballistics math, seeded fan
// determinism, audio wiring, viewmodels (pump/tube/box-mag), server anti-cheat
// wiring, bot rung. Run: bun scripts/test-phase6.ts
import './domstub'
import * as THREE from 'three'
import { WEAPONS, computeDamage, pelletsOf, pelletSpreadOf, KILL_REWARD_BY_CLASS, fireModeOf, WeaponId } from '../shared/weapons'
import { pelletDirs, angleDeg, mulberry32 } from '../shared/pellets'
import { WEAPON_AUDIO, liveWeaponSoundFiles } from '../shared/weapons-audio'
import { buildViewModel, buildRemoteGun } from '../src/game/weaponmodels'
import { existsSync, readFileSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const NEW: WeaponId[] = ['nova', 'xm1014', 'mag7', 'sawedoff']
const STAGED = '/home/z/my-project/public/staging/sounds'

// --- 1. data sanity (CS:GO fandom infobox values, plan 6.1/6.2) ---
const EXPECT: Record<string, { price: number; dmg: number; pellets: number; pen: number; delay: number; mag: number; res: number; speed: number }> = {
  nova: { price: 1050, dmg: 26, pellets: 9, pen: 0.50, delay: 880, mag: 8, res: 32, speed: 4.4 },
  xm1014: { price: 2000, dmg: 20, pellets: 8, pen: 0.80, delay: 350, mag: 7, res: 32, speed: 4.8 },
  mag7: { price: 1300, dmg: 30, pellets: 8, pen: 0.75, delay: 845, mag: 5, res: 32, speed: 4.8 },
  sawedoff: { price: 1100, dmg: 32, pellets: 8, pen: 0.75, delay: 845, mag: 7, res: 32, speed: 4.2 },
}
for (const id of NEW) {
  const w = WEAPONS[id]
  const e = EXPECT[id]
  check(`[${id}] exists, slot-1 shotgun`, !!w && w.slot === 1 && w.category === 'shotgun')
  check(`[${id}] exact CS:GO stats (price/dmg/pellets/pen/cycle/mag/speed)`,
    w.price === e.price && w.damage === e.dmg && w.pellets === e.pellets &&
    w.armorPen === e.pen && w.fireDelay === e.delay && w.mag === e.mag &&
    w.reserve === e.res && w.moveSpeed === e.speed,
    `$${w.price} ${w.damage}x${w.pellets} pen ${w.armorPen} ${w.fireDelay}ms ${w.mag}/${w.reserve} ${w.moveSpeed}m/s`)
  check(`[${id}] $900 kill reward (shotgun class)`,
    w.killReward === 900 && w.killRewardClass === 'shotgun' &&
    KILL_REWARD_BY_CLASS['shotgun'] === w.killReward)
  check(`[${id}] hard falloff (plan 6.2 close-range-only)`, w.falloff10m <= 0.70, `falloff10m ${w.falloff10m}`)
  check(`[${id}] reload is slower than firing (shell-by-shell)`, w.reloadMs > w.fireDelay * 2)
}
check('team locks: mag7 CT-only, sawedoff T-only, nova + xm1014 free for both',
  WEAPONS.mag7.team === 'CT' && WEAPONS.sawedoff.team === 'T' &&
  WEAPONS.nova.team === undefined && WEAPONS.xm1014.team === undefined)

// --- 2. mechanics schema ---
check('pump trio semi (nova/mag7/sawedoff); xm1014 auto per plan 6.2',
  fireModeOf(WEAPONS.nova) === 'semi' && fireModeOf(WEAPONS.mag7) === 'semi' &&
  fireModeOf(WEAPONS.sawedoff) === 'semi' && fireModeOf(WEAPONS.xm1014) === 'auto' &&
  WEAPONS.xm1014.auto === true && [WEAPONS.nova, WEAPONS.mag7, WEAPONS.sawedoff].every(w => w.auto === false))
check('xm1014 fires 2.5x faster than the pumps (171 vs 68 RPM class)',
  WEAPONS.nova.fireDelay / WEAPONS.xm1014.fireDelay > 2.4)
check('helpers: pelletsOf 9/8/8/8, single-ray guns resolve 1; spread 0 off-shotguns',
  pelletsOf(WEAPONS.nova) === 9 && pelletsOf(WEAPONS.xm1014) === 8 &&
  pelletsOf(WEAPONS.mag7) === 8 && pelletsOf(WEAPONS.sawedoff) === 8 &&
  pelletsOf(WEAPONS.ak47) === 1 && pelletsOf(WEAPONS.knife) === 1 &&
  pelletSpreadOf(WEAPONS.ak47) === 0 && pelletSpreadOf(WEAPONS.deagle) === 0)
check('cone ordering: mag7 tightest (3.6) < nova (4.2) < xm (4.8) < sawedoff (5.2)',
  pelletSpreadOf(WEAPONS.mag7) === 3.6 && pelletSpreadOf(WEAPONS.nova) === 4.2 &&
  pelletSpreadOf(WEAPONS.xm1014) === 4.8 && pelletSpreadOf(WEAPONS.sawedoff) === 5.2)

// --- 3. seeded pellet fan: determinism + geometry ---
{
  const aim = { x: 0, y: 0, z: -1 }
  const a = pelletDirs(12345, 9, 4.2, aim)
  const b = pelletDirs(12345, 9, 4.2, aim)
  check('pelletDirs is deterministic (same seed = identical fan)',
    JSON.stringify(a) === JSON.stringify(b))
  const c = pelletDirs(12346, 9, 4.2, aim)
  check('pelletDirs differs across seeds', JSON.stringify(a) !== JSON.stringify(c))
  check('pellet count honored', a.length === 9 && c.length === 9)
  check('pellet 0 rides the bore exactly (aim dir)',
    Math.abs(a[0].x - 0) < 1e-9 && Math.abs(a[0].y - 0) < 1e-9 && Math.abs(a[0].z + 1) < 1e-9)
  let allUnit = true, allInside = true, anyOutsideCore = false
  for (let i = 1; i < a.length; i++) {
    const l = Math.hypot(a[i].x, a[i].y, a[i].z)
    if (Math.abs(l - 1) > 1e-9) allUnit = false
    const ang = angleDeg(a[0], a[i])
    if (ang > 4.2 + 1e-6) allInside = false
    if (ang > 1.5) anyOutsideCore = true
  }
  check('all pellets are unit vectors', allUnit)
  check('all pellets inside the cone half-angle', allInside)
  check('fan actually spreads (pellets beyond 1.5° of bore)', anyOutsideCore)
  // sqrt radial distribution: about half the pellets land in the inner half
  // of the radius band (uniform-over-disc), not bunched at the rim
  let inner = 0
  for (let i = 1; i < a.length; i++) {
    const r = angleDeg(a[0], a[i]) / 4.2
    if (r < 0.5) inner++
  }
  check('radial distribution is disc-uniform (some pellets inner band)', inner >= 1, `${inner}/8 inner`)
  // non-axis aim: pellet 0 still exact, basis stays orthogonal
  const diag = pelletDirs(777, 8, 3.6, { x: 1, y: 1, z: 1 })
  const dl = Math.hypot(1, 1, 1)
  check('pellet 0 exact for non-axis aim (normalized)',
    Math.abs(diag[0].x - 1 / dl) < 1e-9 && Math.abs(diag[0].y - 1 / dl) < 1e-9)
  // mulberry32 sanity: deterministic + in-range
  const r1 = mulberry32(42), r2 = mulberry32(42)
  let same = true, inRange = true
  for (let i = 0; i < 100; i++) {
    const v = r1(), w = r2()
    if (v !== w) same = false
    if (v < 0 || v >= 1 || w < 0 || w >= 1) inRange = false
  }
  check('mulberry32 deterministic + [0,1) range', same && inRange)
}

// --- 4. per-pellet damage math (server authority semantics) ---
{
  // close-range unarmored: full pellet load is devastating
  const novaLoad = Array.from({ length: 9 }, () => computeDamage(WEAPONS.nova, 'body', 5, 0, false).dmg)
  check('nova close full load kills (9 body pellets >= 200 unarmored)',
    novaLoad.reduce((s, d) => s + d, 0) >= 200, `${novaLoad.join('+')} = ${novaLoad.reduce((s, d) => s + d, 0)}`)
  check('nova single unarmored head pellet at 5m is lethal (104 >= 100)',
    computeDamage(WEAPONS.nova, 'head', 5, 0, false).dmg >= 100)
  // mag7 armored: per-pellet armor interaction
  const p1 = computeDamage(WEAPONS.mag7, 'body', 5, 100, true)
  check('mag7 armored body pellet ~23 (30 x 0.75 armor pen)',
    p1.dmg >= 22 && p1.dmg <= 23, `dmg ${p1.dmg}`)
  check('mag7 armored pellet drains armor (~dmg/2)', p1.armorDmg >= 11 && p1.armorDmg <= 12, `armorDmg ${p1.armorDmg}`)
  // range: the close-range-only contract (plan 6.2)
  const near = computeDamage(WEAPONS.mag7, 'body', 5, 0, false).dmg
  const far = computeDamage(WEAPONS.mag7, 'body', 25, 0, false).dmg
  check('mag7 falloff: 25m pellet ~20% of 5m pellet (0.45^2)',
    far <= Math.ceil(near * 0.21), `${far} vs ${near}`)
  const farLoad = 8 * computeDamage(WEAPONS.sawedoff, 'body', 25, 0, false).dmg
  check('sawedoff 25m full load is NOT lethal (falloff discipline)',
    farLoad < 100, `8 x ${computeDamage(WEAPONS.sawedoff, 'body', 25, 0, false).dmg} = ${farLoad}`)
  // per-pellet armor drain semantics: armor 100 → pellets chew through it,
  // loop stops at death like the server's applyShotgunDamage (break on !alive)
  let armor = 100, hp = 100, totalDmg = 0
  for (let i = 0; i < 8 && hp > 0; i++) {
    const r = computeDamage(WEAPONS.mag7, 'body', 5, armor, armor > 0)
    armor = Math.max(0, armor - r.armorDmg)
    hp = Math.max(0, hp - r.dmg)
    totalDmg += r.dmg
  }
  check('mag7 pellets kill an armored victim (~5 pellets, armor drains 11/pellet)',
    hp === 0 && totalDmg >= 100 && armor >= 40 && armor <= 55,
    `hp ${hp} dmg ${totalDmg} armor ${armor}`)
  // leg mult applies per pellet
  check('leg pellet is 0.75x body pellet (sawedoff)',
    Math.abs(computeDamage(WEAPONS.sawedoff, 'legs', 5, 0, false).dmg - Math.round(32 * 0.75)) <= 1)
}

// --- 5. audio wiring ---
for (const id of NEW) {
  const a = WEAPON_AUDIO[id]
  check(`[${id}] audio map entry with fire/distant/out/in/rack`, !!a && !!a.fire && !!a.distant && !!a.out && !!a.in && !!a.rack)
  check(`[${id}] fire sample on disk (accepted or staged)`,
    existsSync(`/home/z/my-project/public/assets/sounds/${a!.fire}.ogg`) || existsSync(`${STAGED}/${a!.fire}.ogg`))
  check(`[${id}] pump/rack sample on disk (accepted or staged)`,
    existsSync(`/home/z/my-project/public/assets/sounds/${a!.rack}.ogg`) || existsSync(`${STAGED}/${a!.rack}.ogg`))
}
check('pump guns carry the post-shot bolt (pump) slot; xm1014 does not (gas-operated)',
  WEAPON_AUDIO.nova.bolt === 'nova_pump' && WEAPON_AUDIO.mag7.bolt === 'mag7_pump' &&
  WEAPON_AUDIO.sawedoff.bolt === 'sawedoff_pump' && WEAPON_AUDIO.xm1014.bolt === undefined)
{
  const preload = liveWeaponSoundFiles()
  for (const id of NEW) {
    for (const n of [WEAPON_AUDIO[id]!.fire, WEAPON_AUDIO[id]!.distant, WEAPON_AUDIO[id]!.rack, WEAPON_AUDIO[id]!.bolt].filter(Boolean) as string[]) {
      check(`[${id}] ${n} in preload (live weapon sounds load at start)`, preload.includes(n))
    }
  }
}

// --- 6. viewmodels ---
for (const id of NEW) {
  for (const team of ['CT', 'T'] as const) {
    let vm
    try { vm = buildViewModel(id, team) } catch (e) { check(`[${id}/${team}] viewmodel builds`, false, String(e)); continue }
    check(`[${id}/${team}] viewmodel builds with mag group + tip`,
      !!vm?.mag && !!vm?.tip && vm.tip.z < 0)
  }
}
{
  const nova = buildViewModel('nova', 'CT')
  const mag7 = buildViewModel('mag7', 'CT')
  const saw = buildViewModel('sawedoff', 'T')
  const xm = buildViewModel('xm1014', 'T')
  check('pump group present on nova/mag7/sawedoff with homeZ',
    !!nova.pump && nova.pump.userData.homeZ !== undefined &&
    !!mag7.pump && mag7.pump.userData.homeZ !== undefined &&
    !!saw.pump && saw.pump.userData.homeZ !== undefined)
  check('xm1014 has NO pump group (static handguard — semi-auto)',
    xm.pump === undefined)
  check('tube mags are fixed (shells load through the port); mag7 box mag animates',
    nova.mag!.userData.fixed === true && saw.mag!.userData.fixed === true &&
    xm.mag!.userData.fixed === true && mag7.mag!.userData.fixed === undefined)
  check('barrel lengths: nova longest, sawed-off is the cut-down',
    nova.tip.z < mag7.tip.z && nova.tip.z < xm.tip.z && saw.tip.z > mag7.tip.z,
    `nova ${nova.tip.z} xm ${xm.tip.z} mag7 ${mag7.tip.z} sawed ${saw.tip.z}`)
  check('mag7 box mag sits BELOW the bore (mesh y < 0 inside the group)',
    (mag7.mag!.children[0] as THREE.Mesh).position.y < 0)
  for (const id of NEW) {
    let rg
    try { rg = buildRemoteGun(id) } catch (e) { check(`[${id}] remote gun builds`, false, String(e)); continue }
    check(`[${id}] remote gun builds (${rg!.children.length} parts)`, (rg!.children.length ?? 0) >= 4)
  }
}

// --- 7. wiring (source checks) ---
{
  const engSrc = readFileSync('src/game/engine.ts', 'utf8')
  check('engine: fireShotgun pellet fan wired into tryFire',
    engSrc.includes('pelletsOf(w) > 1') && engSrc.includes('this.fireShotgun(w, dir)') &&
    engSrc.includes("emit('pellets'"))
  check('engine: KICK has all 4 shotguns (big kicks)',
    ['nova: 2.4', 'xm1014: 1.5', 'mag7: 2.6', 'sawedoff: 2.8'].every(s => engSrc.includes(s)))
  check('engine: pump anim on fire + pump cycle loop',
    engSrc.includes('this.pumpAt = now') && engSrc.includes('vm.pump') &&
    engSrc.includes('(now - this.pumpAt) / 520'))
  check('engine: remote fan rebuild from broadcast seed',
    engSrc.includes('typeof d.seed === \'number\'') && engSrc.includes('pelletDirs(d.seed'))
  check('engine: seed rides the shoot event', engSrc.includes('dir: [dir.x, dir.y, dir.z],\n      seed,'))
  check('engine: tube mags skip the drop-out reload anim',
    engSrc.includes('vm.mag.userData.fixed'))

  const srvSrc = readFileSync('mini-services/game-server/index.ts', 'utf8')
  check('server: shotgun damage exclusive via pellets event (hit path blocked)',
    srvSrc.includes('if (pelletsOf(w) > 1) return') && srvSrc.includes("socket.on('pellets'"))
  check('server: per-shot seed + aim dir stored on shoot',
    srvSrc.includes('p.shot = {') && srvSrc.includes('seed, dir: [d[0] / dl, d[1] / dl, d[2] / dl], at: t, claims: 0'))
  check('server: seed broadcast for remote fan rendering', srvSrc.includes('...(seed !== undefined ? { seed } : {})'))
  check('server: anti-cheat gates (freshness/budget/cone/LOS) present',
    srvSrc.includes('> 1500') && srvSrc.includes('pelletCount - shot.claims') &&
    srvSrc.includes('angleDeg(aim, to) > coneDeg'))
  check('server: per-pellet armor drain + aggregation + ONE hitConfirm',
    srvSrc.includes('function applyShotgunDamage') && srvSrc.includes('armorDmg > 0') &&
    srvSrc.includes('dmg: total'))
  check('server: killPlayer extracted (shared death bookkeeping)',
    srvSrc.includes('function killPlayer(m: Match, victim: PlayerState, attacker: PlayerState | null, weapon: WeaponId, hs: boolean)'))
  check('server: bots get the pellet damage path',
    // Phase 8 extended the bot context with botThrowGrenade — prefix-match so the
    // pellet wiring (applyShotgunDamage routed to bots) stays proven while later
    // phases can extend the context without breaking this check.
    srvSrc.includes('setBotContext({ applyDamage, applyShotgunDamage, hasLOS'))

  const botsSrc = readFileSync('mini-services/game-server/bots.ts', 'utf8')
  check('bots: shotgun rung in the ladder (force band + steal tiers + xm1014)',
    botsSrc.includes("buy('xm1014')") && botsSrc.includes("buy(p.team === 'T' ? 'sawedoff' : 'mag7')") &&
    botsSrc.includes("'sawedoff' : 'nova'"))
  check('bots: pellet decay model (K pellets falls with distance)',
    botsSrc.includes('1 - d / 28') && botsSrc.includes('applyShotgunDamage'))

  const hudSrc = readFileSync('src/game/hud.tsx', 'utf8')
  check('hud: WEAPON_SHORT has all 4 shotguns',
    ['nova: \'Nova\'', 'xm1014: \'XM1014\'', 'mag7: \'MAG-7\'', 'sawedoff: \'Sawed-Off\''].every(s => hudSrc.includes(s)))
  check('hud: buy-menu stat line shows per-pellet damage (26x9)',
    hudSrc.includes('×${st.w.pellets}'))

  const audioSrc = readFileSync('src/game/audio.ts', 'utf8')
  check('audio: post-shot bolt/pump mechanism consumes wa.bolt (awp-style)',
    audioSrc.includes('wa.bolt') && audioSrc.includes('setTimeout'))
}

// --- 8. angleDeg helper (server cone gate math) ---
{
  check('angleDeg: parallel = 0', angleDeg({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 5 }) < 1e-9)
  check('angleDeg: perpendicular = 90', Math.abs(angleDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }) - 90) < 1e-9)
  check('angleDeg: unnormalized inputs are fine', Math.abs(angleDeg({ x: 0, y: 0, z: 2 }, { x: 0, y: 3, z: 0 }) - 90) < 1e-9)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
