// Builds the map scene in Three.js from shared map data
import * as THREE from 'three'
import { MAPS } from './mapdata'
import type { MapDef, Box } from './mapdata'
import { skyMesh, siteDecal, surfaceMaterial, pbrMapScope } from './textures'

export interface MapBuild {
  group: THREE.Group
  colliders: Array<{ min: THREE.Vector3; max: THREE.Vector3; box: Box }>
  raycastMeshes: THREE.Object3D[]   // for bullet impact raycasts
  sky: THREE.Mesh                   // slowly rotates (cloud drift)
}

// UV density: texture meters per tile (kept from v4 so density matches server-shared geometry)
const UV_PER_M = 0.35

// Task 76 — per-face texture phase: every box face starts at a deterministic
// pseudo-random phase of the (wrapping) surface texture instead of uv (0,0),
// so no two boxes/regions show the same slice of the tile. Offset magnitude =
// one wall tile in UV units (3 m x 0.35); for other tile sizes that is simply
// a random fraction of their period — any non-zero offset shifts the phase.
// Hashed from box center + face index: stable across reloads, SSR-safe (no
// Math.random). Exported for mapdetails' own boxGeo.
const PHASE_UV = 1.05 // 3 m wall tile * UV_PER_M
export function facePhase(x: number, y: number, z: number, f: number, k: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ ((f + 1) * 40503 + (k + 1) * 12289)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function boxToGeo(b: Box): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1)
  const uv = g.attributes.uv as THREE.BufferAttribute
  const faceDims = [
    [b.d, b.h], [b.d, b.h],  // x faces
    [b.w, b.d], [b.w, b.d],  // y faces
    [b.w, b.h], [b.w, b.h],  // z faces
  ]
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceDims[f]
    const ou = facePhase(b.x, b.y, b.z, f, 0) * PHASE_UV
    const ov = facePhase(b.x, b.y, b.z, f, 1) * PHASE_UV
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      uv.setXY(i, uv.getX(i) * su * UV_PER_M + ou, uv.getY(i) * sv * UV_PER_M + ov)
    }
  }
  g.applyMatrix4(new THREE.Matrix4().makeScale(b.w, b.h, b.d))
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(b.x, b.y, b.z))
  return g
}

export function buildMap(scene: THREE.Scene, map: MapDef = MAPS.dust): MapBuild {
  const group = new THREE.Group()
  const colliders: MapBuild['colliders'] = []
  const raycastMeshes: THREE.Object3D[] = []

  // merge static boxes by material for performance
  const scope = pbrMapScope(map.id)   // Task 77: per-map texture identity
  const geosByTex = new Map<Box['tex'], THREE.BufferGeometry[]>()
  for (const b of map.boxes) {
    const g = boxToGeo(b)
    if (!geosByTex.has(b.tex)) geosByTex.set(b.tex, [])
    geosByTex.get(b.tex)!.push(g)
    colliders.push({
      min: new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2),
      max: new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2),
      box: b,
    })
  }

  if (!map.bsp) {
    for (const [tex, geos] of geosByTex) {
      const g = mergeGeosSafe(geos)
      const mat = surfaceMaterial(tex, scope)
      const mesh = new THREE.Mesh(g, mat)
      mesh.userData.isMap = true
      mesh.userData.surf = tex        // fx picks impact style (sparks vs dust)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      raycastMeshes.push(mesh)
    }
  }

  // BSP-converted map: real face geometry from geom.json (collision stays on boxes)
  if (map.bsp) {
    // boxes are collision-only — real faces render instead (avoids double-draw/z-fight)
    const geomUrl = map.bsp.geomUrl
    fetch(geomUrl).then(r => r.json()).then((data: {
      groups: Array<{ tex: string; pos: number[]; norm: number[]; uv: number[]; idx: number[] }>
    }) => {
      for (const grp of data.groups) {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grp.pos), 3))
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(grp.norm), 3))
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(grp.uv), 2))
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(grp.idx), 1))
        g.computeBoundingSphere()
        const mat = surfaceMaterial(grp.tex as Box['tex'], scope)
        mat.side = THREE.DoubleSide // BSP face winding varies — render both sides
        const mesh = new THREE.Mesh(g, mat)
        mesh.userData.isMap = true
        mesh.userData.surf = grp.tex
        mesh.castShadow = true
        mesh.receiveShadow = true
        group.add(mesh)
        raycastMeshes.push(mesh)
      }
    }).catch(() => { /* boxes already render a playable fallback */ })
  }

  // sky (stored so engine can drift the clouds) — per-map palette (Task 77)
  const sky = skyMesh(map.id)
  scene.add(sky)

  // bomb site decals — must clear the thin sand top layers (A platform 2.05, B slab 0.06)
  const decalA = siteDecal('A')
  decalA.position.set(map.sites.A.x, map.sites.A.y + 0.08, map.sites.A.z)
  group.add(decalA)
  const decalB = siteDecal('B')
  decalB.position.set(map.sites.B.x, map.sites.B.y + 0.13, map.sites.B.z)
  group.add(decalB)

  scene.add(group)

  return { group, colliders, raycastMeshes, sky }
}

/** Manual merge — BufferGeometryUtils.mergeGeometries needs indexed + same attributes. */
export function mergeGeosSafe(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0, iCount = 0
  for (const g of geos) {
    vCount += g.attributes.position.count
    if (g.index) iCount += g.index.count
    else iCount += g.attributes.position.count
  }
  const pos = new Float32Array(vCount * 3)
  const norm = new Float32Array(vCount * 3)
  const uv = new Float32Array(vCount * 2)
  const idx = new Uint32Array(iCount)
  let vo = 0, io = 0
  for (const g of geos) {
    const pa = g.attributes.position as THREE.BufferAttribute
    const na = g.attributes.normal as THREE.BufferAttribute
    const ua = g.attributes.uv as THREE.BufferAttribute
    pos.set(pa.array as Float32Array, vo * 3)
    norm.set(na.array as Float32Array, vo * 3)
    uv.set(ua.array as Float32Array, vo * 2)
    if (g.index) {
      const gi = g.index.array
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo
      io += gi.length
    } else {
      for (let i = 0; i < pa.count; i++) idx[io + i] = i + vo
      io += pa.count
    }
    vo += pa.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.setIndex(new THREE.BufferAttribute(idx, 1))
  out.computeBoundingSphere()
  return out
}
