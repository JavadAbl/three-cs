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
    const tang = ((Math.PI - 2 * th1) * R) / N * 0.98 // butt-jointed voussoirs (0.98 = hairline mortar gap, no coplanar overlap)
    const radial = 0.55
    const isKey = Math.abs(th - Math.PI / 2) < (Math.PI - 2 * th1) / (2 * N)
    const L = isKey ? tang * 0.75 : tang
    const H = isKey ? radial + 0.14 : radial
    // alternate ring thickness (rusticated arch): neighbors never share a side plane,
    // so rotated-box corner interpenetration cannot z-fight
    const thickI = i % 2 === 0 ? thick : thick - 0.05
    const g = new THREE.BoxGeometry(L, H, thickI)
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
/** Edge parapet band ring on a roof (x0..x1, z0..z1, roof top at `top`).
 *  Flush with the wall faces — no overhang, no coplanar face pairs. */
function parapet(x0: number, x1: number, z0: number, z1: number, top: number) {
  const bw = 0.7, bh = 0.5
  const y = top + bh / 2
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  pushSurf(boxGeo(x1 - x0, bh, bw, cx, y, z0 + bw / 2), 'brick')            // min-z edge
  pushSurf(boxGeo(x1 - x0, bh, bw, cx, y, z1 - bw / 2), 'brick')            // max-z edge
  pushSurf(boxGeo(bw, bh, z1 - z0 - 2 * bw, x0 + bw / 2, y, cz), 'brick')   // min-x edge
  pushSurf(boxGeo(bw, bh, z1 - z0 - 2 * bw, x1 - bw / 2, y, cz), 'brick')   // max-x edge
}

function buildParapets() {
  // edge parapets on the big perimeter masses (roofs carry clutter — bands keep it clear)
  parapet(8, 20, 8, 30, 4)        // T NE building
  parapet(12, 47.55, -45.55, -40, 5)  // block H (walls eat 0.45 on N/E)
  parapet(-48, -22, -45.55, -42, 5)   // block I (north wall eats 0.45)
  parapet(-49.55, -34, -18, 24, 6)    // SW city block (west wall eats 0.45)
  parapet(-49.55, -34, 24, 45.55, 4)  // block K (west + south walls eat 0.45)
  parapet(-34, -26, 36, 45.55, 6)     // T back decor (south wall eats 0.45)
  parapet(40, 47.55, 8, 34, 4)        // east shoulder (east wall eats 0.45)
  parapet(20, 47.55, 36, 45.55, 4)    // SE corner mass (east + south walls eat 0.45)
  // full top slabs on interior filler masses (sized to the mass, no clutter up there,
  // z/x-split so adjacent slabs never share a coplanar top face)
  const caps: Array<[number, number, number, number, number, number]> = [
    [23.7, 4.3, -16.2, 13.4, 0.6, 20.4],   // block D (x 17..30.4, z -26.4..-6)
    [19.225, 4.3, 1.2, 23.25, 0.6, 14.4],  // cat corner fill (x 7.6..30.85)
    [45, 4.3, -9, 6.8, 0.6, 34.8],         // long east block
    [-16, 4.3, 16.3, 20.8, 0.6, 15.4],     // block A2 (z 8.6..24)
    [-16, 4.3, 27.2, 20.8, 0.6, 6.4],      // block A (z 24..30.4)
  ]
  for (const [x, y, z, w, h, d] of caps) pushSurf(boxGeo(w, h, d, x, y, z), 'brick')
  // lane wall caps
  const wallCaps: Array<[number, number, number, number, number, number]> = [
    [8, 4.2, 12.225, 1.3, 0.4, 36.95],  // mid east wall upper (z -6.25..30.7)
    [8, 4.2, -19.5, 1.3, 0.4, 13.4],    // mid east wall lower
    [-6, 4.2, 10.725, 1.3, 0.4, 39.95], // mid west wall (z -9.25..30.7)
    [-14, 4.2, -36.125, 1.3, 0.4, 18.75], // CT west wall (stops at perimeter wall face)
    [-33.6, 4.2, 4, 0.9, 0.4, 40.5],    // tunnels west wall (clear of SW block face)
    [-26, 4.2, 4, 1.3, 0.4, 40.5],      // tunnels east wall
    [-17.8, 3.7, -27, 8.4, 0.4, 1.3],   // B doors corridor south (clear of B fill)
    [-17.8, 3.7, -21.225, 8.4, 0.4, 0.55], // B doors corridor north (exposed strip only)
    [30, 4.2, -8, 1.3, 0.4, 20.5],      // long west wall
    [34, 3.45, 8, 7.1, 0.45, 0.8],      // long doors lintel band (between side walls)
    [10, 4.25, -31, 4.9, 0.5, 6.8],     // ramp head bridge (block F -> block G over the A ramp)
    [10, 4.25, -24, 4.9, 0.5, 4.8],     // pocket fill
    [12.5, 4.2, -13, 7.6, 0.4, 1.3],    // cat entry beam (x 8.7..16.3, clear of wall caps)
    [17, 4.2, -15.5, 1.3, 0.4, 5.4],    // cat stairs east wall cap
    [-16, 4.25, -20, 20.8, 0.5, 2.8],   // window room south mass
    [-16, 4.25, -12.5, 20.8, 0.5, 7.8], // window room north mass
    [-24.2, 4.25, -34.3, 4.4, 0.5, 15.4], // B solid fill (x -26.4..-22, z -42..-26.6, clear of block I)
    [-17.75, 4.25, -34.5, 8.3, 0.5, 15.8], // block C (x -21.9..-13.6, clear of block I face)
  ]
  for (const [x, y, z, w, h, d] of wallCaps) pushSurf(boxGeo(w, h, d, x, y, z), 'brick')
  // perimeter coping (N/S strips shortened — corners belong to the E/W strips, no overlap)
  const perim: Array<[number, number, number, number, number, number]> = [
    [-1, 6.3, -46, 95.8, 0.6, 1.5],
    [-1, 6.3, 46, 95.8, 0.6, 1.5],
    [48, 6.3, 0, 1.5, 0.6, 93],
    [-50, 6.3, 0, 1.5, 0.6, 93],
  ]
  for (const [x, y, z, w, h, d] of perim) pushSurf(boxGeo(w, h, d, x, y, z), 'brick')
}

// ---------------- arches over passages ----------------
function buildArches() {
  const arches: Array<[number, number, number, number, number, number, boolean]> = [
    // cx, cz, ySpring, span, rise, thick, alongZ — spans match the ACTUAL openings
    [2.1, -9, 3.0, 5.0, 0.55, 1.0, false],    // mid doors (springs rest on the 3m jamb wall tops)
    [34, 8, 3.3, 6.5, 0.9, 1.0, false],       // long doors (clear of side wall corners)
    [4.75, 30, 3.3, 5.0, 0.7, 1.0, false],    // T mid entrance (clear of mid east wall corner)
    [-22, -24, 3.5, 5.1, 0.6, 1.0, true],     // B doors west mouth (corridor interior z -26.55..-21.45)
    [-14, -24, 3.5, 5.1, 0.6, 1.0, true],     // B doors east mouth
    [-30, 24, 3.7, 6.3, 0.6, 1.2, false],     // tunnel south entrance (springs on ceiling top)
    [-30, -16, 3.7, 6.3, 0.6, 1.0, false],    // tunnel north exit (springs on ceiling top)
    [-26, -17.75, 3.3, 1.6, 0.45, 1.0, true], // window room B exit (clear of ceiling lap + mass faces)
  ]
  for (const [cx, cz, ys, s, r, t, az] of arches) {
    for (const g of archGeos(cx, cz, ys, s, r, t, az)) pushSurf(g, 'brick')
  }
}

// ---------------- barrels ----------------
function buildBarrels() {
  // all spots verified clear of walls/crates (0.1m+ clearance, no buried phantoms)
  const spots: Array<[number, number, number?]> = [
    [-8.5, 33.5], [-9.4, 34.6], [18.6, 33.2],
    [7.3, -11.8], [-5.1, 21.5], [-5.1, 22.6],
    [31, -16.8], [30.95, 6.6], [40.6, -8],
    [13.3, -27.2, 2.05], [45.9, -38.9, 2.05], [16, -38.7, 2.05],
    [-13.1, -33.5], [6.9, -40.2],
    [-46.9, -25.5], [-47.1, -26.6], [-25.5, -25.5], [-28.2, -22.8],
    [-33.2, 9], [-27, 17.8], [-33.1, -13.8],
  ]
  for (const [x, z, y = 0] of spots) {
    pushSurf(cylGeo(0.34, 0.92, x, y + 0.46, z), 'metal')
    // top rim ring detail
    pushSurf(cylGeo(0.36, 0.06, x, y + 0.92, z), 'metal')
  }
}

// ---------------- rooftop clutter (unreachable roofs) ----------------
function buildRooftopClutter() {
  // sited clear of the edge parapet bands
  const acs: Array<[number, number, number]> = [
    [20, 5.4, -43], [32, 5.4, -44],
    [12, 4.4, 12], [16.5, 4.4, 24],
    [-46, 4.4, 28], [-38, 4.4, 40],
    [-46, 6.4, -10], [-30, 6.4, 39],
    [30, 4.4, 40], [-30, 5.4, -44],
  ]
  for (const [x, y, z] of acs) pushSurf(boxGeo(1.15, 0.85, 1.15, x, y, z), 'concrete')
  const tanks: Array<[number, number, number, number]> = [
    [40, 6.2, -43.5, 1.1], [18, 4.95, 27.5, 0.9], [-44, 4.95, 42, 0.9],
    [-38, 6.95, 14, 0.9], [42, 5.05, 40, 1.0], [44, 4.95, 20, 0.9], [-44, 5.95, -44, 0.9],
  ]
  for (const [x, y, z, r] of tanks) {
    pushSurf(cylGeo(r, r * 2.1, x, y, z), 'metal')
    pushSurf(cylGeo(r * 1.12, 0.12, x, y + r * 1.05, z), 'metal')
  }
  const roofCrates: Array<[number, number, number, number]> = [
    [15, 5.85, -44.5, 1.6], [9.6, 4.5, 15, 0.9], [-47, 6.85, 2, 1.5], [23, 4.65, 43, 1.3],
  ]
  for (const [x, y, z, s] of roofCrates) pushSurf(boxGeo(s, s, s, x, y, z), 'crate')
}

// ---------------- windows (pane + frames mounted flush on the wall face) ----------------
function buildWindows() {
  /** face = exact wall-face plane coordinate (x for 'e'/'w', z for 'n'/'s').
   *  Pane mounts flush on that face; frames sit proud of it. */
  const wins: Array<[number, number, number, 'n' | 's' | 'e' | 'w', boolean]> = [
    // mid east wall west face (mid lane — the T NE face at x=8 is behind this wall)
    [7.55, 2.2, 13, 'w', true], [7.55, 2.2, 19, 'w', false], [7.55, 2.2, 25, 'w', true],
    // mid west wall east face
    [-5.55, 2.2, 5, 'e', false], [-5.55, 2.2, 13, 'e', true], [-5.55, 2.2, 21, 'e', false],
    // block A west face (T spawn west)
    [-26, 2.2, 26.5, 'w', false],
    // CT west wall east face
    [-13.55, 2.2, -30, 'e', false], [-13.55, 2.2, -36, 'e', true], [-13.55, 2.2, -42, 'e', false],
    // block H north face (A site backdrop) — face = z plane, along = x
    [-40, 3.6, 18, 's', false], [-40, 3.6, 26, 's', false], [-40, 3.6, 34, 's', true],
    // block I north face (B site backdrop)
    [-42, 3.6, -30, 's', false], [-42, 3.6, -38, 's', true],
    // long west wall east face (long lane — west face is buried in block D)
    [30.45, 2.3, -9, 'e', false], [30.45, 2.3, -3, 'e', true],
    // B solid fill west face (B site)
    [-26, 2.4, -35, 'w', false], [-26, 2.4, -30, 'w', true],
    // window room corridor (y low — ceiling slab bottom at 2.95)
    [-19, 1.9, -12, 's', false],   // south mass north face (pane into corridor, +Z)
    [-16, 1.9, -20, 'n', false],   // north mass south face (pane into corridor, -Z)
    // long east block west face
    [42, 2.2, -8, 'w', false], [42, 2.2, -18, 'w', true],
    // east shoulder west face (outside long)
    [40, 2.2, 16, 'w', false],
    // SE mass north face (T spawn east)
    [36, 2.2, 26, 'n', false], [36, 2.2, 38, 'n', true],
  ]
  for (const [face, y, along, dir, shutters] of wins) {
    const horiz = dir === 'w' || dir === 'e'
    const rotY = dir === 'w' ? -Math.PI / 2 : dir === 'e' ? Math.PI / 2 : dir === 'n' ? Math.PI : 0
    const out = dir === 'w' ? -1 : dir === 'e' ? 1 : dir === 'n' ? -1 : 1 // outward normal sign
    const pp = face + out * 0.055 // pane plane (2cm clear of the wall face — no coplanar back face)
    const x = horiz ? pp : along
    const z = horiz ? along : pp
    // dark inset pane (thin box)
    pushMat(boxGeo(1.34, 1.64, 0.07, x, y, z, rotY), windowMat)
    // frame bars (plank) — along-wall lengths sized to butt between the verticals
    const fw = 0.14, fh = 1.78, fd = 0.16
    if (horiz) {
      pushSurf(boxGeo(fd, fh, fw, x, y, z - 0.72, rotY), 'plank')
      pushSurf(boxGeo(fd, fh, fw, x, y, z + 0.72, rotY), 'plank')
      pushSurf(boxGeo(1.26, fw, fd, x, y + 0.86, z, rotY), 'plank')
      pushSurf(boxGeo(1.26, fw, fd, x, y - 0.86, z, rotY), 'concrete')
      // mullion cross (proud of the pane; split vertical so pieces never overlap)
      pushSurf(boxGeo(1.2, fw, fd, x, y, z, rotY), 'plank')
      pushSurf(boxGeo(0.06, 0.64, fd, x, y + 0.4, z, rotY), 'plank')
      pushSurf(boxGeo(0.06, 0.64, fd, x, y - 0.4, z, rotY), 'plank')
      if (shutters) {
        pushSurf(boxGeo(0.06, 1.5, 0.62, x + out * 0.2, y, z - 0.98, 0, 0.2), 'plank')
        pushSurf(boxGeo(0.06, 1.5, 0.62, x + out * 0.2, y, z + 0.98, 0, -0.2), 'plank')
      }
    } else {
      pushSurf(boxGeo(fw, fh, fd, x - 0.72, y, z, rotY), 'plank')
      pushSurf(boxGeo(fw, fh, fd, x + 0.72, y, z, rotY), 'plank')
      pushSurf(boxGeo(1.26, fw, fd, x, y + 0.86, z, rotY), 'plank')
      pushSurf(boxGeo(1.26, fw, fd, x, y - 0.86, z, rotY), 'concrete')
      pushSurf(boxGeo(1.2, fw, fd, x, y, z, rotY), 'plank')
      pushSurf(boxGeo(0.06, 0.64, fd, x, y + 0.4, z, rotY), 'plank')
      pushSurf(boxGeo(0.06, 0.64, fd, x, y - 0.4, z, rotY), 'plank')
      if (shutters) {
        pushSurf(boxGeo(0.62, 1.5, 0.06, x - 0.98, y, z + out * 0.2, 0.2, 0), 'plank')
        pushSurf(boxGeo(0.62, 1.5, 0.06, x + 0.98, y, z + out * 0.2, -0.2, 0), 'plank')
      }
    }
  }
}

// ---------------- sand piles ----------------
function buildSandPiles() {
  const piles: Array<[number, number, number]> = [
    [-4.6, 10.8, 0.9], [6.6, 24, 0.8], [24, 12, 0.9],
    [41, 0.8, 0.8], [-46.5, -19.2, 1.0], [-12.6, -29, 0.8],
    [-32.3, 25.5, 1.1], [-27.2, 26.2, 0.8], [6.5, -24, 0.85], [-24, 40, 1.0],
  ]
  for (const [x, z, r] of piles) {
    pushSurf(sphGeo(r, r * 0.3, r, x, r * 0.3, z), 'sand')
  }
}

// ---------------- pallets + small crates ----------------
function buildPallets() {
  const spots: Array<[number, number, number?]> = [
    [18.5, 35.2], [-12.8, -43.6], [6.6, 27.5],
    [-45.2, -18.7], [41, 6.7], [-31.5, -22.5],
  ]
  for (const [x, z, y = 0] of spots) {
    pushSurf(boxGeo(1.15, 0.09, 1.15, x, y + 0.045, z), 'plank')
    pushSurf(boxGeo(0.75, 0.75, 0.75, x, y + 0.465, z), 'crate')
  }
}

// ---------------- overhead wires ----------------
function buildWires() {
  const poles: Array<[number, number]> = [
    [12, 34.5], [-33, 29.5], [39.5, 14], [-46.5, -20.5], [-12.5, -25.5],
  ]
  for (const [x, z] of poles) {
    pushSurf(cylGeo(0.09, 5.2, x, 2.6, z), 'dark')
    pushSurf(boxGeo(1.7, 0.1, 0.1, x, 5.05, z), 'dark')
    pushSurf(cylGeo(0.05, 0.14, x - 0.7, 4.98, z), 'dark')
    pushSurf(cylGeo(0.05, 0.14, x + 0.7, 4.98, z), 'dark')
  }
  const wires: Array<[THREE.Vector3, THREE.Vector3, number]> = [
    // every endpoint anchored to a real structure top (pole / wall top / parapet)
    [v(12, 5.05, 34.5), v(9, 4.5, 8.5), 1.2],      // pole -> T NE roof parapet corner
    [v(12, 5.05, 34.5), v(-2, 4.1, 30), 0.9],      // pole -> T spawn wall top
    [v(-33, 5.05, 29.5), v(-26, 4.1, 24.5), 1.0],  // pole -> block A west face top
    [v(39.5, 5.05, 14), v(38, 4.1, 7.5), 1.0],     // pole -> long doors side wall top
    [v(39.5, 5.05, 14), v(40.35, 4.55, 19), 1.1],  // pole -> east shoulder parapet
    [v(-46.5, 5.05, -20.5), v(-24, 4.1, -27), 1.1],// pole -> B fill top corner
    [v(-46.5, 5.05, -20.5), v(-34, 4.1, -16.2), 1.0], // pole -> tunnel west wall top
    [v(-12.5, 5.05, -25.5), v(-14.1, 4.1, -30), 0.9], // pole -> CT west wall top
    [v(-6, 4.1, 24), v(8.05, 4.1, 14), 1.0],       // mid west wall top -> T NE corner
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
  // windows on tower faces visible from inside the map (flush on the real faces)
  const towerWins: Array<[number, number, number, 'n' | 's' | 'e' | 'w']> = [
    [-53, 4, -20, 'e'], [-53, 8, -20, 'e'], [-53, 11, -20, 'e'],
    [-54, 3.5, 10, 'e'], [-54, 7, 10, 'e'],
    [51, 4, 0, 'w'], [51, 8, 0, 'w'],
    [50, 4, -20, 'n'], [50, 3.5, 10, 'n'],
  ]
  for (const [face, y, along, dir] of towerWins) {
    const horiz = dir === 'w' || dir === 'e'
    const rotY = dir === 'w' ? -Math.PI / 2 : dir === 'e' ? Math.PI / 2 : dir === 'n' ? Math.PI : 0
    const out = dir === 'w' ? -1 : dir === 'e' ? 1 : dir === 'n' ? -1 : 1
    const pp = face + out * 0.035
    const x = horiz ? pp : along
    const z = horiz ? along : pp
    pushMat(boxGeo(1.3, 1.6, 0.07, x, y, z, rotY), windowMat)
  }
  // minarets (Dust2 skyline flavor)
  minaret(-56, 30)
  minaret(54, -34, 0.85)
  // low city blocks ringing the map — clear of the perimeter walls
  // (x rows at |x| 51.5..61.5, z rows at |z| 47..59 — no wall penetration)
  const ring: Array<[number, number, number, number]> = [
    [-44, -53, 10, 5], [-32, -53, 9, 3.5], [-20, -53, 11, 4.5], [-8, -53, 9, 6],
    [4, -53, 12, 3.5], [16, -53, 9, 5], [28, -53, 10, 4], [40, -53, 9, 5.5],
    [-44, 53, 10, 4.5], [-36, 53, 9, 3.5], [-8, 53, 9, 4], [-1, 53, 10, 3.5],
    [22, 53, 10, 5], [32, 53, 9, 3.5], [44, 53, 10, 5],
    [56, -42, 9, 4.5], [56, -26, 10, 6], [56, -12, 9, 3.5], [56, 14, 10, 5], [56, 28, 9, 4],
    [-56, -38, 10, 5], [-56, -30, 9, 4], [-56, -5, 11, 5.5], [-56, 20, 9, 4], [-56, 40, 10, 5],
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
    // x, z, arm direction dx, dz — poles stand in open ground, clear of walls
    [11, 33.5, 0, -1], [39, 14, -1, 0], [-12.8, -30, 1, 0],
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
    // x, z, y, alongX — y clears the surface slab it sits on (floor 0 / B slab 0.06 / A sand 2.05 / decal)
    [1, 22, 0.03, false], [1, 8, 0.03, false], [1, -5, 0.03, false],
    [-30, 18, 0.03, false], [-30, 6, 0.03, false], [-30, -6, 0.03, false],
    [35, 20, 0.03, false], [35, 5, 0.03, false], [35, -5, 0.03, false], [35, -15, 0.03, false],
    [0, -32, 0.03, false],
    [0, 37, 0.03, false],
    [14.5, -20, 2.08, false],
    [26, -33, 2.11, false],
    [-18, -24, 0.03, true],
    [-33, -29, 0.16, true],
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
  // site letters — flush on real wall faces, facing the site
  add(signTexture('A', red), 23, 3.3, -39.94, 2.6, 2.6, 0)            // block H north face (z -40)
  add(signTexture('B', red), -34, 3.4, -41.94, 2.6, 2.6, 0)           // block I north face (z -42)
  // zone labels — flush on the wall faces players see them from
  add(signTexture('MID', white), 7.49, 2.6, 27.5, 1.8, 1.1, -Math.PI / 2)     // mid east wall west face (x 7.55)
  add(signTexture('LONG', white), 20.06, 2.0, 24, 1.6, 0.8, Math.PI / 2)      // T NE east face (x 20)
  add(signTexture('SHORT', white), 7.51, 2.4, -14.5, 1.7, 0.85, -Math.PI / 2) // mid east lower wall west face
  add(signTexture('TUNNELS', white), -26.06, 1.9, 28.8, 2.3, 0.9, -Math.PI / 2) // block A west face (x -26, clear of window at z 27)
  add(signTexture('CT', white), -13.51, 2.8, -34, 1.5, 1.1, Math.PI / 2)      // CT west wall east face
  add(signTexture('T', red), 0.5, 2.6, 30.49, 1.5, 1.2, 0)                   // T spawn wall south face (z 30.45)
  // direction arrows (rotation.z flips arrow direction in-plane)
  add(arrowSignTexture('rgba(214,178,52,0.9)'), 20.06, 2.95, 24, 1.1, 1.1, Math.PI / 2)             // long: north
  add(arrowSignTexture('rgba(214,178,52,0.9)'), 7.51, 3.35, -14.5, 1.0, 1.0, -Math.PI / 2, Math.PI) // short/cat: north
  add(arrowSignTexture('rgba(214,178,52,0.9)'), -26.06, 2.85, 28.8, 1.0, 1.0, -Math.PI / 2, Math.PI)  // tunnels: north
  add(arrowSignTexture('rgba(214,178,52,0.9)'), 2, 2.7, -45.51, 1.0, 1.0, 0)                       // CT: A is east
  return out
}
