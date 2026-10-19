// Per-weapon magazine orientation ground truth.
// The viewmodels expose .mag (the magazine group). We compute, per gun, the
// mag's center and the whole gun's center in the BASE gun view space
// (RotX(10)*RotY(-70), no roll). The rasterizer maps view-space +y to
// INCREASING image row (image-down), so:
//   mag view-y ABOVE gun center  => mag renders at image BOTTOM (already correct)
//   mag view-y BELOW gun center  => mag renders at image TOP (upside-down -> needs 180 roll)
// Also prints the mag's LOCAL y (canonical anatomy: p90's top-mag is +y).
import './domstub'
import * as THREE from 'three'
import { BUY_ENTRIES, WEAPONS, BuyEntry, WeaponId } from '../shared/weapons'
import { buildViewModel } from '../src/game/weaponmodels'

// NOTE: hand meshes (glove materials) are EXCLUDED from the gun bbox below —
// the icon generator does the same; including them drags the center down and
// produces misleading mag-vs-center signs (cost an hour of confusion).
const HAND_HEX = new Set([0x1a1c1f, 0x232527, 0x1d1f21, 0x9a7f4e, 0x2c4a6e])

const R = THREE.MathUtils.degToRad
const BASE = new THREE.Matrix4().makeRotationX(R(10)).multiply(new THREE.Matrix4().makeRotationY(R(-70)))

function bboxCenterY(obj: THREE.Object3D): { localY: number; viewY: number } {
  const box = new THREE.Box3()
  obj.updateMatrixWorld(true)
  obj.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const pos = mesh.geometry.attributes.position
    if (!pos) return
    mesh.geometry.computeBoundingBox()
    const b = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld)
    box.union(b)
  })
  const c = box.getCenter(new THREE.Vector3())
  const v = c.clone().applyMatrix4(BASE)
  return { localY: c.y, viewY: v.y }
}

function gunCenterViewY(model: THREE.Object3D): number {
  const box = new THREE.Box3()
  model.updateMatrixWorld(true)
  model.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat && HAND_HEX.has(mat.color?.getHex?.() ?? -1)) return
    const pos = mesh.geometry.attributes.position
    if (!pos) return
    mesh.geometry.computeBoundingBox()
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld))
  })
  return box.getCenter(new THREE.Vector3()).applyMatrix4(BASE).y
}

let noMag = 0
for (const e of BUY_ENTRIES as BuyEntry[]) {
  if (e.kind !== 'weapon') continue
  const def = (WEAPONS as Record<string, { throwable?: boolean }>)[e.id]
  if (def?.throwable) continue
  const vm = buildViewModel(e.id as WeaponId, 'CT')
  const gunY = gunCenterViewY(vm.group)
  if (!vm.mag) {
    noMag++
    console.log(`${e.id.padEnd(12)} NO MAG GROUP (fallback: no roll)`)
    continue
  }
  const { localY, viewY } = bboxCenterY(vm.mag)
  const magAbove = viewY > gunY          // view-space: mag above gun center
  const rendersBottom = magAbove         // image row = +viewY => mag at image bottom
  console.log(`${e.id.padEnd(12)} mag localY ${localY >= 0 ? '+' : ''}${localY.toFixed(3)}  magViewY ${viewY.toFixed(3)} vs gunY ${gunY.toFixed(3)}  => old icon mag at image ${rendersBottom ? 'BOTTOM (correct, NO roll)' : 'TOP (needs 180 roll)'}`)
}
console.log(`\n${noMag} guns without mag group`)
