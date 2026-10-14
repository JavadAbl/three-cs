// find detail geometry near a probe point
import './domstub'
import * as THREE from 'three'
import { MAPS } from '../src/game/mapdata'
import { buildDetails } from '../src/game/mapdetails'

const scene = new THREE.Scene()
const det = buildDetails(MAPS.dust2)
scene.add(det.group)
scene.updateMatrixWorld(true)

const targets = [new THREE.Vector3(-40.9, 2.8, 28.1), new THREE.Vector3(-40.9, 2.8, 36.1)]
for (const child of det.group.children) {
  const m = child as THREE.Mesh
  if (!m.isMesh) continue
  const geo = m.geometry
  const pos = geo.attributes.position as THREE.BufferAttribute
  const idx = geo.index
  const pa = pos.array as Float32Array
  const count = idx ? idx.count : pos.count
  for (let i = 0; i < count; i += 3) {
    const i0 = idx ? idx.getX(i) : i
    const i1 = idx ? idx.getX(i + 1) : i + 1
    const i2 = idx ? idx.getX(i + 2) : i + 2
    for (const ii of [i0, i1, i2]) {
      const v = new THREE.Vector3(pa[ii * 3], pa[ii * 3 + 1], pa[ii * 3 + 2]).applyMatrix4(m.matrixWorld)
      for (const t of targets) {
        if (v.distanceTo(t) < 0.6) {
          const mat = m.material as THREE.Material
          console.log(`NEAR ${t.x},${t.y},${t.z}: mesh kind=${(m.userData as { surf?: string }).surf ?? '?'} mat=${mat.type} vert=(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`)
        }
      }
    }
  }
}
console.log('probe done')
