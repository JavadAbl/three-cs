// Task 112 — verify staged GLB orientation with three.js (headless parse)
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const buf = readFileSync('public/staging/models/human.glb')
const loader = new GLTFLoader()
loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', (gltf) => {
  const m = gltf.scene
  m.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(m)
  const size = box.getSize(new THREE.Vector3())
  console.log('three.js world bbox size:', size.x.toFixed(3), 'x', size.y.toFixed(3), 'x', size.z.toFixed(3))
  console.log('root children:', m.children.length)
  m.children.forEach((c, i) => {
    console.log(`child[${i}] "${c.name}" type=${c.type} rotY?=${c.rotation ? c.rotation.x.toFixed(3) : '-'} mesh=${c.children?.[0]?.type ?? '-'}`)
    const b2 = new THREE.Box3().setFromObject(c)
    const s2 = b2.getSize(new THREE.Vector3())
    console.log(`   local bbox: ${s2.x.toFixed(2)} x ${s2.y.toFixed(2)} x ${s2.z.toFixed(2)}`)
  })
}, (e) => { console.error('parse fail', e); process.exit(1) })
