// Task 115 — per-mesh census of the rebel: which mesh owns the arms?
// Decides whether mesh membership can cleanly separate arm vs torso verts
// (the arms hug the jacket — x-threshold alone has no clean notch).
import { readFileSync } from 'node:fs'

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

  for (const it of items) {
    const pos = it.geo.attributes.position
    let xmin = 9, xmax = -9, ymin = 9, ymax = -9, zmin = 9, zmax = -9
    const pts = []
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      pts.push([v.x, v.y, v.z])
      if (v.x < xmin) xmin = v.x; if (v.x > xmax) xmax = v.x
      if (v.y < ymin) ymin = v.y; if (v.y > ymax) ymax = v.y
      if (v.z < zmin) zmin = v.z; if (v.z > zmax) zmax = v.z
    }
    console.log(`\n=== mesh "${it.name}" n=${pos.count} x[${xmin.toFixed(3)},${xmax.toFixed(3)}] y[${ymin.toFixed(3)},${ymax.toFixed(3)}] z[${zmin.toFixed(3)},${zmax.toFixed(3)}]`)
    // y-slices: max|x| + count
    for (let y0 = 1.75; y0 > 0; y0 -= 0.125) {
      const band = pts.filter(p => p[1] >= y0 && p[1] < y0 + 0.125)
      if (!band.length) continue
      const mx = Math.max(...band.map(p => Math.abs(p[0])))
      const cen = band.reduce((t, p) => [t[0] + p[0], t[1] + p[1], t[2] + p[2]], [0, 0, 0]).map(x => x / band.length)
      console.log(`  y ${y0.toFixed(2)}-${(y0 + 0.125).toFixed(2)}: n=${String(band.length).padStart(5)} max|x|=${mx.toFixed(3)} cen(${cen.map(x => x.toFixed(3)).join(',')})`)
    }
  }

  // ---- decisive: at chest y 1.00-1.25, x-histogram per mesh (0.01 bins, x>0)
  console.log('\n--- chest slice y1.00-1.25: |x| histogram per mesh ---')
  for (const it of items) {
    const pos = it.geo.attributes.position
    const bins = new Array(31).fill(0)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      if (v.y < 1.00 || v.y > 1.25) continue
      const ax = Math.abs(v.x)
      if (ax < 0.30) bins[Math.floor(ax / 0.01)]++
    }
    console.log(`mesh ${it.name}: ` + bins.map((n, i) => `${(i / 100).toFixed(2)}:${n}`).join(' '))
  }
  // ---- shoulder slice y1.32-1.48
  console.log('\n--- shoulder slice y1.32-1.48: |x| histogram per mesh ---')
  for (const it of items) {
    const pos = it.geo.attributes.position
    const bins = new Array(31).fill(0)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      if (v.y < 1.32 || v.y > 1.48) continue
      const ax = Math.abs(v.x)
      if (ax < 0.30) bins[Math.floor(ax / 0.01)]++
    }
    console.log(`mesh ${it.name}: ` + bins.map((n, i) => `${(i / 100).toFixed(2)}:${n}`).join(' '))
  }
  process.exit(0)
}, (e) => { console.error('parse fail', e); process.exit(1) })
