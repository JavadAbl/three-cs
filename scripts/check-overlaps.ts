// ============================================================
// Geometry overlap / ghost-mesh checker (multi-map detail audit)
// Detects:
//  1. Z-FIGHT    — coplanar same-facing overlapping triangle pairs (visible flicker)
//  2. PENETRATION— detail geometry punched >0.17m into solid map boxes (clipping)
//  3. BURIED     — detail triangles fully inside a solid (phantom meshes)
//  4. FLOATING   — window panes / signs not attached to any wall face
// Run: bun scripts/check-overlaps.ts [mapId]
// ============================================================
import './domstub'
import * as THREE from 'three'
import { MAPS, MAP_LIST } from '../src/game/mapdata'
import type { MapDef, MapId } from '../src/game/mapdata'
import { buildMap } from '../src/game/mapview'
import { buildDetails } from '../src/game/mapdetails'

// per-map mutable state
let solids: Array<{ min: THREE.Vector3; max: THREE.Vector3; id: string }> = []
let tris: Array<{ mesh: string; kind: string; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; n: THREE.Vector3 }> = []
let occluders: THREE.Mesh[] = []
let problems: string[] = []

function insideDepth(v: THREE.Vector3, s: { min: THREE.Vector3; max: THREE.Vector3 }): number {
  if (v.x <= s.min.x || v.x >= s.max.x || v.y <= s.min.y || v.y >= s.max.y || v.z <= s.min.z || v.z >= s.max.z) return 0
  return Math.min(v.x - s.min.x, s.max.x - v.x, v.y - s.min.y, s.max.y - v.y, v.z - s.min.z, s.max.z - v.z)
}
function distToSurface(v: THREE.Vector3, s: { min: THREE.Vector3; max: THREE.Vector3 }): number {
  const dx = Math.max(s.min.x - v.x, 0, v.x - s.max.x)
  const dy = Math.max(s.min.y - v.y, 0, v.y - s.max.y)
  const dz = Math.max(s.min.z - v.z, 0, v.z - s.max.z)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
function nearestSolidSurface(v: THREE.Vector3): { d: number; id: string } {
  let best = 1e9, id = ''
  for (const s of solids) {
    const d = distToSurface(v, s)
    if (d < best) { best = d; id = s.id }
  }
  return { d: best, id }
}
function maxPenetration(v: THREE.Vector3): { d: number; id: string } {
  let best = 0, id = ''
  for (const s of solids) {
    const d = insideDepth(v, s)
    if (d > best) { best = d; id = s.id }
  }
  return { d: best, id }
}

function classify(m: THREE.Mesh, isMap: boolean): string {
  if (isMap) return 'map'
  if (m.renderOrder === 1) return 'strip'
  if (m.renderOrder === 2) return 'sign'
  const mat = m.material as THREE.MeshBasicMaterial
  if (mat && (mat as unknown as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial) {
    const hex = mat.color?.getHex?.()
    if (hex === 0x14100b) return 'window'
    if (hex === 0x241f18) return 'wire'
    if (hex === 0xffeec8) return 'glow'
    return 'sign'
  }
  return 'prop'
}

function eat(mesh: THREE.Mesh, name: string, isMap: boolean) {
  const kind = classify(mesh, isMap)
  const geo = mesh.geometry
  const pos = geo.attributes.position as THREE.BufferAttribute
  const idx = geo.index
  const pa = pos.array as Float32Array
  const count = idx ? idx.count : pos.count
  for (let i = 0; i < count; i += 3) {
    const i0 = idx ? idx.getX(i) : i
    const i1 = idx ? idx.getX(i + 1) : i + 1
    const i2 = idx ? idx.getX(i + 2) : i + 2
    const a = new THREE.Vector3(pa[i0 * 3], pa[i0 * 3 + 1], pa[i0 * 3 + 2]).applyMatrix4(mesh.matrixWorld)
    const b = new THREE.Vector3(pa[i1 * 3], pa[i1 * 3 + 1], pa[i1 * 3 + 2]).applyMatrix4(mesh.matrixWorld)
    const c = new THREE.Vector3(pa[i2 * 3], pa[i2 * 3 + 1], pa[i2 * 3 + 2]).applyMatrix4(mesh.matrixWorld)
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
    tris.push({ mesh: name, kind, a, b, c, n })
  }
}

function isTransparentOverlay(m: THREE.Mesh): boolean {
  const mat = m.material as THREE.Material & { transparent?: boolean; isMeshBasicMaterial?: boolean }
  if (m.renderOrder === 1 || m.renderOrder === 2) return true
  if (mat.isMeshBasicMaterial && mat.transparent) return true
  if (mat.isMeshBasicMaterial) {
    const hex = (m.material as THREE.MeshBasicMaterial).color?.getHex?.()
    if (hex === 0x241f18 || hex === 0xffeec8) return true
  }
  return false
}

function checkMap(def: MapDef): void {
  solids = []
  tris = []
  occluders = []
  problems = []
  const scene = new THREE.Scene()
  const map = buildMap(scene, def)
  const det = buildDetails(def)
  scene.add(det.group)
  scene.updateMatrixWorld(true)

  solids = def.boxes.map((b, i) => ({
    id: `box${i}(${b.x},${b.y},${b.z},${b.w},${b.d},${b.h})`,
    min: new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2),
    max: new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2),
  }))

  for (const child of map.group.children) {
    if ((child as THREE.Mesh).isMesh) eat(child as THREE.Mesh, `map:${(child as THREE.Mesh).material?.type}`, true)
  }
  for (const child of det.group.children) {
    if ((child as THREE.Mesh).isMesh) eat(child as THREE.Mesh, `det:${classify(child as THREE.Mesh, false)}`, false)
  }
  console.log(`  triangles: map+details = ${tris.length}, solids = ${solids.length}`)

  for (const child of map.group.children) {
    const m = child as THREE.Mesh
    if (m.isMesh && !isTransparentOverlay(m)) occluders.push(m)
  }
  for (const child of det.group.children) {
    const m = child as THREE.Mesh
    if (m.isMesh && !isTransparentOverlay(m)) occluders.push(m)
  }
  const ray = new THREE.Raycaster()
  ray.far = 0.65

  // ---------- 1. Z-FIGHT ----------
  const EPS_PAIR = 0.012
  const planes = new Map<string, Array<{ t: (typeof tris)[number]; d: number }>>()
  for (const t of tris) {
    const key = `${Math.round(t.n.x * 50)},${Math.round(t.n.y * 50)},${Math.round(t.n.z * 50)}`
    const d = t.n.dot(t.a)
    if (!planes.has(key)) planes.set(key, [])
    planes.get(key)!.push({ t, d })
  }
  let zfPairs = 0, zfHidden = 0
  for (const [, list] of planes) {
    if (list.length < 2) continue
    list.sort((p, q) => p.d - q.d)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].d - list[i].d > EPS_PAIR) break
        const A = list[i].t, B = list[j].t
        const vs = [A.a, A.b, A.c]
        if (vs.some(p => p.distanceToSquared(B.a) < 1e-8 || p.distanceToSquared(B.b) < 1e-8 || p.distanceToSquared(B.c) < 1e-8)) continue
        const n = A.n
        const ax = Math.abs(n.x) > 0.9 ? 0 : Math.abs(n.y) > 0.9 ? 1 : 2
        const u = ax === 0 ? 1 : 0, w = ax === 2 ? 1 : 2
        const PA = [A.a, A.b, A.c].map(v => [v.getComponent(u), v.getComponent(w)])
        const PB = [B.a, B.b, B.c].map(v => [v.getComponent(u), v.getComponent(w)])
        let separated = false
        const axes: Array<[number, number]> = []
        for (let k = 0; k < 3; k++) {
          const p1 = PA[k], p2 = PA[(k + 1) % 3]
          axes.push([-(p2[1] - p1[1]), p2[0] - p1[0]])
        }
        for (let k = 0; k < 3; k++) {
          const p1 = PB[k], p2 = PB[(k + 1) % 3]
          axes.push([-(p2[1] - p1[1]), p2[0] - p1[0]])
        }
        for (const [ex, ey] of axes) {
          if (Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9) continue
          let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity
          for (const p of PA) { const d = p[0] * ex + p[1] * ey; amin = Math.min(amin, d); amax = Math.max(amax, d) }
          for (const p of PB) { const d = p[0] * ex + p[1] * ey; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d) }
          if (amax < bmin - 1e-9 || bmax < amin - 1e-9) { separated = true; break }
        }
        if (separated) continue
        if (n.y < -0.9 && Math.abs(A.a.y) < 0.05) continue
        const amin = [Infinity, Infinity], amax = [-Infinity, -Infinity]
        const bmin = [Infinity, Infinity], bmax = [-Infinity, -Infinity]
        for (const v of [A.a, A.b, A.c]) { amin[0] = Math.min(amin[0], v.getComponent(u)); amax[0] = Math.max(amax[0], v.getComponent(u)); amin[1] = Math.min(amin[1], v.getComponent(w)); amax[1] = Math.max(amax[1], v.getComponent(w)) }
        for (const v of [B.a, B.b, B.c]) { bmin[0] = Math.min(bmin[0], v.getComponent(u)); bmax[0] = Math.max(bmax[0], v.getComponent(u)); bmin[1] = Math.min(bmin[1], v.getComponent(w)); bmax[1] = Math.max(bmax[1], v.getComponent(w)) }
        const ox = Math.min(amax[0], bmax[0]) - Math.max(amin[0], bmin[0])
        const oz = Math.min(amax[1], bmax[1]) - Math.max(amin[1], bmin[1])
        if (ox * oz < 0.004) continue
        zfPairs++
        const pu = (Math.max(amin[0], bmin[0]) + Math.min(amax[0], bmax[0])) / 2
        const pw = (Math.max(amin[1], bmin[1]) + Math.min(amax[1], bmax[1])) / 2
        const cen = new THREE.Vector3()
        cen.setComponent(u, pu); cen.setComponent(w, pw)
        cen.setComponent(ax, A.a.getComponent(ax))
        const probe = cen.clone().addScaledVector(n, 0.06)
        let occluded = false
        for (const s of solids) {
          if (probe.x >= s.min.x && probe.x <= s.max.x && probe.y >= s.min.y && probe.y <= s.max.y && probe.z >= s.min.z && probe.z <= s.max.z) { occluded = true; break }
        }
        if (!occluded) {
          ray.set(cen.clone().addScaledVector(n, 0.7), n.clone().negate())
          occluded = ray.intersectObjects(occluders, false).length > 0
        }
        if (occluded) { zfHidden++; continue }
        problems.push(`Z-FIGHT  [${A.mesh}|${B.mesh}] normal(${n.x.toFixed(1)},${n.y.toFixed(1)},${n.z.toFixed(1)}) at (${cen.x.toFixed(1)},${cen.y.toFixed(1)},${cen.z.toFixed(1)}) overlap ${ox.toFixed(1)}x${oz.toFixed(1)}m`)
      }
    }
  }
  console.log(`  zfight pairs considered: ${zfPairs}, occluded(hidden, ok): ${zfHidden}`)

  // ---------- 2/3/4. penetration, buried, floating ----------
  let pen = 0, bur = 0, flo = 0
  const seen = new Set<string>()
  for (const t of tris) {
    if (t.kind === 'wire' || t.kind === 'glow' || t.kind === 'strip' || t.kind === 'map') continue
    const verts = [t.a, t.b, t.c]
    for (const v of verts) {
      const { d, id } = maxPenetration(v)
      if (d > 0.17) {
        const key = `P:${t.mesh}:${id}`
        if (!seen.has(key)) { seen.add(key); pen++; problems.push(`CLIP    [${t.mesh}] vertex (${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}) ${d.toFixed(2)}m into ${id}`) }
      }
    }
    let buriedIn: string | null = null
    for (const s of solids) {
      if (insideDepth(t.a, s) > 0.05 && insideDepth(t.b, s) > 0.05 && insideDepth(t.c, s) > 0.05) { buriedIn = s.id; break }
    }
    if (buriedIn) {
      const key = `B:${t.mesh}:${buriedIn}`
      if (!seen.has(key)) { seen.add(key); bur++; problems.push(`BURIED  [${t.mesh}] triangle fully inside ${buriedIn} (phantom mesh)`) }
      continue
    }
    if (t.kind === 'window' || t.kind === 'sign') {
      const inField = verts.every(v => Math.abs(v.x) <= 50.5 && Math.abs(v.z) <= 47)
      if (inField) {
        for (const v of verts) {
          const { d } = nearestSolidSurface(v)
          if (d > 0.12) {
            const key = `F:${t.mesh}`
            if (!seen.has(key)) { seen.add(key); flo++; problems.push(`FLOATING[${t.mesh}] vertex (${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}) is ${d.toFixed(2)}m from any wall (detached pane/sign)`) }
            break
          }
        }
      }
    }
  }

  console.log(`  clip:${pen} buried:${bur} floating:${flo}`)
  if (problems.length) {
    console.log(`  PROBLEMS (${problems.length}):`)
    for (const p of problems) console.log('    ' + p)
  } else {
    console.log('  ALL CHECKS PASSED — no z-fights, no clipping, no buried or floating detail geometry')
  }
}

// ---------- main ----------
const only = (process.argv[2] as MapId | undefined) ?? null
let totalProblems = 0
for (const { id } of MAP_LIST) {
  if (only && id !== only) continue
  console.log(`\n===== MAP ${MAPS[id].name} =====`)
  const before = problems.length
  checkMap(MAPS[id])
  totalProblems += problems.length - before
}
console.log(totalProblems === 0 ? '\nALL MAPS CLEAN' : `\n${totalProblems} TOTAL PROBLEMS`)
process.exit(totalProblems === 0 ? 0 : 1)
