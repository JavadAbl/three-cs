// Builds the map scene in Three.js from shared map data
import * as THREE from 'three'
import { MAPS } from './mapdata'
import type { MapDef, Box } from './mapdata'
import { skyMesh, siteDecal, surfaceMaterial, pbrMapScope } from './textures'
import { attachNightSky } from './nightsky'
import { sharedGLTFLoader } from './gltf'

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
    // Task 126: office world-shell leaks — sightlines that escape the BSP
    // decor shell (gaps between wings, above connectors) hit the sky sphere
    // and read as a broken white void. A hazy distant-city backdrop ring
    // catches every leak and reads as "far buildings in winter haze".
    // (office only — aimhead's bsp arena keeps its clean-sky look)
    if (map.id === 'office') {
      const W = 2048, H = 256
      const bc = document.createElement('canvas'); bc.width = W; bc.height = H
      const bctx = bc.getContext('2d')!
      // vertical haze: pale at horizon (matches the sky band) -> cool grey top
      const bg = bctx.createLinearGradient(0, 0, 0, H)
      bg.addColorStop(0, '#87929c'); bg.addColorStop(0.55, '#a7b1ba')
      bg.addColorStop(0.8, '#c3cbd2'); bg.addColorStop(1, '#d8dee3')
      bctx.fillStyle = bg; bctx.fillRect(0, 0, W, H)
      // distant skyline: soft-edged blocks in two depth layers
      let seed = 7
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
      for (const layer of [
        { col: '#6c7580', minH: 0.32, maxH: 0.62, y: 0.34 },   // far row (haze-dimmed)
        { col: '#525b66', minH: 0.18, maxH: 0.45, y: 0.55 },   // near row (darker)
      ]) {
        let x = 0
        while (x < W) {
          const w = 60 + rnd() * 160
          const h = layer.minH + rnd() * (layer.maxH - layer.minH)
          bctx.fillStyle = layer.col
          bctx.globalAlpha = 0.85
          const top = (1 - layer.y - h) * H
          bctx.fillRect(x, top, w - 6, H * (h + layer.y))
          x += w
        }
      }
      bctx.globalAlpha = 1
      const btex = new THREE.CanvasTexture(bc)
      btex.colorSpace = THREE.SRGBColorSpace
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(140, 140, 90, 48, 1, true),
        new THREE.MeshBasicMaterial({ map: btex, side: THREE.BackSide, fog: false, depthWrite: false })
      )
      ring.position.y = 22
      ring.renderOrder = -5   // above the sky sphere (-10), below the world
      group.add(ring)
    }
    // boxes are collision-only — real faces render instead (avoids double-draw/z-fight)
    const geomUrl = map.bsp.geomUrl
    fetch(geomUrl).then(r => r.json()).then((data: {
      groups: Array<{ tex: string; pos: number[]; norm?: number[]; uv: number[]; color?: number[]; idx: number[] }>
    }) => {
      for (const grp of data.groups) {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grp.pos), 3))
        // Task 131 island: groups omit norm — unshared verts => flat normals
        if (grp.norm && grp.norm.length) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(grp.norm), 3))
        else g.computeVertexNormals()
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(grp.uv), 2))
        // Task 126: office geom carries per-vertex baked GoldSrc lightmaps;
        // the material's vertexColors flag comes from the map's PBR lit:true
        if (grp.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(grp.color), 3))
        // Task 126 fix: BSP fence UVs vary wildly in density — dense ones
        // alias the 2x2 truss lattice into a 'checkerboard' at distance.
        // Remap fence UVs straight from world coords: one canvas repeat per
        // 2 m, uniform density, cells never fall below the moire threshold.
        if (grp.tex === 'fence') {
          const pos = grp.pos, uv = grp.uv
          // island groups omit norm — use the freshly computed attribute then
          const nrm: ArrayLike<number> = grp.norm ?? (g.getAttribute('normal') as THREE.BufferAttribute).array
          for (let vi = 0; vi < pos.length / 3; vi++) {
            const nx = nrm[vi * 3], ny = nrm[vi * 3 + 1]
            // dominant axis planar map (same choice the varTex shader makes)
            if (Math.abs(ny) > 0.5) { uv[vi * 2] = pos[vi * 3] / 2; uv[vi * 2 + 1] = pos[vi * 3 + 2] / 2 }
            else if (Math.abs(nx) > 0.5) { uv[vi * 2] = pos[vi * 3 + 2] / 2; uv[vi * 2 + 1] = pos[vi * 3 + 1] / 2 }
            else { uv[vi * 2] = pos[vi * 3] / 2; uv[vi * 2 + 1] = pos[vi * 3 + 1] / 2 }
          }
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2))
        }
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(grp.idx), 1))
        g.computeBoundingSphere()
        const mat = surfaceMaterial(grp.tex as Box['tex'], scope)
        mat.side = THREE.DoubleSide // BSP face winding varies — render both sides
        const mesh = new THREE.Mesh(g, mat)
        mesh.userData.isMap = true
        mesh.userData.surf = grp.tex
        // glass panes / lattice fences cast SOLID shadows (depth material
        // ignores alpha) — a window must not darken the room behind it
        mesh.castShadow = grp.tex !== 'fence' && grp.tex !== 'glass'
        mesh.receiveShadow = true
        group.add(mesh)
        raycastMeshes.push(mesh)
      }
    }).catch(() => { /* boxes already render a playable fallback */ })
  }

  // Task 134: generator-placed GLB prop models (island palms — 4 user
  // uploads, packed by scripts/island/pack-palm-models-t134.ts). One
  // prototype per model via the shared loader (KHR_mesh_quantization —
  // GLTFLoader decodes natively, no wasm decoder fetch), then a clone per
  // placement sharing geometry+materials. Task 135: bytes come from the
  // extensionless POST route /api/assets/island/<m> (staging-wins inside
  // the route) — the old direct /assets|/staging .glb GETs were captured by
  // the user's IDM extension and the palms never arrived. NOT added to
  // raycastMeshes: CS leaves don't stop bullets — trunks block server LOS
  // via their losBoxes members, visual impacts on fronds would double-draw
  // against the terrain decals.
  if (map.props?.length) {
    const needed = [...new Set(map.props.map(p => p.m))]
    const protos = new Map<string, THREE.Object3D>()
    const tryLoad = (m: string): Promise<void> =>
      fetch(`/api/assets/island/${m}`, { method: 'POST' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.arrayBuffer()
        })
        .then((buf) => new Promise<void>((resolve) => {
          sharedGLTFLoader().parse(
            buf,
            '',
            (gltf) => { protos.set(m, gltf.scene); resolve() },
            () => resolve(),   // parse fail -> this model stays absent, map keeps the rest
          )
        }))
        .catch(() => { /* 404 / network fail -> map renders without this prop */ })
    Promise.all(needed.map(tryLoad)).then(() => {
      for (const p of map.props!) {
        const proto = protos.get(p.m)
        if (!proto) continue
        const inst = proto.clone()
        inst.scale.setScalar(p.h)          // models normalized to height 1 at pack time
        inst.position.set(p.x, p.y, p.z)
        inst.rotation.y = p.rotY
        inst.traverse(o => {
          if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.isMap = true }
        })
        group.add(inst)
      }
    }).catch(() => { /* map still fully playable without props */ })
  }

  // sky (stored so engine can drift the clouds) — per-map palette (Task 77)
  const sky = skyMesh(map.id)
  // Task 101: real 3D moon + 22.5k-star field from the user's GLB models
  // (children of the sky mesh: free disposal on map switch + camera follow)
  if (map.id === 'aimdepot') attachNightSky(sky)
  scene.add(sky)

  // bomb site decals — defuse maps only: aim maps (bomb === false) carry no objective,
  // so no site markings. Must clear the thin sand top layers (A platform 2.05, B slab 0.06)
  if (map.bomb !== false) {
    const decalA = siteDecal('A')
    decalA.position.set(map.sites.A.x, map.sites.A.y + 0.08, map.sites.A.z)
    group.add(decalA)
    const decalB = siteDecal('B')
    decalB.position.set(map.sites.B.x, map.sites.B.y + 0.13, map.sites.B.z)
    group.add(decalB)
  }

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
