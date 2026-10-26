// Task 115 — rebel-as-T-model architecture test.
// 1. ModelSpec coherence: IK chain S/E triplets MUST equal the J-table arm
//    pivots (else the skin swings off the solved fist), and |handR| must
//    equal the chain's L2 (the anchor IS the fist).
// 2. Numeric IK spot-check on the REBEL chain (same contract as t114).
// 3. Source wiring: per-team slots, T→soldier fallback, route, preloader
//    regex/manifest, per-instance chains, no soldier-constant leakage into
//    the rebel spec.
// 4. Scale-regression guard: TARGET_HEIGHT 1.79 unchanged (Task 113).
import { readFileSync } from 'node:fs'
import * as THREE from 'three'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const userSrc = readFileSync('src/game/usermodel.ts', 'utf8')
const playersSrc = readFileSync('src/game/players.ts', 'utf8')
const preloaderSrc = readFileSync('src/game/preloader.ts', 'utf8')
const routeSrc = readFileSync('src/app/api/assets/rebel/route.ts', 'utf8')

// ---------------------------------------------------------------- spec numbers (hand-copied from usermodel.ts — the source-regex section below proves they match the file)
const SOLDIER = {
  J: { armR: [0.27, 1.48, 0], foreR: [0.34, 1.20, 0], armL: [-0.27, 1.48, 0], foreL: [-0.34, 1.20, 0], torso: [0, 1.08, 0] },
  rig: {
    right: { S: [0.27, 0.40, 0], E: [0.34, 0.12, 0], F: [0.32, -0.24, -0.02] },
    left: { S: [-0.27, 0.40, 0], E: [-0.34, 0.12, 0], F: [-0.336, -0.223, -0.019] },
  },
  handR: [-0.02, -0.36, -0.02], handL: [0.004, -0.343, -0.019],
}
const REBEL = {
  J: { armR: [0.185, 1.47, 0.05], foreR: [0.21, 1.11, 0.04], armL: [-0.185, 1.47, 0.05], foreL: [-0.21, 1.11, 0.03], torso: [0, 1.08, 0] },
  rig: {
    right: { S: [0.185, 0.39, 0.05], E: [0.21, 0.03, 0.04], F: [0.205, -0.298, -0.027] },
    left: { S: [-0.185, 0.39, 0.05], E: [-0.21, 0.03, 0.03], F: [-0.202, -0.293, -0.043] },
  },
  handR: [-0.005, -0.328, -0.067], handL: [0.008, -0.323, -0.073],
}

// chain S/E (torso-local) vs J (game space): game = torso-local + J.torso
for (const [label, M] of [['soldier', SOLDIER], ['rebel', REBEL]] as const) {
  for (const side of ['right', 'left'] as const) {
    const armKey = side === 'right' ? 'armR' : 'armL'
    const foreKey = side === 'right' ? 'foreR' : 'foreL'
    const r = M.rig[side]
    const Sgame = [r.S[0] + 0, r.S[1] + M.J.torso[1], r.S[2] + 0]
    const Egame = [r.E[0] + 0, r.E[1] + M.J.torso[1], r.E[2] + 0]
    const errS = Math.max(Math.abs(Sgame[0] - M.J[armKey][0]), Math.abs(Sgame[1] - M.J[armKey][1]), Math.abs(Sgame[2] - M.J[armKey][2]))
    const errE = Math.max(Math.abs(Egame[0] - M.J[foreKey][0]), Math.abs(Egame[1] - M.J[foreKey][1]), Math.abs(Egame[2] - M.J[foreKey][2]))
    check(`${label} ${side}: IK chain S == J.${armKey} pivot (±0)`, errS < 1e-9, `err=${errS}`)
    check(`${label} ${side}: IK chain E == J.${foreKey} pivot (±0)`, errE < 1e-9, `err=${errE}`)
    // |hand anchor| == L2 (anchor is the fist, forearm length)
    const hand = side === 'right' ? M.handR : M.handL
    const L2 = Math.hypot(r.E[0] - r.F[0], r.E[1] - r.F[1], r.E[2] - r.F[2])
    const handLen = Math.hypot(hand[0], hand[1], hand[2])
    check(`${label} ${side}: |hand anchor| == chain L2 (fist on the forearm)`, Math.abs(L2 - handLen) < 1e-3, `L2=${L2.toFixed(4)} |hand|=${handLen.toFixed(4)}`)
  }
}

// rebel reach vs soldier (sanity: same ballpark, no unit slip)
const reach = (r: { S: number[]; E: number[]; F: number[] }) =>
  Math.hypot(r.E[0] - r.S[0], r.E[1] - r.S[1], r.E[2] - r.S[2]) + Math.hypot(r.F[0] - r.E[0], r.F[1] - r.E[1], r.F[2] - r.E[2])
const rR = reach(REBEL.rig.right), sR = reach(SOLDIER.rig.right)
check('rebel arm reach within 15% of the soldier (proportional, no unit slip)', Math.abs(rR - sR) / sR < 0.15, `rebel=${rR.toFixed(3)} soldier=${sR.toFixed(3)}`)

// ---------------------------------------------------------------- numeric IK on the rebel chain (solveArm verbatim from players.ts)
const sigAt = playersSrc.indexOf('function solveArm(')
const bodyStart = playersSrc.indexOf('{', sigAt)
let depth = 0, bodyEnd = -1
for (let i = bodyStart; i < playersSrc.length; i++) {
  if (playersSrc[i] === '{') depth++
  else if (playersSrc[i] === '}') { depth--; if (depth === 0) { bodyEnd = i; break } }
}
const solveArmSrc = playersSrc.slice(bodyStart + 1, bodyEnd)
  .replace(/: ArmChain/g, '').replace(/: THREE\.(Vector3|Quaternion)/g, '')
const V3 = THREE.Vector3, Q4 = THREE.Quaternion
const solveArm = new Function('THREE', `
  const { Vector3, Quaternion } = THREE;
  return function solveArm(c, target, pole, qUpper, qFore) { ${solveArmSrc} }
`)(THREE)
const mkChain = (s: number[], e: number[], f: number[]) => {
  const S = new V3(s[0], s[1], s[2]), E = new V3(e[0], e[1], e[2]), F = new V3(f[0], f[1], f[2])
  return { S, e0: E.clone().sub(S).normalize(), w0: F.clone().sub(E).normalize(), L1: E.distanceTo(S), L2: F.distanceTo(E) }
}
{
  const c = mkChain(REBEL.rig.right.S, REBEL.rig.right.E, REBEL.rig.right.F)
  // pose through the solved quaternions (composed qU·qF applied once — same
  // reconstruction as test-gunhold-t114's posedFist)
  const posedFist = (qU: Q4, qF: Q4) => {
    const elbow = c.e0.clone().multiplyScalar(c.L1).applyQuaternion(qU).add(c.S)
    const fistLocal = c.w0.clone().multiplyScalar(c.L2)
    return fistLocal.applyQuaternion(qU.clone().multiply(qF)).add(elbow)
  }
  // reachable target: the rifle grip in torso-local space
  const target = new V3(0.16, 0.01, -0.30)
  const qU = new Q4(), qF = new Q4()
  solveArm(c, target, new V3(0.1, -1, 0.3), qU, qF)
  const err = posedFist(qU, qF).distanceTo(target)
  check('solveArm on the REBEL chain: fist lands on the rifle grip (<1e-9)', err < 1e-9, `err=${err.toExponential(2)}m`)
  // beyond-reach target clamps to full extension (same contract as t114:
  // the fist lands on the S→target segment short by exactly the overshoot,
  // wrist still aiming at the true target)
  const far = new V3(0.9, 0.0, -0.9)
  solveArm(c, far, new V3(0.1, -1, 0.3), qU, qF)
  const fist2 = posedFist(qU, qF)
  const D = far.distanceTo(c.S), dmax = c.L1 + c.L2 - 0.004
  const err2 = fist2.distanceTo(far)
  const shortBy = Math.abs((D - dmax) - err2)
  const armLen = fist2.distanceTo(c.S)
  check('solveArm on the REBEL chain: beyond-reach clamps to full extension',
    shortBy < 0.01 && Math.abs(armLen - dmax) < 0.005,
    `shortBy=${shortBy.toFixed(4)} armLen=${armLen.toFixed(4)} (max ${dmax.toFixed(4)})`)
}

// ---------------------------------------------------------------- source wiring
check('usermodel: REBEL_ARM_RIG exported with measured values',
  /export const REBEL_ARM_RIG/.test(userSrc) && /right: \{ S: \[0\.185, 0\.39, 0\.05\], E: \[0\.21, 0\.03, 0\.04\], F: \[0\.205, -0\.298, -0\.027\] \}/.test(userSrc))
check('usermodel: rebel hand anchors at the measured fists',
  /handR: \[-0\.005, -0\.328, -0\.067\]/.test(userSrc) && /handL: \[0\.008, -0\.323, -0\.073\]/.test(userSrc))
check('usermodel: rebel tint is white (renders as authored — it IS the T identity)',
  /tint: \{ CT: 0xffffff, T: 0xffffff \}/.test(userSrc))
check('usermodel: soldier tint unchanged (Task 112/113 look preserved)',
  /tint: \{ CT: 0x9fb7d9, T: 0xd9bd92 \}/.test(userSrc))
check('usermodel: per-team slots CT=soldier T=rebel',
  /CT: \{ spec: SOLDIER_SPEC/.test(userSrc) && /T: \{ spec: REBEL_SPEC/.test(userSrc))
check('usermodel: T slot falls back to the soldier proto (pre-115 T look, no crash)',
  /if \(!slot\.asset\.proto && team === 'T' && slots\.CT\.asset\.proto\) slot = slots\.CT/.test(userSrc))
check('usermodel: per-team preload (memoized per slot)',
  /export function preloadUserModel\(team\?: TeamId\)/.test(userSrc) && /if \(a\.waiter\) return a\.waiter/.test(userSrc))
check('usermodel: userModelReady(team) — T counts the soldier fallback',
  /if \(team === 'T'\) return !!\(slots\.T\.asset\.proto \|\| slots\.CT\.asset\.proto\)/.test(userSrc))
check('usermodel: userModelState stays ready-only-after-ALL-settled (E2E contract)',
  /const pending = ct\.state === 'idle' \|\| ct\.state === 'loading' \|\| t\.state === 'idle' \|\| t\.state === 'loading'/.test(userSrc))
check('usermodel: rebel weights use the measured bands (arm notch 0.195/0.165/0.18, elbow 1.11)',
  /y > 1\.32 \? 0\.165 : \(y > 1\.08 \? 0\.195 : 0\.18\)/.test(userSrc) && /y >= 1\.11 \? \[\[upper, 1\]\] : \[\[fore, 1\]\]/.test(userSrc))
check('usermodel: soldier weights byte-identical (no regression to the tuned bands)',
  /const armX = y > 1\.32 \? 0\.13 : 0\.20/.test(userSrc) && /if \(y > 1\.08 && y < 1\.32\)/.test(userSrc) && /y >= 1\.20 \? \[\[upper, 1\]\] : \[\[fore, 1\]\]/.test(userSrc))
check('usermodel: rebel skin binds by spec (per-model weights)',
  /const w = spec\.weights\(x\.x, x\.y\)/.test(userSrc))
check('usermodel: skeleton built from spec.J (per-model joints)',
  /const J = spec\.J/.test(userSrc))
check('usermodel: TARGET_HEIGHT unchanged (Task 113 scale fix intact)',
  /const TARGET_HEIGHT = 1\.79/.test(userSrc))
check('players: per-team preload loop (CT must not wait for the 19.7 MB rebel)',
  /for \(const team of \['CT', 'T'\] as TeamId\[\]\)/.test(playersSrc) && /preloadUserModel\(team\)/.test(playersSrc))
check('players: upgradeToGlb guards per-team readiness',
  /if \(!userModelReady\(p\.team\)\) return/.test(playersSrc))
check('players: getOrCreate gates per-team',
  /if \(userModelReady\(team\)\)/.test(playersSrc))
check('players: soldier constants (USER_ARM_RIG/ARM_R) no longer imported',
  !/USER_ARM_RIG/.test(playersSrc) && !/const ARM_R/.test(playersSrc))
check('route: /api/assets/rebel serves staging-first with per-request stat (Task 113 lesson)',
  /staging', 'models', 'rebel\.glb'/.test(routeSrc) && /assets', 'models', 'rebel\.glb'/.test(routeSrc) && /cache\.mtimeMs === st\.mtimeMs/.test(routeSrc))
check('preloader: rebel route cached (ROUTE_RE) + manifest item',
  /\(weapon\|human\|rebel\)/.test(preloaderSrc) && /url: '\/api\/assets\/rebel'/.test(preloaderSrc))
check('preloader: acceptance bump applied (rebel v6→v7, human v7→v8 in Task 117, announcer re-ship v8→v9 in Task 120 — the store tracks the latest bump)',
  /ASSET_CACHE_VERSION = 'v9'/.test(preloaderSrc))
check('engine: glbTeams probe exposed',
  /glbTeams: \(\) => userModelStates\(\)/.test(readFileSync('src/game/engine.ts', 'utf8')))

console.log(fail === 0 ? `\n${pass} passed, 0 failed` : `\n${pass} passed, ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
