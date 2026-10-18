// PHASE 8 test — grenades & equipment (unit level)
// 1. shared/grenades.ts math: HE radial damage (exact values + armor + wall
//    gating is server-side), flash blind table (distance × facing × radius),
//    smoke segment blocking, physics determinism + bounce/rest/settle,
//    molotov ground-contact ignition events
// 2. viewmodels: buildGrenade for all 6 kinds (bodies + pin group + gloves),
//    vmBase offset, remote-gun variants render distinct bodies
// 3. engine + server wiring source checks (throw emit, Digit5 cycling, nade
//    handlers, smoke-in-LOS, defuse kit halving, bot blind gate + throw ctx)
// 4. audio: every live grenade sound name is staged on disk and in FILES
import './domstub'
import { readFileSync } from 'fs'
import * as shared from '../shared/weapons'
import { NADE, heDamage, flashBlindMs, viewDirFromYawPitch, segDist, smokeBlocksSeg, stepNade, toNadeBoxes } from '../shared/grenades'
import type { NadeEnt, NadeBox } from '../shared/grenades'
import { liveGrenadeSoundFiles } from '../shared/weapons-audio'
import * as THREE from 'three'
import { buildViewModel, buildRemoteGun, vmBase } from '../src/game/weaponmodels'
import { existsSync } from 'node:fs'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const W = shared.WEAPONS

// ============================================================ 1. HE math
check('heDamage(0, no armor) = 98 (table value)',
  heDamage(0, false, W.he) === 98)
check('heDamage(0, armor) = 49 (armorPen 0.5)',
  heDamage(0, true, W.he) === 49)
check('heDamage(6, no armor) = 22 — mid-range falloff exact',
  heDamage(6, false, W.he) === 22)
check('heDamage(6, armor) = 11',
  heDamage(6, true, W.he) === 11)
check('heDamage(≥ radius) = 0',
  heDamage(9, false, W.he) === 0 && heDamage(15, false, W.he) === 0)
check('heDamage monotone non-increasing',
  [0, 1, 2, 4, 6, 8].every((d, i, a) => i === 0 || heDamage(d, false, W.he) <= heDamage(a[i - 1], false, W.he)))
check('HE never one-shots from full HP unarmored (CS realism — softens only)',
  heDamage(0, false, W.he) < 100)
check('default heDamage matches table-driven form',
  heDamage(6, false) === heDamage(6, false, W.he))

// ============================================================ 2. flash math
check('flashBlindMs(2m, staring) ≈ 4793ms — point-blank direct stare',
  Math.abs(flashBlindMs(2, 1) - 4793) < 30, `${flashBlindMs(2, 1)}ms`)
check('flashBlindMs(2m, looking away) ≈ 1678ms — peripheral floor 35%',
  Math.abs(flashBlindMs(2, -1) - 1678) < 30, `${flashBlindMs(2, -1)}ms`)
check('facing factor monotone: away < sideways < at',
  flashBlindMs(10, -1) < flashBlindMs(10, 0) && flashBlindMs(10, 0) < flashBlindMs(10, 1))
check('flashBlindMs(radius edge) = 0',
  flashBlindMs(NADE.flashRadius, 1) === 0 && flashBlindMs(NADE.flashRadius + 5, 1) === 0)
check('direct stare at 14m still blinds > 1.5s (CS:GO feel)',
  flashBlindMs(14, 1) > 1500, `${flashBlindMs(14, 1)}ms`)
check('viewDirFromYawPitch matches the camera math (yaw 0 → -z, pitch up → +y)',
  (() => {
    const v0 = viewDirFromYawPitch(0, 0)
    if (Math.abs(v0.z + 1) > 1e-9 || Math.abs(v0.x) > 1e-9) return false
    const up = viewDirFromYawPitch(0, 0.5)
    return up.y > 0.45 && up.z < 0
  })())

// ============================================================ 3. smoke blocking
check('segDist: point on the segment = 0',
  segDist(0, 0, 0, 10, 0, 0, 5, 0, 0) < 1e-9)
check('segDist: perpendicular offset measured exactly',
  Math.abs(segDist(0, 0, 0, 10, 0, 0, 5, 3, 0) - 3) < 1e-9)
check('segDist: clamps to endpoints (nearest segment point)',
  Math.abs(segDist(0, 0, 0, 10, 0, 0, 15, 0, 0) - 5) < 1e-9)
check('smokeBlocksSeg: segment through the core is blocked',
  smokeBlocksSeg(-20, 1.5, 0, 20, 1.5, 0, { x: 0, y: 1.5, z: 0 }))
check('smokeBlocksSeg: segment outside the core passes',
  !smokeBlocksSeg(-20, 1.5, 0, 20, 1.5, 0, { x: 0, y: 1.5, z: 10 }))
check('smokeBlocksSeg: grazing the shell edge (between core and visual radius) passes',
  !smokeBlocksSeg(-20, 1.5, 0, 20, 1.5, 0, { x: 0, y: 1.5, z: NADE.smokeCoreR + 0.5 }))

// ============================================================ 4. physics
const FLAT: NadeBox[] = toNadeBoxes([{ x: 0, y: -0.25, z: 0, w: 200, h: 0.5, d: 200 }])
const BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }
const mk = (vx: number, vy: number, vz = 0): NadeEnt => {
  // block body (not `=> ({...})`): a parenthesized object-literal arrow body
  // directly followed by a statement-level block `{` trips the tsc 5.9
  // cover-grammar reparse (TS1003/TS1005 cascade) — bun tolerates it, tsc
  // doesn't; this is the only such construct in the file.
  return { id: 1, kind: 'he', weapon: 'he', owner: 'x', x: 0, y: 1.6, z: 0, vx, vy, vz, bornAt: 0, restAt: null, bounces: 0 }
}

// determinism: two identical entities step identically
{
  const a = mk(12, 9), b = mk(12, 9)
  for (let i = 0; i < 120; i++) { stepNade(a, 0.05, FLAT, BOUNDS); stepNade(b, 0.05, FLAT, BOUNDS) }
  check('stepNade deterministic across 120 ticks (bit-identical)',
    JSON.stringify([a.x, a.y, a.z, a.vx, a.vy, a.bounces]) === JSON.stringify([b.x, b.y, b.z, b.vx, b.vy, b.bounces]))
}

// full throw range: 45° full power lands 26-33m (CS-like, tuned by friction)
{
  const n = mk(15.6, 15.6)
  let rest: number | null = null
  for (let i = 0; i < 400; i++) {
    if (stepNade(n, 0.05, FLAT, BOUNDS).some(e => e.kind === 'rest')) { rest = i; n.restAt = i; break }
  }
  check('45° full throw travels 26-33m and rests (friction-tuned)',
    rest !== null && n.x > 26 && n.x < 33, rest ? `${n.x.toFixed(1)}m, rest @${rest}` : 'never rested')
}
// underhand lob: ~10m
{
  const n = mk(7.8, 7.8)
  for (let i = 0; i < 400; i++) {
    if (stepNade(n, 0.05, FLAT, BOUNDS).some(e => e.kind === 'rest')) { n.restAt = i; break }
  }
  check('45° underhand lob travels ~7-13m',
    n.restAt !== null && n.x > 7 && n.x < 13, `${n.x.toFixed(1)}m`)
}
// drop settles + rests (no infinite micro-bounce)
{
  const n = mk(2, 0)
  let rest = false
  for (let i = 0; i < 300; i++) if (stepNade(n, 0.05, FLAT, BOUNDS).some(e => e.kind === 'rest')) { rest = true; break }
  check('dropped grenade settles and rests (discrete-time settle fix)',
    rest && Math.abs(n.vy) < 0.01 && n.y <= NADE.radius + 0.02)
}
// molotov ground-contact event
{
  const n: NadeEnt = { ...mk(0, 0), kind: 'molotov', weapon: 'molotov', y: 3 }
  let ground = false
  for (let i = 0; i < 60; i++) if (stepNade(n, 0.05, FLAT, BOUNDS).some(e => e.kind === 'ground')) { ground = true; break }
  check('molotov reports ground contact on first floor hit (ignites server-side)',
    ground)
}
// wall bounce: side box reflects X velocity
{
  const wall: NadeBox[] = toNadeBoxes([{ x: 5, y: 1, z: 0, w: 1, h: 4, d: 8 }])
  const n = mk(10, 0)
  let bounced = false
  for (let i = 0; i < 100; i++) {
    const ev = stepNade(n, 0.05, wall, BOUNDS)
    if (ev.some(e => e.kind === 'bounce' && e.axis === 'x')) { bounced = true; break }
  }
  check('wall bounce reflects X with restitution (0.45 energy keep)',
    bounced && n.vx < 0, `vx=${n.vx.toFixed(2)}`)
}

// ============================================================ 5. viewmodels
for (const id of ['flash', 'he', 'smoke', 'molotov', 'inc', 'decoy'] as const) {
  const vm = buildViewModel(id, 'CT')
  const meshes: THREE.Mesh[] = []
  vm.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
  check(`viewmodel[${id}]: body + pin group + gloves`,
    meshes.length >= 4 && !!vm.pin && vm.pin.children.length >= 2,
    `${meshes.length} meshes, pin parts ${vm.pin?.children.length}`)
}
check('viewmodels differ per kind (HE ball vs flash cylinder vs decoy box)',
  (() => {
    const count = (id: string) => {
      const vm = buildViewModel(id as 'he', 'CT')
      let spheres = 0, cyls = 0, boxes = 0
      vm.group.traverse(o => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        if ((m.geometry as THREE.SphereGeometry).type === 'SphereGeometry') spheres++
        else if ((m.geometry as THREE.CylinderGeometry).type === 'CylinderGeometry') cyls++
        else if ((m.geometry as THREE.BoxGeometry).type === 'BoxGeometry') boxes++
      })
      return { spheres, cyls, boxes }
    }
    const he = count('he'), fl = count('flash'), dc = count('decoy')
    return he.spheres > 0 && fl.cyls > 0 && dc.boxes > 0
  })())
check('vmBase places grenades in the hand zone (right-low-forward)',
  (() => {
    const v = vmBase('flash')
    return v.x > 0 && v.y < -0.15 && v.z < -0.3
  })())
for (const id of ['flash', 'he', 'smoke', 'molotov', 'inc', 'decoy'] as const) {
  const g = buildRemoteGun(id)
  const kids = g.children.length
  check(`remote gun[${id}] has a distinct body`, kids >= 1, `${kids} parts`)
}

// ============================================================ 6. wiring source checks
const eng = readFileSync('src/game/engine.ts', 'utf8')
const srv = readFileSync('mini-services/game-server/index.ts', 'utf8')
const bots = readFileSync('mini-services/game-server/bots.ts', 'utf8')
const hud = readFileSync('src/game/hud.tsx', 'utf8')
const fxs = readFileSync('src/game/fx.ts', 'utf8')

check("engine emits 'throw' with dir + power (LMB full / RMB lob)",
  eng.includes("emit('throw', { weapon: w.id, dir:") && eng.includes('this.throwGrenade(0.45)') && eng.includes('this.throwGrenade(1)'))
check('engine throws respect the shared cooldown + live phase',
  eng.includes('NADE.throwCooldownMs') && eng.includes("if (!this.alive || this.phase !== 'live') return"))
check('Digit5 cycles the grenade slot',
  eng.includes("if (k === 'Digit5') this.switchSlot(5)") && eng.includes('slot === 5 && idx >= 0'))
check("engine handles 'nade' + 'nadeFx' + 'gBounce' + 'flash' + 'decoyShot'",
  ['socket.on(\'nade\'', 'socket.on(\'nadeFx\'', 'socket.on(\'gBounce\'', 'socket.on(\'flash\'', 'socket.on(\'decoyShot\''].every(s => eng.includes(s)))
check('engine dead-reckons with the shared physics constants (gravity + drag)',
  eng.includes('NADE.gravity * dt') && eng.includes('NADE.drag * dt'))
check('engine snapshots parse gs/sm/fi entity arrays',
  eng.includes('d.gs') && eng.includes('d.sm') && eng.includes('d.fi'))
check('engine renders flash whiteout + audio duck',
  eng.includes('blindUntil') && eng.includes('audio.duckFor') && hud.includes('flash > 0.01'))
check('engine syncs hasKit from snapshot row 21 + buyOk',
  eng.includes('row[21] === 1') && eng.includes('d.hasKit'))
check('smoke clouds + fire zones exist as world fx classes',
  fxs.includes('export class SmokeCloud') && fxs.includes('export class FireZone'))
check("server has the 'throw' socket handler + cooldown + inventory gate",
  srv.includes("socket.on('throw'") && srv.includes('NADE.throwCooldownMs') && srv.includes('p.inventory.includes(weapon)'))
check('server steps entities on the 20 Hz tick with shared stepNade',
  srv.includes('stepNade(n, NADE_TICK_MS / 1000') && srv.includes('const NADE_TICK_MS = 50'))
check('hasLOS consults smoke volumes (opaque core + pop-in/fade windows)',
  srv.includes('smokeBlocksSeg') && srv.includes('smokePopInMs') && srv.includes('smokeFadeMs'))
check('HE path: radial damage + LOS wall gate + armor halving',
  srv.includes('heDamage(dist') && srv.includes('v.armor - armorDmg'))
check('flash path: per-player blind + bots blindUntil + per-socket event',
  srv.includes('flashBlindMs(dist, dot)') && srv.includes('v.blindUntil') && srv.includes("emit('flash'"))
check('fire path: DoT ticks + extinguish-by-smoke',
  srv.includes('NADE.fireTickDmg') && srv.includes('smokeExtinguishR'))
check('decoy path: rest activation + gunfire mimic loop',
  srv.includes('decoyShotMinMs') && srv.includes("broadcast(m, 'decoyShot'"))
check('defuse kit halves the 10s channel',
  srv.includes('(ROUND.defuseMs / 1000) / (defuser.hasKit ? 2 : 1)'))
check('round reset clears all grenade entities + strips kit on death',
  srv.includes('m.nades = []; m.smokes = []; m.fires = []; m.decoys = []') && srv.includes('p.hasKit = false'))
check('bots get the blind gate + throw ctx injection',
  bots.includes('blindUntil') && bots.includes('botThrowGrenade') && srv.includes('setBotContext({ applyDamage, applyShotgunDamage, hasLOS, botThrowGrenade })'))
check('bot nade AI: flash-before-push (p<0.3, site goal) + HE cluster + smoke retreat',
  bots.includes("Math.random() < 0.3") && bots.includes("throwId = 'he'") && bots.includes("throwId = 'smoke'") && bots.includes("ai.flashThrown = true"))
check('bot buy ladder stacks grenades (limits) + CT kit purchases',
  bots.includes('p.inventory.filter(x => x === id).length >= (w.maxCarry ?? 1)') && bots.includes('p.hasKit = true'))

// ============================================================ 7. audio disk
// (post-9.3 acceptance: samples live in public/assets/sounds; staging still
// valid for regenerations — like the runtime loader chain)
const onDisk = (n: string) =>
  existsSync(`public/assets/sounds/${n}.ogg`) || existsSync(`public/staging/sounds/${n}.ogg`)
for (const n of liveGrenadeSoundFiles()) {
  check(`sound on disk: ${n}.ogg`, onDisk(n))
}

// ============================================================ 8. constants sanity
check('NADE tuning: full 22 / lob 11 m/s, gravity 18, cooldown 900ms',
  NADE.throwV === 22 && NADE.lobV === 11 && NADE.gravity === 18 && NADE.throwCooldownMs === 900)
check('smoke lasts 18s (plan 8.2) with a 2.7m opaque core',
  NADE.smokeMs === 18000 && NADE.smokeCoreR === 2.7)
check('fire: 7s, 8dmg/500ms ≈ 40dps',
  NADE.fireMs === 7000 && NADE.fireTickMs === 500 && NADE.fireTickDmg === 8)
check('HE fuse 1.6s; flash 1.6s; smoke pops 400ms after rest; molly fuse 2.5s',
  NADE.heFuseMs === 1600 && NADE.flashFuseMs === 1600 && NADE.smokePopAfterRestMs === 400 && NADE.mollyFuseMs === 2500)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
