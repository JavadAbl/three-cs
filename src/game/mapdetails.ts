// ============================================================
// Dust2 visual detail layer (client-only, v5 "visual fidelity" pass)
// All props here are VISUAL ONLY — no gameplay colliders.
// Gameplay solids / LOS / bot nav live in dust2.ts MAP_BOXES (unchanged, v4).
// Bullet raycasts still hit prop batches (impact FX), but movement ignores them.
// Geometry is merged per material → ~20 extra draw calls total.
// ============================================================
import * as THREE from 'three'
import { surfaceMaterial, signTexture, arrowSignTexture, dirtTrackTexture } from './textures'
import { mergeGeosSafe } from './mapview'
import type { SurfaceTex } from './textures'

export interface DetailBuild {
  group: THREE.Group
  raycastMeshes: THREE.Object3D[] // bullets leave FX on props
}

const UV_PER_M = 0.35

// ---------------- geometry helpers ----------------
const M = new THREE.Matrix4()

function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1)
  const uv = g.attributes.uv as THREE.BufferAttribute
  const faceDims: Array<[number, number]> = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ]
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceDims[f]
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      uv.setXY(i, uv.getX(i) * su * UV_PER_M, uv.getY(i) * sv * UV_PER_M)
    }
  }
  g.applyMatrix4(M.makeScale(w, h, d))
  if (ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationY(ry))
  if (rz) g.applyMatrix4(new THREE.Matrix4().makeRotationZ(rz))
  g.applyMatrix4(M.makeTranslation(x, y, z))
  return g
}

function cylGeo(r: number, len: number, x: number, y: number, z: number, axis: 'y' | 'x' | 'z' = 'y'): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, 12)
  if (axis === 'x') g.applyMatrix4(M.makeRotationZ(Math.PI / 2))
  else if (axis === 'z') g.applyMatrix4(M.makeRotationX(Math.PI / 2))
  g.applyMatrix4(M.makeTranslation(x, y, z))
  return g
}

/** Squashed sphere (sand piles, domes). */
function sphGeo(rx: number, ry: number, rz: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 14, 10)
  g.applyMatrix4(M.makeScale(rx, ry, rz))
  g.applyMatrix4(M.makeTranslation(x, y, z))
  return g
}

/** Segmented arch of voussoir boxes. Returns boxes for a batch.
 *  X-arch: spans along X at fixed z. Z-arch: spans along Z at fixed x. */
function archGeos(cx: number, cz: number, ySpring: number, span: number, rise: number, thick: number, alongZ: boolean): THREE.BufferGeometry[] {
  const S = span
  const R = (S * S / 4 + rise * rise) / (2 * rise)
  const y0 = rise - R // circle center offset (negative)
  const th1 = Math.atan2(-y0, S / 2)
  const N = 9
  const out: THREE.BufferGeometry[] = []
  for (let i = 0; i <= N; i++) {
    const th = th1 + (Math.PI - 2 * th1) * (i / N)
    const px = R * Math.cos(th)
    const py = y0 + R * Math.sin(th)
    const tang = ((Math.PI - 2 * th1) * R) / N * 1.35
    const radial = 0.55
    const isKey = Math.abs(th - Math.PI / 2) < (Math.PI - 2 * th1) / (2 * N)
    const L = isKey ? tang * 0.75 : tang
    const H = isKey ? radial + 0.14 : radial
    const g = new THREE.BoxGeometry(L, H, thick)
    g.applyMatrix4(M.makeRotationZ(Math.PI / 2 - th))
    if (alongZ) {
      // rotate the already-Z-rotated box so its tangent runs along world Z
      g.applyMatrix4(M.makeRotationY(-Math.PI / 2))
      g.applyMatrix4(M.makeTranslation(cx, ySpring + py, cz - px))
    } else {
      g.applyMatrix4(M.makeTranslation(cx + px, ySpring + py, cz))
    }
    out.push(g)
  }
  return out
}

// ---------------- batching ----------------
const batches = new Map<THREE.Material, THREE.BufferGeometry[]>()
const surfOf = new Map<THREE.Material, SurfaceTex>()

function pushSurf(geo: THREE.BufferGeometry, tex: SurfaceTex) {
  const mat = surfaceMaterial(tex)
  if (!batches.has(mat)) { batches.set(mat, []); surfOf.set(mat, tex) }
  batches.get(mat)!.push(geo)
}
function pushMat(geo: THREE.BufferGeometry, mat: THREE.Material) {
  if (!batches.has(mat)) batches.set(mat, [])
  batches.get(mat)!.push(geo)
}

// ---------------- shared unique materials ----------------
const wireMat = new THREE.MeshBasicMaterial({ color: 0x241f18 })
const windowMat = new THREE.MeshBasicMaterial({ color: 0x14100b })
const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffeec8 })
const stripMat = new THREE.MeshBasicMaterial({
  map: dirtTrackTexture(), transparent: true, opacity: 0.55, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2,
})

// ============================================================
// build
// ============================================================
export function buildDetails(): DetailBuild {
  const group = new THREE.Group()
  const raycastMeshes: THREE.Object3D[] = []
  batches.clear()

  buildParapets()
  buildArches()
  buildBarrels()
  buildRooftopClutter()
  buildWindows()
  buildSandPiles()
  buildPallets()
  buildWires()
  buildSkyline()
  buildLamps()
  buildStrips()
  const signs = buildSigns()

  // flush batches → merged meshes
  for (const [mat, geos] of batches) {
    if (!geos.length) continue
    const merged = mergeGeosSafe(geos)
    const mesh = new THREE.Mesh(merged, mat)
    mesh.castShadow = mat !== wireMat && mat !== windowMat && mat !== lampGlowMat && mat !== stripMat
    mesh.receiveShadow = mesh.castShadow
    group.add(mesh)
    if (mat !== wireMat && mat !== windowMat && mat !== lampGlowMat && mat !== stripMat) {
      mesh.userData.surf = surfOf.get(mat) ?? 'wall'
      raycastMeshes.push(mesh)
    } else {
      mesh.renderOrder = mat === stripMat ? 1 : 0
    }
  }
  for (const s of signs) group.add(s)

  return { group, raycastMeshes }
}

// ---------------- parapets / cornices ----------------
function buildParapets() {
  // big-mass cornices
  const caps: Array<[number, number, number, number, number, number]> = [
    [14, 4.25, 19, 12.8, 0.5, 22.8],    // T NE building
    [30, 5.3, -43, 36.8, 0.6, 6.8],    // block H
    [-35, 5.3, -44, 26.8, 0.6, 4.8],   // block I
    [-42, 6.3, 3, 16.8, 0.6, 42.8],    // SW city block
    [-42, 4.3, 35, 16.8, 0.6, 22.8],   // block K
    [-30, 6.3, 41, 8.8, 0.6, 10.8],    // T back decor
    [34, 4.3, 21, 8.8, 0.6, 26.8],     // east shoulder
    [34, 4.3, 41, 28.8, 0.6, 10.8],    // SE corner mass
    [45, 4.3, -9, 6.8, 0.6, 34.8],     // long east block
    [24, 4.3, -6.5, 26.8, 0.6, 14.8],  // block D
    [26, 4.3, 1, 22.8, 0.6, 14.8],     // cat corner fill
    [-16, 4.3, 16.5, 20.8, 0.6, 15.8], // block A2
    [-10, 4.3, 27, 16.8, 0.6, 6.8],    // block A (upper tunnel mass)
  ]
  for (const [x, y, z, w, h, d] of caps) pushSurf(boxGeo(w, h, d, x, y, z), 'brick')
  // lane wall caps
  const wallCaps: Array<[number, number, number, number, number, number]> = [
    [8, 4.2, 12, 1.3, 0.4, 36.5],       // mid east wall upper
    [8, 4.2, -19.5, 1.3, 0.4, 13.4],    // mid east wall lower
    [-6, 4.2, 10.5, 1.3, 0.4, 39.5],    // mid west wall
    [-14, 4.2, -36.5, 1.3, 0.4, 19.5],  // CT west wall
    [-34, 4.2, 4, 1.3, 0.4, 40.5],      // tunnels west wall
    [-26, 4.2, 4, 1.3, 0.4, 40.5],      // tunnels east wall
    [-18, 3.7, -27, 8.8, 0.4, 1.3],     // B doors corridor south
    [-18, 3.7, -21, 8.8, 0.4, 1.3],     // B doors corridor north
    [30, 4.2, -8, 1.3, 0.4, 20.5],      // long west wall
    [34, 3.45, 8, 8.8, 0.45, 1.4],      // long doors lintel band
    [10, 4.25, -31, 4.9, 0.5, 6.8],     // block F + ramp head
    [10, 4.25, -24, 4.9, 0.5, 4.8],     // pocket fill
    [11.5, 4.2, -13, 7.4, 0.4, 1.3],    // cat north wall cap
    [17, 4.2, -15.5, 1.3, 0.4, 5.4],    // cat stairs east wall
    [-16, 4.25, -20, 20.8, 0.5, 2.8],   // window room south mass
    [-16, 4.25, -12.5, 20.8, 0.5, 7.8], // window room north mass
    [-24, 4.25, -34.5, 4.9, 0.5, 15.8], // B solid fill
    [-18, 4.25, -34.5, 8.9, 0.5, 15.8], // block C
  ]
  for (const [x, y, z, w, h, d] of wallCaps) pushSurf(boxGeo(w, h, d, x, y, z), 'brick')
  // perimeter coping
  const perim: Array<[number, number, number, number, number, number]> = [
    [-1, 6.3, -46, 98.9, 0.6, 1.5],
    [-1, 6.3, 46, 98.9, 0.6, 1.5],
    [48, 6.3, 0, 1.5, 0.6, 93],
    [-50, 6.3, 0, 1.5, 0.6, 93],
  ]
  for (const [x, y, z, w, h, d] of perim) pushSurf(boxGeo(w, h, d, x, y, z), 'brick')
}

// ---------------- arches over passages ----------------
function buildArches() {
  const arches: Array<[number, number, number, number, number, number, boolean]> = [
    // cx, cz, ySpring, span, rise, thick, alongZ
    [2.1, -9, 3.0, 5.0, 0.55, 1.0, false],    // mid doors
    [34, 8, 3.3, 8.8, 0.9, 1.0, false],       // long doors
    [5, 30, 3.3, 6.8, 0.7, 1.0, false],       // T mid entrance
    [-22, -24, 3.5, 6.4, 0.6, 1.0, true],     // B doors west mouth
    [-14, -24, 3.5, 6.4, 0.6, 1.0, true],     // B doors east mouth
    [-30, 24, 3.3, 8.4, 0.8, 1.2, false],     // tunnel south entrance
    [-30, -16, 3.3, 8.4, 0.8, 1.0, false],    // tunnel north exit
    [-26, -17.5, 3.3, 3.6, 0.45, 1.0, true],  // window room B exit
  ]
  for (const [cx, cz, ys, s, r, t, az] of arches) {
    for (const g of archGeos(cx, cz, ys, s, r, t, az)) pushSurf(g, 'brick')
  }
}

// ---------------- barrels ----------------
function buildBarrels() {
  const spots: Array<[number, number, number?]> = [
    [-8.5, 33.5], [-9.4, 34.6], [18.6, 33.2],
    [7.3, -11.8], [-5.3, 21.5], [-5.3, 22.6],
    [31, -16.8], [30.7, 6.6], [44.7, -2.5],
    [13.3, -27.2, 2], [45.9, -38.9, 2], [16, -38.7, 2],
    [-13.3, -33.5], [6.9, -40.2],
    [-46.9, -25.5], [-47.1, -26.6], [-23.4, -30.2], [-28.2, -23.4],
    [-33.2, 9], [-27, 17.8], [-33.3, -13.8],
  ]
  for (const [x, z, y = 0] of spots) {
    pushSurf(cylGeo(0.34, 0.92, x, y + 0.46, z), 'metal')
    // top rim ring detail
    pushSurf(cylGeo(0.36, 0.06, x, y + 0.92, z), 'metal')
  }
}

// ---------------- rooftop clutter (unreachable roofs) ----------------
function buildRooftopClutter() {
  const acs: Array<[number, number, number]> = [
    [20, 5.4, -43], [32, 5.4, -44],
    [12, 4.4, 12], [16.5, 4.4, 24],
    [-46, 4.4, 28], [-38, 4.4, 40],
    [-46, 6.4, -10], [-30, 6.4, 39],
    [30, 4.4, 40], [-30, 5.4, -44],
  ]
  for (const [x, y, z] of acs) pushSurf(boxGeo(1.15, 0.85, 1.15, x, y, z), 'concrete')
  const tanks: Array<[number, number, number, number]> = [
    [40, 6.2, -43.5, 1.1], [19, 4.95, 28.5, 0.9], [-44, 4.95, 42, 0.9],
    [-38, 6.95, 14, 0.9], [42, 4.95, 40, 1.0], [44, 4.95, 20, 0.9], [-44, 5.95, -44, 0.9],
  ]
  for (const [x, y, z, r] of tanks) {
    pushSurf(cylGeo(r, r * 2.1, x, y, z), 'metal')
    pushSurf(cylGeo(r * 1.12, 0.12, x, y + r * 1.05, z), 'metal')
  }
  const roofCrates: Array<[number, number, number, number]> = [
    [15, 5.85, -44.5, 1.6], [9, 4.5, 15, 0.9], [-47, 6.85, 2, 1.5], [23, 4.5, 43, 1.3],
  ]
  for (const [x, y, z, s] of roofCrates) pushSurf(boxGeo(s, s, s, x, y, z), 'crate')
}

// ---------------- windows (inset + frames + some shutters) ----------------
function buildWindows() {
  /** facing: normal direction of the wall face the window sits on.
   *  pos = position of window CENTER on that face (slightly proud). */
  const wins: Array<[number, number, number, 'n' | 's' | 'e' | 'w', boolean]> = [
    // T NE building west face (mid lane)
    [7.53, 2.2, 13, 'w', true], [7.53, 2.2, 19, 'w', false], [7.53, 2.2, 25, 'w', true],
    // mid west wall east face
    [-5.53, 2.2, 5, 'e', false], [-5.53, 2.2, 13, 'e', true], [-5.53, 2.2, 21, 'e', false],
    // block A west face (T spawn west)
    [-26.47, 2.2, 27, 'w', false],
    // CT west wall east face
    [-13.53, 2.2, -30, 'e', false], [-13.53, 2.2, -36, 'e', true], [-13.53, 2.2, -42, 'e', false],
    // block H north face (A site)
    [18, 3.6, -39.53, 's', false], [26, 3.6, -39.53, 's', false], [34, 3.6, -39.53, 's', true],
    // block I north face (B site)
    [-30, 3.6, -41.53, 's', false], [-38, 3.6, -41.53, 's', true],
    // long west wall (long lane)
    [29.53, 2.3, -9, 'w', false], [29.53, 2.3, -3, 'w', true],
    // B solid fill west face (B site)
    [-26.47, 2.4, -35, 'w', false], [-26.47, 2.4, -30, 'w', true],
    // window room corridor walls
    [-12, 2.5, -15.55, 's', false], [-20, 2.5, -18.45, 'n', false],
    // long east block west face
    [41.53, 2.2, -8, 'w', false], [41.53, 2.2, -18, 'w', true],
    // east shoulder west face (outside long)
    [39.53, 2.2, 16, 'w', false],
    // SE mass north face (T spawn east)
    [26, 2.2, 35.55, 'n', false], [38, 2.2, 35.55, 'n', true],
  ]
  for (const [x, y, z, face, shutters] of wins) {
    // dark inset pane (thin box)
    const rotY = face === 'w' ? -Math.PI / 2 : face === 'e' ? Math.PI / 2 : face === 'n' ? Math.PI : 0
    pushMat(boxGeo(1.34, 1.64, 0.07, x, y, z, rotY), windowMat)
    // frame bars (plank)
    const fw = 0.14, fh = 1.78, fd = 0.16
    const off = 0.06
    if (face === 'w' || face === 'e') {
      const s = face === 'w' ? -off : off
      pushSurf(boxGeo(fd, fh, fw, x, y, z - 0.72, rotY), 'plank')
      pushSurf(boxGeo(fd, fh, fw, x, y, z + 0.72, rotY), 'plank')
      pushSurf(boxGeo(fd, fw, 1.6, x, y + 0.86, z, rotY), 'plank')
      pushSurf(boxGeo(fd, fw, 1.6, x, y - 0.86, z, rotY), 'concrete')
      // mullion cross
      pushSurf(boxGeo(fd, fw, 0.06, x, y, z, rotY), 'plank')
      pushSurf(boxGeo(fd, 1.58, 0.05, x, y, z, rotY), 'plank')
      if (shutters) {
        pushSurf(boxGeo(0.06, 1.5, 0.62, x + s * 1.4, y, z - 0.95, 0, 0.42), 'plank')
        pushSurf(boxGeo(0.06, 1.5, 0.62, x + s * 1.4, y, z + 0.95, 0, -0.42), 'plank')
      }
    } else {
      const s = face === 'n' ? -off : off
      pushSurf(boxGeo(fw, fh, fd, x - 0.72, y, z, rotY), 'plank')
      pushSurf(boxGeo(fw, fh, fd, x + 0.72, y, z, rotY), 'plank')
      pushSurf(boxGeo(1.6, fw, fd, x, y + 0.86, z, rotY), 'plank')
      pushSurf(boxGeo(1.6, fw, fd, x, y - 0.86, z, rotY), 'concrete')
      pushSurf(boxGeo(0.06, fw, fd, x, y, z, rotY), 'plank')
      pushSurf(boxGeo(0.05, 1.58, fd, x, y, z, rotY), 'plank')
      if (shutters) {
        pushSurf(boxGeo(0.62, 1.5, 0.06, x - 0.95, y, z + s * 1.4, 0.42, 0), 'plank')
        pushSurf(boxGeo(0.62, 1.5, 0.06, x + 0.95, y, z + s * 1.4, -0.42, 0), 'plank')
      }
    }
  }
}

// ---------------- sand piles ----------------
function buildSandPiles() {
  const piles: Array<[number, number, number]> = [
    [-5.2, 10.8, 0.9], [7, 24, 0.8], [18.7, 9.5, 0.9],
    [41, 0.8, 0.8], [-46.5, -19.2, 1.0], [-13, -28.8, 0.8],
    [-33.1, 25.5, 1.1], [-26.9, 26.2, 0.8], [7.2, -24, 0.85], [-33, 39, 1.0],
  ]
  for (const [x, z, r] of piles) {
    pushSurf(sphGeo(r, r * 0.3, r, x, r * 0.16, z), 'sand')
  }
}

// ---------------- pallets + small crates ----------------
function buildPallets() {
  const spots: Array<[number, number, number?]> = [
    [18.5, 35.2], [-12.8, -43.6], [6.6, 27.5],
    [-45.2, -17.6], [41, 6.7], [-31.5, -22.5],
  ]
  for (const [x, z, y = 0] of spots) {
    pushSurf(boxGeo(1.15, 0.09, 1.15, x, y + 0.045, z), 'plank')
    pushSurf(boxGeo(0.75, 0.75, 0.75, x, y + 0.465, z), 'crate')
  }
}

// ---------------- overhead wires ----------------
function buildWires() {
  const poles: Array<[number, number]> = [
    [12, 34.5], [-33.5, 29.5], [43.5, 11.5], [-46.5, -20.5], [-12.5, -25.5],
  ]
  for (const [x, z] of poles) {
    pushSurf(cylGeo(0.09, 5.2, x, 2.6, z), 'dark')
    pushSurf(boxGeo(1.7, 0.1, 0.1, x, 5.05, z), 'dark')
    pushSurf(cylGeo(0.05, 0.14, x - 0.7, 4.98, z), 'dark')
    pushSurf(cylGeo(0.05, 0.14, x + 0.7, 4.98, z), 'dark')
  }
  const wires: Array<[THREE.Vector3, THREE.Vector3, number]> = [
    [v(12, 5.05, 34.5), v(9, 4.4, 8.5), 1.2],
    [v(12, 5.05, 34.5), v(-2, 4.2, 30), 0.9],
    [v(-33.5, 5.05, 29.5), v(-26, 4.2, 24.5), 1.0],
    [v(43.5, 5.05, 11.5), v(38, 4.2, 7.5), 1.0],
    [v(43.5, 5.05, 11.5), v(41, 4.3, 18), 1.1],
    [v(-46.5, 5.05, -20.5), v(-24, 4.2, -27), 1.1],
    [v(-46.5, 5.05, -20.5), v(-34, 5.8, -17.5), 1.0],
    [v(-12.5, 5.05, -25.5), v(-14, 4.2, -30), 0.9],
    [v(-6, 4.2, 24), v(8, 4.2, 14), 1.0],
  ]
  for (const [a, b, sag] of wires) {
    const mid = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, -sag, 0))
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
    pushMat(new THREE.TubeGeometry(curve, 18, 0.016, 4), wireMat)
  }
}
function v(x: number, y: number, z: number) { return new THREE.Vector3(x, y, z) }

// ---------------- skyline (outside the playfield) ----------------
function buildSkyline() {
  // stepped crowns on the existing decor towers
  pushSurf(boxGeo(11, 0.7, 11, -58, 12.35, -20), 'brick')
  pushSurf(boxGeo(6, 3.6, 6, -58, 14.5, -20), 'wall')
  pushSurf(boxGeo(9, 0.7, 9, -58, 9.35, 10), 'brick')
  pushSurf(boxGeo(11, 0.7, 11, 56, 11.35, 0), 'brick')
  pushSurf(cylGeo(1.2, 2.4, 56, 12.9, 0), 'metal')
  pushSurf(boxGeo(13, 0.7, 9, -20, 10.35, 54), 'brick')
  pushSurf(boxGeo(11, 0.7, 9, 10, 8.35, 54), 'brick')
  // windows on tower faces visible from inside the map
  const towerWins: Array<[number, number, number, 'n' | 's' | 'e' | 'w']> = [
    [-52.4, 4, -20, 'e'], [-52.4, 8, -20, 'e'], [-52.4, 11, -20, 'e'],
    [-52.4, 3.5, 10, 'e'], [-52.4, 7, 10, 'e'],
    [52.4, 4, 0, 'w'], [52.4, 8, 0, 'w'],
    [-20, 4, 49.6, 'n'], [10, 3.5, 49.6, 'n'],
  ]
  for (const [x, y, z, face] of towerWins) {
    const rotY = face === 'w' ? -Math.PI / 2 : face === 'e' ? Math.PI / 2 : face === 'n' ? Math.PI : 0
    pushMat(boxGeo(1.3, 1.6, 0.07, x, y, z, rotY), windowMat)
  }
  // minarets (Dust2 skyline flavor)
  minaret(-56, 30)
  minaret(54, -36, 0.85)
  // low city blocks ringing the map
  const ring: Array<[number, number, number, number]> = [
    [-44, -53, 10, 5], [-32, -53, 9, 3.5], [-20, -53, 11, 4.5], [-8, -53, 9, 6],
    [4, -53, 12, 3.5], [16, -53, 9, 5], [28, -53, 10, 4], [40, -53, 9, 5.5],
    [-40, 53, 10, 4], [-28, 53, 12, 5.5], [-16, 53, 9, 4], [-4, 53, 10, 3.5],
    [8, 53, 9, 5], [20, 53, 11, 4.5], [32, 53, 9, 3.5], [44, 53, 10, 5],
    [55, -42, 9, 4.5], [55, -26, 10, 6], [55, -12, 9, 3.5], [55, 14, 10, 5], [55, 28, 9, 4],
    [-55, -38, 10, 5], [-55, -24, 9, 4], [-55, -10, 11, 5.5], [-55, 16, 9, 4], [-55, 40, 10, 5],
  ]
  for (const [x, z, d, h] of ring) pushSurf(boxGeo(9 + (Math.abs(x + z) % 3), h, d, x, h / 2, z), 'wall')
}

function minaret(x: number, z: number, s = 1) {
  pushSurf(cylGeo(1.5 * s, 3.6 * s, x, 1.8 * s, z), 'wall')
  pushSurf(cylGeo(0.95 * s, 9.5 * s, x, 8 * s, z), 'wall')
  pushSurf(cylGeo(1.5 * s, 0.45 * s, x, 12.4 * s, z), 'wall')
  pushSurf(cylGeo(1.15 * s, 0.5 * s, x, 12.9 * s, z), 'wall')
  pushSurf(sphGeo(1.05 * s, 1.05 * s, 1.05 * s, x, 13.7 * s, z), 'wall')
  pushSurf(cylGeo(0.06, 2.2, x, 15.2 * s, z), 'metal')
}

// ---------------- street lamps + tunnel bulbs ----------------
function buildLamps() {
  const lamps: Array<[number, number, number, number]> = [
    // x, z, arm direction dx, dz
    [11, 33.5, 0, -1], [41.5, 12, -1, 0], [-12.8, -30, 1, 0],
  ]
  for (const [x, z, dx, dz] of lamps) {
    pushSurf(cylGeo(0.07, 4.6, x, 2.3, z), 'dark')
    pushSurf(boxGeo(1.1, 0.08, 0.08, x + dx * 0.55, 4.55, z + dz * 0.55, dz !== 0 ? Math.PI / 2 : 0), 'dark')
    pushMat(boxGeo(0.44, 0.18, 0.24, x + dx * 1.05, 4.47, z + dz * 1.05, dz !== 0 ? Math.PI / 2 : 0), lampGlowMat)
  }
  // hanging bulbs in tunnels + window corridor
  const bulbs: Array<[number, number, number]> = [
    [-30, 14, 2.9], [-30, 2, 2.9], [-30, -8, 2.9], [-16, -17.5, 2.95],
  ]
  for (const [x, z, y] of bulbs) {
    pushMat(cylGeo(0.02, 0.3, x, y + 0.15, z), wireMat)
    pushMat(sphGeo(0.09, 0.12, 0.09, x, y, z), lampGlowMat)
  }
}

// ---------------- dirt path strips ----------------
function buildStrips() {
  const strips: Array<[number, number, number, boolean]> = [
    // x, z, y, alongX
    [1, 22, 0.03, false], [1, 8, 0.03, false], [1, -5, 0.03, false],
    [-30, 18, 0.03, false], [-30, 6, 0.03, false], [-30, -6, 0.03, false],
    [35, 20, 0.03, false], [35, 5, 0.03, false], [35, -5, 0.03, false], [35, -15, 0.03, false],
    [0, -32, 0.03, false],
    [0, 37, 0.03, false],
    [14.5, -20, 2.08, false],
    [26, -33, 2.08, false],
    [-18, -24, 0.03, true],
    [-33, -29, 0.03, true],
    [-16, -17.5, 0.03, true],
  ]
  const geoList: THREE.BufferGeometry[] = []
  for (const [x, z, y, alongX] of strips) {
    const g = new THREE.PlaneGeometry(3.2, 9.6)
    g.applyMatrix4(M.makeRotationX(-Math.PI / 2))
    if (alongX) g.applyMatrix4(M.makeRotationY(Math.PI / 2))
    g.applyMatrix4(M.makeTranslation(x, y, z))
    geoList.push(g)
  }
  pushMat(mergeGeosSafe(geoList), stripMat)
}

// ---------------- painted signs ----------------
function buildSigns(): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  const add = (tex: THREE.Texture, x: number, y: number, z: number, w: number, h: number, rotY: number, rotZ = 0, opacity = 0.85) => {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3,
    })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    m.position.set(x, y, z)
    m.rotation.y = rotY
    if (rotZ) m.rotation.z = rotZ
    m.renderOrder = 2
    out.push(m)
  }
  const red = 'rgba(198,54,38,0.9)'
  const white = 'rgba(232,228,216,0.85)'
  // site letters on walls
  add(signTexture('A', red), 24, 3.3, -39.5, 2.6, 2.6, 0)
  add(signTexture('B', red), -34, 3.4, -41.5, 2.6, 2.6, 0)
  // zone labels
  add(signTexture('MID', white), 7.5, 2.6, 27.5, 1.8, 1.1, -Math.PI / 2)
  add(signTexture('LONG', white), 20.1, 1.8, 24, 1.6, 0.8, Math.PI / 2)
  add(signTexture('SHORT', white), 7.5, 2.6, -9.5, 1.7, 0.85, -Math.PI / 2)
  add(signTexture('TUNNELS', white), -26.5, 1.9, 27, 2.3, 0.9, -Math.PI / 2)
  add(signTexture('CT', white), -13.5, 2.8, -34, 1.5, 1.1, Math.PI / 2)
  add(signTexture('T', red), 0.5, 2.6, 30.5, 1.5, 1.2, 0)
  // direction arrows (rotation.z flips arrow direction in-plane)
  add(arrowSignTexture('rgba(214,178,52,0.9)'), 20.1, 2.8, 24, 1.1, 1.1, Math.PI / 2)          // long: north
  add(arrowSignTexture('rgba(214,178,52,0.9)'), 7.5, 3.6, -9.5, 1.0, 1.0, -Math.PI / 2, Math.PI) // short/cat: north
  add(arrowSignTexture('rgba(214,178,52,0.9)'), -26.5, 3.0, 27, 1.0, 1.0, -Math.PI / 2, Math.PI) // tunnels: north
  add(arrowSignTexture('rgba(214,178,52,0.9)'), 2, 2.7, -45.5, 1.0, 1.0, 0)                     // CT: A is east
  return out
}
