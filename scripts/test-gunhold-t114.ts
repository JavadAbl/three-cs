// Task 114 test — gun-in-hands IK hold for remote GLB characters.
//
// 1. solveArm NUMERIC contract — extracted VERBATIM from players.ts source
//    (importing players.ts needs THREE + DOM-less env is fine, but slicing
//    keeps the test hermetic like test-feel-t109). A tiny THREE stand-in is
//    provided for the sliced code (Vector3/Quaternion with the exact methods
//    the solver uses).
//    - reachable target: the posed fist lands EXACTLY on the target (the
//      chain S→E→fist composition through the two solved quaternions)
//    - beyond-reach target: clamps to full extension toward the target
//    - pole flips the elbow to the correct side of the shoulder→fist line
// 2. usermodel.ts anchors: HandR at the MEASURED fist (−0.02, −0.36, −0.02),
//    HandL twin exists (probe anchor), USER_ARM_RIG exported.
// 3. players.ts wiring: driveUser receives the weapon; holdWeapon solves both
//    arms, sets bone QUATERNIONS, locks gunRig orientation to the carriage
//    direction, glues the support hand to the grip's sway; per-slot carriages.
// 4. engine.ts probes: __eng.hold() live tuner + __eng.handContact().
import { readFileSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

// ---------------------------------------------------------------- THREE stand-in
class V3 {
  x: number; y: number; z: number
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this }
  copy(v: V3) { this.x = v.x; this.y = v.y; this.z = v.z; return this }
  clone() { return new V3(this.x, this.y, this.z) }
  add(v: V3) { this.x += v.x; this.y += v.y; this.z += v.z; return this }
  addScaledVector(v: V3, s: number) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this }
  sub(v: V3) { return this.clone().set(this.x - v.x, this.y - v.y, this.z - v.z) }
  multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; return this }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l) }
  dot(v: V3) { return this.x * v.x + this.y * v.y + this.z * v.z }
  applyQuaternion(q: Quat) {
    const v = this.clone()
    const ix = q.w * v.x + q.y * v.z - q.z * v.y
    const iy = q.w * v.y + q.z * v.x - q.x * v.z
    const iz = q.w * v.z + q.x * v.y - q.y * v.x
    const iw = -q.x * v.x - q.y * v.y - q.z * v.z
    return this.set(
      ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    )
  }
}
function quatFromUnitVectors(a: V3, b: V3): Quat {
  const r = a.dot(b) + 1
  if (r < Number.EPSILON) {
    // opposite — any orthogonal axis
    const axis = Math.abs(a.x) < 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0)
    const ortho = axis.clone().sub(a.clone().multiplyScalar(axis.dot(a))).normalize()
    return new Quat(ortho.x, ortho.y, ortho.z, 0)
  }
  const axis = new V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
  const q = new Quat(axis.x, axis.y, axis.z, r)
  return q.normalize()
}
class Quat {
  x: number; y: number; z: number; w: number
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w }
  set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this }
  copy(q: Quat) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this }
  clone() { return new Quat(this.x, this.y, this.z, this.w) }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w) }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l) }
  multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; this.w *= s; return this }
  multiply(q: Quat) {
    const a = this.clone()
    return this.set(
      a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y,
      a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z,
      a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x,
      a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z,
    )
  }
  invert() {
    const d = this.length() ** 2 || 1
    return this.set(-this.x / d, -this.y / d, -this.z / d, this.w / d)
  }
  setFromUnitVectors(a: V3, b: V3) { return this.copy(quatFromUnitVectors(a, b)) }
}

// ---------------------------------------------------------------- slice solveArm
const playersSrc = readFileSync('src/game/players.ts', 'utf8')
const sigAt = playersSrc.indexOf('function solveArm(')
const bodyStart = playersSrc.indexOf('{', playersSrc.indexOf(')', sigAt))
// find the matching close brace of the function body
let depth = 0
let bodyEnd = -1
for (let i = bodyStart; i < playersSrc.length; i++) {
  if (playersSrc[i] === '{') depth++
  else if (playersSrc[i] === '}') { depth--; if (depth === 0) { bodyEnd = i; break } }
}
check('solveArm exists verbatim in players.ts', sigAt >= 0 && bodyEnd > bodyStart)
const solveArmSrc = playersSrc.slice(bodyStart + 1, bodyEnd)
  .replace(/: ArmChain/g, '').replace(/: THREE\.(Vector3|Quaternion)/g, '')
  .replace(/qUpper: /g, 'qUpper$$').replace(/qFore: /g, 'qFore$$') // keep param names after type strip
// the sliced signature is (c, target, pole, qUpper, qFore) — rebuild plainly
const solveArm = new Function('THREE', `
  const Vector3 = THREE.Vector3, Quaternion = THREE.Quaternion
  return function solveArm(c, target, pole, qUpper, qFore) { ${solveArmSrc} }
`)({ Vector3: V3, Quaternion: Quat }) as (c: unknown, t: unknown, p: unknown, qU: Quat, qF: Quat) => void

// ---------------------------------------------------------------- chain replica
// same numbers as USER_ARM_RIG (right arm), torso-local
const S = new V3(0.27, 0.40, 0)
const E = new V3(0.34, 0.12, 0)
const F = new V3(0.32, -0.24, -0.02)
const chain = {
  S,
  e0: E.clone().sub(S).normalize(),
  w0: F.clone().sub(E).normalize(),
  L1: Math.hypot(E.x - S.x, E.y - S.y, E.z - S.z),
  L2: Math.hypot(F.x - E.x, F.y - E.y, F.z - E.z),
}

/** pose the chain through the solved quaternions; returns the fist position */
function posedFist(qU: Quat, qF: Quat): V3 {
  const elbow = E.clone().sub(S).applyQuaternion(qU).add(S) // bind elbow dir rotated
  const fistLocal = F.clone().sub(E)                          // bind fist offset from elbow
  const fist = fistLocal.applyQuaternion(qU.clone().multiply(qF)).add(elbow)
  return fist
}

// --- reachable target: HOLD.rifle grip in torso space
{
  const qU = new Quat(), qF = new Quat()
  const target = new V3(0.16, 0.01, -0.30)
  solveArm(chain, target, new V3(0.1, -1, 0.3), qU, qF)
  const fist = posedFist(qU, qF)
  const err = fist.clone().sub(target).length()
  check('solveArm: reachable target lands fist ON target', err < 1e-9, `err=${err.toExponential(2)}m`)
}
// --- a batch of random targets: exact landing when reachable, clamp when not
{
  let worstReachable = 0
  let worstClampOff = 0
  let nReach = 0, nClamp = 0
  for (let i = 0; i < 200; i++) {
    const r = (a: number, b: number) => a + Math.random() * (b - a)
    const target = new V3(r(0.0, 0.45), r(-0.35, 0.35), r(-0.55, 0.05))
    const D = target.clone().sub(S).length()
    const dmax = chain.L1 + chain.L2 - 0.004
    const qU = new Quat(), qF = new Quat()
    solveArm(chain, target, new V3(0.1, -1, 0.3), qU, qF)
    const err = posedFist(qU, qF).clone().sub(target).length()
    if (D <= dmax) {
      nReach++
      worstReachable = Math.max(worstReachable, err)
    } else {
      // clamp: fist lands short by ≈ the overshoot (wrist still aims at the
      // true target, so ±1cm tolerance), never FURTHER than the arm
      nClamp++
      const shortBy = Math.abs((D - dmax) - err)
      const armLen = posedFist(qU, qF).clone().sub(S).length()
      worstClampOff = Math.max(worstClampOff, shortBy, Math.max(0, armLen - dmax - 0.001))
    }
  }
  check('solveArm: reachable targets land exactly (<1e-9)', worstReachable < 1e-9 && nReach > 20,
    `${nReach} reachable, worst=${worstReachable.toExponential(2)}m`)
  check('solveArm: beyond-reach targets clamp to full extension (±1cm)', worstClampOff < 0.01 && nClamp > 20,
    `${nClamp} clamped, worst deviation=${worstClampOff.toFixed(4)}m`)
}
// --- explicit beyond-reach target: arm fully extended toward the target
{
  const qU = new Quat(), qF = new Quat()
  const target = new V3(0.0, -0.5, -1.2) // far forward: |t-S| ≈ 1.4 > 0.65
  solveArm(chain, target, new V3(0.1, -1, 0.3), qU, qF)
  const fist = posedFist(qU, qF)
  const armLen = fist.clone().sub(S).length()
  const shortBy = fist.clone().sub(target).length()
  check('solveArm: far target = full extension pointing at it',
    Math.abs(armLen - (chain.L1 + chain.L2 - 0.004)) < 0.005 && shortBy > 0.5,
    `arm=${armLen.toFixed(4)} (max ${(chain.L1 + chain.L2 - 0.004).toFixed(4)}), short by ${shortBy.toFixed(3)}m`)
}
// --- pole side: elbow below vs above the shoulder→fist line
{
  const target = new V3(0.16, 0.01, -0.30)
  const elbowOf = (poleY: number) => {
    const qU = new Quat(), qF = new Quat()
    solveArm(chain, target, new V3(0, poleY, 0), qU, qF)
    return E.clone().sub(S).applyQuaternion(qU).add(S)
  }
  const below = elbowOf(-1).y
  const above = elbowOf(1).y
  check('solveArm: pole biases the elbow to the correct side', below < above, `down-pole elbow y=${below.toFixed(3)} < up-pole y=${above.toFixed(3)}`)
}

// ---------------------------------------------------------------- usermodel anchors
const userSrc = readFileSync('src/game/usermodel.ts', 'utf8')
check('usermodel: HandR anchored at the MEASURED fist (−0.02, −0.36, −0.02)',
  /handR: \[-0\.02, -0\.36, -0\.02\]/.test(userSrc))
check('usermodel: HandL probe anchor exists on foreL',
  /handL\.name = 'HandL'/.test(userSrc) && /foreL\.add\(handL\)/.test(userSrc))
check('usermodel: USER_ARM_RIG bind geometry exported',
  /export const USER_ARM_RIG/.test(userSrc) && /right: \{ S: \[0\.27, 0\.40, 0\]/.test(userSrc))
check('usermodel: forearm length matches the measurement (F.y−E.y = −0.36)',
  /E: \[0\.34, 0\.12, 0\], F: \[0\.32, -0\.24, -0\.02\]/.test(userSrc))

// ---------------------------------------------------------------- players wiring
check('players: driveUser receives the weapon (slot-based carriage)',
  /driveUser\(g, p\.weapon,/.test(playersSrc))
check('players: holdWeapon solves BOTH arms',
  /solveArm\(g\.armR, _grip/.test(playersSrc) && /solveArm\(g\.armL, _left/.test(playersSrc))
check('players: per-instance IK chains (Task 115 — soldier and rebel have different proportions)',
  /armR: ArmChain/.test(userSrc) && /armL: ArmChain/.test(userSrc) && !/const ARM_R = mkChain/.test(playersSrc))
check('players: bone QUATERNIONS driven (not FK eulers)',
  /b\.armR\.quaternion\.copy/.test(playersSrc) && /b\.foreL\.quaternion\.copy/.test(playersSrc))
check('players: gunRig orientation locked to the carriage direction',
  /_mLook\.lookAt\(_ORIGIN, _dir, _UP\)/.test(playersSrc) && /g\.gunRig\.quaternion\.copy\(_qT\)\.multiply\(_qGun\)/.test(playersSrc))
check('players: gun direction blends toward the bot look dir',
  /_look\.set\(0, Math\.sin\(pitch\), -Math\.cos\(pitch\)\)/.test(playersSrc) && /aimBlend/.test(playersSrc))
check('players: support hand rides the grip sway (never slides off)',
  /_left\.copy\(_grip\)\.addScaledVector\(_dir/.test(playersSrc))
check('players: three per-slot carriages (rifle/pistol/knife)',
  /HOLD\.rifle/.test(playersSrc) && /HOLD\.pistol/.test(playersSrc) && /HOLD\.knife/.test(playersSrc))
check('players: walk sway glued to the grip target',
  /_grip\.x \+= Math\.sin\(phase\) \* P\.swayX \* wa/.test(playersSrc))
check('players: death-relax path untouched (Task 113) — still lerps arm rotations to rest',
  /b\.armR\.rotation\.x = lerp\(b\.armR\.rotation\.x, 0\.15, k\)/.test(playersSrc))

// ---------------------------------------------------------------- engine probes
const engineSrc = readFileSync('src/game/engine.ts', 'utf8')
check('engine: __eng.hold() live carriage tuner', /hold: \(patch\?/.test(engineSrc))
check('engine: __eng.handContact(id) contact probe', /handContact: \(id: string\)/.test(engineSrc))
check('engine: hold/handContact import HOLD + carriageFor from players',
  /import \{ PlayerManager, HOLD, carriageFor \} from '\.\/players'/.test(engineSrc))
check('engine: stale gunTune surface removed (superseded by hold())', !/gunTune/.test(engineSrc))

console.log(fail === 0 ? `\n${pass} passed, 0 failed` : `\n${pass} passed, ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
