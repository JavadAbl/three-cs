// Task 115 — measure the rebel GLB in the exact game-space bind pose
// usermodel.buildProto produces (bake node matrices, normalize 1.79m /
// grounded / centered / rotY(PI)), to derive:
//   - the J skeleton joint table for this model
//   - skin-weight band parameters (arm/torso |x| boundary, elbow/knee/hip/
//     neck y bands, leg split)
//   - IK arm rig (S/E/F per side) + HandR/HandL fore-local anchors
//   - facing sanity (nose vs back-of-head z asymmetry in head band)
import { readFileSync } from 'node:fs'

// Node shim: GLTFLoader probes `self` / `createImageBitmap` for texture
// decoding. We only need geometry — stub both so parse() completes without
// decoding a single embedded PNG.
globalThis.self = globalThis
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} })

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const file = process.argv[2] ?? 'public/staging/models/rebel.glb'
const buf = readFileSync(file)
const loader = new GLTFLoader()
loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', (gltf) => {
  const src = gltf.scene
  src.updateMatrixWorld(true)

  // ---- buildProto steps 1+2 verbatim
  const items = []
  src.traverse((o) => {
    const m = o
    if (!m.isMesh || !m.geometry?.attributes?.position) return
    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    items.push({ geo, name: m.name })
  })
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const it of items) {
    const pos = it.geo.attributes.position
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i))
  }
  const size = box.getSize(new THREE.Vector3())
  const s = 1.79 / Math.max(0.01, size.y)
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const M = new THREE.Matrix4()
    .makeRotationY(Math.PI)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz))
  for (const it of items) it.geo.applyMatrix4(M)
  console.log(`${file}: ${items.length} meshes, bake scale ${s.toFixed(4)}, size ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} raw`)
  console.log(`game-space bbox after rotY(PI):`)

  const all = []
  for (const it of items) {
    const pos = it.geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      all.push([v.x, v.y, v.z, it.name])
    }
  }
  const gmin = [Infinity, Infinity, Infinity], gmax = [-Infinity, -Infinity, -Infinity]
  for (const p of all) for (let k = 0; k < 3; k++) { if (p[k] < gmin[k]) gmin[k] = p[k]; if (p[k] > gmax[k]) gmax[k] = p[k] }
  console.log(`  x[${gmin[0].toFixed(3)}, ${gmax[0].toFixed(3)}] y[${gmin[1].toFixed(3)}, ${gmax[1].toFixed(3)}] z[${gmin[2].toFixed(3)}, ${gmax[2].toFixed(3)}]`)

  // ---- 1. arms census: outer-cluster verts per side.
  // Threshold TBD: first print x-histogram in arm y range to find the notch.
  console.log('\n--- |x| histogram (y 0.75..1.66), bins of 0.02 ---')
  for (let x0 = 0; x0 <= 0.32; x0 += 0.02) {
    let n = 0
    for (const p of all) {
      if (p[1] <= 0.75 || p[1] >= 1.66) continue
      const ax = Math.abs(p[0])
      if (ax >= x0 && ax < x0 + 0.02) n++
    }
    console.log(`  |x| ${x0.toFixed(2)}-${(x0 + 0.02).toFixed(2)}: ${'#'.repeat(Math.min(60, Math.round(n / 200)))} ${n}`)
  }

  // y-slices on OUTER verts (|x| > 0.17 — adjust after histogram) per side
  const OUTER = 0.17
  console.log(`\n--- outer-arm y-slices (|x| > ${OUTER}) ---`)
  for (let y0 = 1.65; y0 > 0.65; y0 -= 0.05) {
    const band = all.filter(p => p[1] >= y0 && p[1] < y0 + 0.05 && Math.abs(p[0]) > OUTER)
    if (!band.length) continue
    const R = band.filter(p => p[0] > 0), L = band.filter(p => p[0] < 0)
    const cen = (set) => set.length
      ? [set.reduce((t, a) => t + a[0], 0) / set.length, set.reduce((t, a) => t + a[1], 0) / set.length, set.reduce((t, a) => t + a[2], 0) / set.length]
      : null
    const cR = cen(R), cL = cen(L)
    console.log(`  y ${y0.toFixed(2)}-${(y0 + 0.05).toFixed(2)}: R n=${String(R.length).padStart(4)} cen(${cR ? cR.map(x => x.toFixed(3)).join(',') : '-'})  L n=${String(L.length).padStart(4)} cen(${cL ? cL.map(x => x.toFixed(3)).join(',') : '-'})`)
  }

  // fist = lowest 8cm of the outer band; elbow = middle band; shoulder = top band
  const arm = (side) => all.filter(p => (side === 'R' ? p[0] > OUTER : p[0] < -OUTER) && p[1] > 0.72 && p[1] < 1.66)
  const cen = (set) => set.length
    ? [set.reduce((t, a) => t + a[0], 0) / set.length, set.reduce((t, a) => t + a[1], 0) / set.length, set.reduce((t, a) => t + a[2], 0) / set.length]
    : null
  for (const side of ['R', 'L']) {
    const a = arm(side)
    const ys = a.map(p => p[1])
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    const fist = a.filter(p => p[1] < yMin + 0.08)
    const elbow = a.filter(p => p[1] >= 1.02 && p[1] <= 1.22)
    const shoulder = a.filter(p => p[1] >= 1.40)
    console.log(`\n${side} arm: y[${yMin.toFixed(3)}, ${yMax.toFixed(3)}] n=${a.length}`)
    console.log(`  FIST (lowest 8cm):`, cen(fist)?.map(x => x.toFixed(3)).join(', '), `n=${fist.length}`)
    console.log(`  ELBOW (y1.02-1.22 outer):`, cen(elbow)?.map(x => x.toFixed(3)).join(', '), `n=${elbow.length}`)
    console.log(`  SHOULDER (y>1.40 outer):`, cen(shoulder)?.map(x => x.toFixed(3)).join(', '), `n=${shoulder.length}`)
  }

  // ---- 2. torso half-width by y (inner verts |x| <= 0.17): where does the torso end
  console.log('\n--- torso / pelvis x-extent (inner verts, per 5cm y) ---')
  for (let y0 = 1.65; y0 > 0.0; y0 -= 0.05) {
    const band = all.filter(p => p[1] >= y0 && p[1] < y0 + 0.05)
    if (!band.length) continue
    const inner = band.filter(p => Math.abs(p[0]) <= OUTER)
    const maxX = inner.length ? Math.max(...inner.map(p => Math.abs(p[0]))) : 0
    // leg gap: verts with |x| < 0.03
    const gap = band.filter(p => Math.abs(p[0]) < 0.03).length
    const zR = band.map(p => p[2])
    console.log(`  y ${y0.toFixed(2)}-${(y0 + 0.05).toFixed(2)}: n=${String(band.length).padStart(5)} innerMax|x|=${maxX.toFixed(3)} centerGap=${String(gap).padStart(5)} z[${Math.min(...zR).toFixed(2)},${Math.max(...zR).toFixed(2)}]`)
  }

  // ---- 3. legs: left/right leg centroids at hip (y~0.9) and knee (y~0.5)
  for (const [label, y0, y1] of [['HIP', 0.86, 0.98], ['KNEE', 0.44, 0.56], ['ANKLE', 0.04, 0.14]]) {
    const band = all.filter(p => p[1] >= y0 && p[1] < y1)
    const R = band.filter(p => p[0] > 0.03), L = band.filter(p => p[0] < -0.03)
    console.log(`${label} band y${y0}-${y1}: R cen(${cen(R)?.map(x => x.toFixed(3)).join(',')}) L cen(${cen(L)?.map(x => x.toFixed(3)).join(',')})`)
  }

  // ---- 4. head: bottom of head / neck; nose vs back-of-head z (facing check)
  const head = all.filter(p => p[1] > 1.55)
  console.log(`\nHEAD (y>1.55): n=${head.length} y-max=${Math.max(...head.map(p => p[1])).toFixed(3)}`)
  // z split at head mid: front half centroid vs back half
  const hz = head.map(p => p[2])
  const hzMid = (Math.min(...hz) + Math.max(...hz)) / 2
  const front = head.filter(p => p[2] < hzMid), back = head.filter(p => p[2] >= hzMid)
  console.log(`  head z[${Math.min(...hz).toFixed(3)}, ${Math.max(...hz).toFixed(3)}] mid=${hzMid.toFixed(3)}`)
  console.log(`  FRONT half (z<mid): n=${front.length} cen z=${cen(front)?.[2].toFixed(3)} y=${cen(front)?.[1].toFixed(3)}`)
  console.log(`  BACK  half (z>mid): n=${back.length} cen z=${cen(back)?.[2].toFixed(3)} y=${cen(back)?.[1].toFixed(3)}`)
  // nose: frontmost 2% of head verts
  const nose = [...head].sort((a, b) => a[2] - b[2]).slice(0, Math.max(30, Math.round(head.length * 0.02)))
  console.log(`  NOSE cluster (frontmost 2%): cen(${cen(nose)?.map(x => x.toFixed(3)).join(',')}) — after rotY(PI) game faces -Z: nose z should be NEGATIVE`)
  // neck: y band where |x|<0.16 shrinks
  for (let y0 = 1.62; y0 > 1.38; y0 -= 0.02) {
    const band = all.filter(p => p[1] >= y0 && p[1] < y0 + 0.02)
    const maxX = band.length ? Math.max(...band.map(p => Math.abs(p[0]))) : 0
    console.log(`  neck y${y0.toFixed(2)}: max|x|=${maxX.toFixed(3)} n=${band.length}`)
  }

  // ---- 5. chest z-extent (gun stock clearance) + right-hand z (verify right side is +x)
  const chest = all.filter(p => Math.abs(p[0]) < 0.14 && p[1] > 1.22 && p[1] < 1.5)
  console.log(`\nCHEST (|x|<0.14, y1.22-1.5): z[${Math.min(...chest.map(p => p[2])).toFixed(3)}, ${Math.max(...chest.map(p => p[2])).toFixed(3)}] (game: -z front, +z back)`)
  process.exit(0)
}, (e) => { console.error('parse fail', e); process.exit(1) })
