// Task 114 — measure the CURRENT staged human.glb's arm geometry in the exact
// game-space bind pose usermodel.buildProto produces (bake node matrices,
// normalize 1.79m/grounded/centered/facing -Z), so the gun hand-anchor can be
// re-tuned to the REAL fist/elbow/shoulder positions.
// Reports: right+left arm vertex bands, shoulder/elbow/fist estimates, chest
// z-extent (backpack clearance for the gun stock).
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const buf = readFileSync('public/staging/models/human.glb')
const loader = new GLTFLoader()
loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', (gltf) => {
  const src = gltf.scene
  src.updateMatrixWorld(true)

  // ---- buildProto steps 1+2: bake + normalize (verbatim math from usermodel.ts)
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

  // ---- arm census in game space
  const right = []  // x > 0.13, arm band y 0.75..1.66
  const left = []
  for (const it of items) {
    const pos = it.geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      if (v.y > 0.75 && v.y < 1.66) {
        if (v.x > 0.13) right.push([v.x, v.y, v.z, it.name])
        else if (v.x < -0.13) left.push([v.x, v.y, v.z, it.name])
      }
    }
  }
  const stat = (arr, label) => {
    if (!arr.length) return console.log(label, ': no verts')
    const xs = arr.map(a => a[0]), ys = arr.map(a => a[1]), zs = arr.map(a => a[2])
    const rng = (a) => [Math.min(...a).toFixed(3), Math.max(...a).toFixed(3)]
    console.log(`${label}: n=${arr.length} x[${rng(xs)}] y[${rng(ys)}] z[${rng(zs)}]`)
    // y-slices every 5cm: mean x, mean z, count → find elbow shelf + hand tip
    for (let y0 = 1.65; y0 > 0.70; y0 -= 0.05) {
      const band = arr.filter(a => a[1] >= y0 && a[1] < y0 + 0.05)
      if (!band.length) continue
      const mx = band.reduce((t, a) => t + a[0], 0) / band.length
      const mz = band.reduce((t, a) => t + a[2], 0) / band.length
      console.log(`  y ${y0.toFixed(2)}-${(y0 + 0.05).toFixed(2)}: n=${String(band.length).padStart(4)} meanX=${mx.toFixed(3)} meanZ=${mz.toFixed(3)}`)
    }
    // fist = lowest 8cm outer band centroid; elbow = band around y 1.15-1.25 outer
    const fist = arr.filter(a => a[1] < 0.98 && Math.abs(a[0]) > 0.24)
    const elbow = arr.filter(a => a[1] >= 1.12 && a[1] <= 1.30 && Math.abs(a[0]) > 0.24)
    const cen = (set) => set.length
      ? [set.reduce((t, a) => t + a[0], 0) / set.length, set.reduce((t, a) => t + a[1], 0) / set.length, set.reduce((t, a) => t + a[2], 0) / set.length]
      : null
    console.log(`  FIST centroid (<0.98, |x|>0.24):`, cen(fist)?.map(x => x.toFixed(3)).join(', ') ?? 'none', `n=${fist.length}`)
    console.log(`  ELBOW centroid (1.12-1.30, |x|>0.24):`, cen(elbow)?.map(x => x.toFixed(3)).join(', ') ?? 'none', `n=${elbow.length}`)
  }
  stat(right, 'RIGHT arm (game +x)')
  stat(left, 'LEFT arm (game -x)')

  // ---- torso z-extent at chest (stock clearance) + shoulder height
  let chestZmax = -9, chestZmin = 9, shYmax = 0
  for (const it of items) {
    const pos = it.geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      if (Math.abs(v.x) < 0.30 && v.y > 1.25 && v.y < 1.55) {
        if (v.z > chestZmax) chestZmax = v.z
        if (v.z < chestZmin) chestZmin = v.z
      }
      if (Math.abs(v.x) < 0.30 && v.y > shYmax) shYmax = v.y
    }
  }
  console.log(`CHEST (|x|<0.30, y1.25-1.55): z [${chestZmin.toFixed(3)} .. ${chestZmax.toFixed(3)}] (back = +z)`)
  console.log(`body top y: ${shYmax.toFixed(3)} (head, not helmet)`)

  // J reference + current anchor
  console.log('\nJ joints: armR (0.27,1.48,0) foreR (0.34,1.20,0) → L1 =', Math.hypot(0.34 - 0.27, 1.20 - 1.48).toFixed(3))
  console.log('current HandR anchor local (0.03,-0.22,0.03) → |L2| =', Math.hypot(0.03, 0.22, 0.03).toFixed(3))
  console.log('current bind HandR world = (0.37, 0.98, 0.03)')
  process.exit(0)
}, (e) => { console.error('parse fail', e); process.exit(1) })
