// Builds the Dust2 scene in Three.js from shared map data
import * as THREE from 'three'
import { MAP_BOXES, SITES } from './dust2'
import type { Box } from './dust2'
import { sandTexture, wallTexture, crateTexture, metalTexture, darkTexture, plankTexture, doorTexture, skyMesh, siteDecal } from './textures'

export interface MapBuild {
  group: THREE.Group
  colliders: Array<{ min: THREE.Vector3; max: THREE.Vector3; box: Box }>
  raycastMeshes: THREE.Object3D[]   // for bullet impact raycasts
}

function texFor(tex: Box['tex'], rx: number, ry: number): THREE.Texture {
  switch (tex) {
    case 'sand': return sandTexture(rx, ry)
    case 'wall': return wallTexture(rx, ry)
    case 'crate': return crateTexture(rx, ry)
    case 'metal': return metalTexture(rx, ry)
    case 'dark': return darkTexture(rx, ry)
    case 'plank': return plankTexture(rx, ry)
    case 'door': return doorTexture(rx, ry)
  }
}

export function buildMap(scene: THREE.Scene): MapBuild {
  const group = new THREE.Group()
  const colliders: MapBuild['colliders'] = []
  const raycastMeshes: THREE.Object3D[] = []

  // merge static boxes by material for performance
  const geosByTex = new Map<Box['tex'], THREE.BufferGeometry[]>()

  const geoTemplate = new THREE.BoxGeometry(1, 1, 1)

  for (const b of MAP_BOXES) {
    const g = geoTemplate.clone()
    // per-box UV scaling: scale uv by face size so texture density is uniform
    const uv = g.attributes.uv as THREE.BufferAttribute
    const size = [b.w, b.h, b.d]
    // faces order: +x,-x,+y,-y,+z,-z each 4 verts
    const faceDims = [
      [b.d, b.h], [b.d, b.h],  // x faces
      [b.w, b.d], [b.w, b.d],  // y faces
      [b.w, b.h], [b.w, b.h],  // z faces
    ]
    for (let f = 0; f < 6; f++) {
      const [su, sv] = faceDims[f]
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v
        uv.setXY(i, uv.getX(i) * su * 0.35, uv.getY(i) * sv * 0.35)
      }
    }
    g.applyMatrix4(new THREE.Matrix4().makeScale(b.w, b.h, b.d))
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(b.x, b.y, b.z))

    if (!geosByTex.has(b.tex)) geosByTex.set(b.tex, [])
    geosByTex.get(b.tex)!.push(g)

    colliders.push({
      min: new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2),
      max: new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2),
      box: b,
    })
  }

  const merged = new Map<THREE.Material, THREE.BufferGeometry[]>()
  for (const [tex, geos] of geosByTex) {
    const mergedGeos = mergeGeosSafe(geos)
    const mat = new THREE.MeshLambertMaterial({ map: texFor(tex, 1, 1) })
    if (!merged.has(mat)) merged.set(mat, [])
    merged.get(mat)!.push(mergedGeos)
  }
  for (const [mat, geos] of merged) {
    for (const g of geos) {
      const mesh = new THREE.Mesh(g, mat)
      mesh.userData.isMap = true
      group.add(mesh)
      raycastMeshes.push(mesh)
    }
  }

  // sky
  scene.add(skyMesh())

  // bomb site decals
  const decalA = siteDecal('A')
  decalA.position.set(SITES.A.x, SITES.A.y + 0.03, SITES.A.z)
  group.add(decalA)
  const decalB = siteDecal('B')
  decalB.position.set(SITES.B.x, SITES.B.y + 0.03, SITES.B.z)
  group.add(decalB)

  scene.add(group)

  return { group, colliders, raycastMeshes }
}

function mergeGeosSafe(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // manual merge (BufferGeometryUtils.mergeGeometries needs indexed + same attributes)
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
