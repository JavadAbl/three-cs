// Task 109 feel-polish test — CS spray patterns (#2), quick-switch +
// reload-cancel wiring (#5), directional damage arc (#6).
//
// 1. sprayPunch numeric contract — extracted VERBATIM from engine.ts source
//    (importing engine.ts transitively needs DOM canvas via textures.ts, so
//    the function is sliced out and eval'd; self-contained, Math.random only)
// 2. engine source wiring: punch lands in the camera set, holds during the
//    spray + fast recovery after 120ms, resets on switch/round, NO permanent
//    pitch/yaw kick remains anywhere.
// 3. lastWId (ID-based Q switch — the round-reorder bug) + reload cancel
//    call sites; hud.tsx damage arc renders only while alive with the
//    bearing from HudState.dmgFrom.
import { readFileSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const engineSrc = readFileSync('src/game/engine.ts', 'utf8')
// slice the body between the signature's "} {" and the function's col-0 close
const sigAt = engineSrc.indexOf('export function sprayPunch')
const bodyAt = engineSrc.indexOf('} {', sigAt)
const chunk = engineSrc.slice(bodyAt + 3)
const bodyEnd = chunk.indexOf('\n}')
const fnMatch = sigAt >= 0 && bodyAt > sigAt && bodyEnd > 0 ? [chunk.slice(0, bodyEnd)] : null
check('sprayPunch exists verbatim in engine.ts', !!fnMatch)
// body only (signature carries TS annotations a plain Function can't parse)
const sprayPunch = fnMatch
  ? ((id: string, i: number, kick: number) => new Function('id', 'i', 'kick', fnMatch[0])(id, i, kick)) as (id: string, i: number, kick: number) => { p: number; y: number }
  : () => ({ p: NaN, y: NaN })
const eng = engineSrc

const KICK_AK = 0.55 * (Math.PI / 180) // AK-47 deg -> rad, the spray exemplar

// --- 1. numeric pattern contract -------------------------------------------
check('sprayPunch: first 3 shots are dead-straight (y === 0)',
  [1, 2, 3].every(i => sprayPunch('ak47', i, KICK_AK).y === 0))
check('sprayPunch: sway engages from shot 4 (some y !== 0 in shots 4..10)',
  [4, 5, 6, 7, 8, 9, 10].some(i => sprayPunch('ak47', i, KICK_AK).y !== 0))
check('sprayPunch: vertical is ALWAYS positive (view only climbs)',
  Array.from({ length: 12 }, (_, k) => sprayPunch('ak47', k + 1, KICK_AK).p).every(p => p > 0))
check('sprayPunch: first-shot magnitude = kick*1.5*v(1)*jitter within [0.85,1.15]',
  (() => { const p = sprayPunch('ak47', 1, KICK_AK).p / (KICK_AK * 1.5 * 1.0); return p >= 0.85 && p <= 1.15 })())
check('sprayPunch: plateau floor ~0.42 of first-shot envelope (long sprays taper)',
  (() => {
    const first = sprayPunch('ak47', 1, KICK_AK).p
    const late = sprayPunch('ak47', 10, KICK_AK).p
    // jitter noise: average 3 late shots
    const avg = (late + sprayPunch('ak47', 11, KICK_AK).p + sprayPunch('ak47', 12, KICK_AK).p) / 3
    return avg / first > 0.3 && avg / first < 0.65
  })())
check('sprayPunch: per-id deterministic seed — same id+shot gives identical sway sign shape',
  (() => {
    const a = Array.from({ length: 8 }, (_, k) => Math.sign(sprayPunch('ak47', k + 4, 1).y))
    const b = Array.from({ length: 8 }, (_, k) => Math.sign(sprayPunch('ak47', k + 4, 1).y))
    return JSON.stringify(a) === JSON.stringify(b)
  })())
check('sprayPunch: different ids sway differently (ak47 vs m4a1s diverge somewhere)',
  Array.from({ length: 10 }, (_, k) => k + 4)
    .some(i => Math.sign(sprayPunch('ak47', i, 1).y) !== Math.sign(sprayPunch('m4a1s', i, 1).y)))
check('sprayPunch: horizontal bounded by 0.45 of kick*1.5 (sway, not a waggle)',
  Array.from({ length: 12 }, (_, k) => Math.abs(sprayPunch('galil', k + 1, 0.02).y))
    .every(y => y <= 0.02 * 1.5 * 0.45 * 1.1 + 1e-12))

// --- 2. engine wiring (source greps) ----------------------------------------
check('recoil: camera applies punch offsets (pitch + punchP, yaw + punchY)',
  eng.includes('this.camera.rotation.set(this.pitch + this.punchP, this.yaw + this.punchY, 0'))
check('recoil: punch HOLDS 120ms then decays τ=90ms (spray climbs, pause recovers)',
  eng.includes('this.punchAt > 120') && eng.includes('-dt / 0.09'))
check('recoil: NO permanent kick remains (no "this.pitch +=" outside comments)',
  !/^ *this\.pitch \+=/m.test(eng))
check('recoil: punch resets on weapon switch AND round start',
  (eng.match(/this\.punchP = 0/g) ?? []).length >= 4) // switchSlot, switchLast, round reset + decay zeroing
check('recoil: negev spool fade still scales the punch (ramp factor reaches sprayPunch)',
  eng.includes('sprayPunch(w.id, this.sustained, kick)'))
check('quick-switch: lastWId is ID-based (survives inventory reorder after round resets)',
  eng.includes('private lastWId:') && eng.includes('this.inventory.indexOf(this.lastWId)'))
check('quick-switch: Q key wired to switchLast',
  eng.includes("k === 'KeyQ'") && eng.includes('this.switchLast()'))
check('reload cancel: switch clears the pending reload + stops staged sfx',
  eng.includes('this.cancelReloadSfx()') &&
  (eng.match(/this\.reloadEndsAt = 0/g) ?? []).length >= 3)
check('switchLast: fresh gun resets spray state (recoil/punch/sustained)',
  eng.includes('this.punchP = 0') && eng.includes('this.sustained = 0'))

// --- 3. damage arc (#6) -------------------------------------------------------
const hud = readFileSync('src/game/hud.tsx', 'utf8')
check('dmg arc: HudState carries the hit bearing (dmgFrom) through to the HUD render',
  hud.includes('s.dmgFrom !== null') && eng.includes('dmgFrom: this.dmgFrom'))
check('dmg arc: renders only while ALIVE and fades over 1s',
  hud.includes('{s.alive && s.dmgFrom !== null && s.damageAge < 1000'))
check('dmg arc: rotation follows the bearing (dmgFrom rad -> deg around the crosshair)',
  hud.includes('rotate(${deg}deg)') && hud.includes('s.dmgFrom * 180 / Math.PI'))
check('dmg arc: bearing computed attacker-relative at hit time (atan2 cross/dot vs view fwd)',
  eng.includes('Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz)'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
