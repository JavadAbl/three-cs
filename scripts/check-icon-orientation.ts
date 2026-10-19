// Durable icon-orientation invariant (user acceptance feedback: "the weapons
// magazine are in top" — the pre-fix icons were vertically flipped because the
// rasterizer maps view-space +y to image-down; the fix rolls the gun view
// matrix 180° about the view axis).
//
// Two pinned facts:
// 1. SOURCE: scripts/gen-buy-icons.ts viewMatrix('gun') must carry
//    RotZ(180)·RotX(10)·RotY(-70) (the acceptance roll); the nade/gear lines
//    must stay unrolled (a rolled nade would put its pin ring at the bottom).
// 2. ANATOMY: the magazine center must sit BELOW the barrel line (the
//    viewmodel's muzzle `tip` height — y is invariant under the side-view
//    rotation) for every gun except the p90, whose magazine is anatomically
//    ON TOP. Body-center is the WRONG reference: tube-mag shotguns run their
//    magazine inside the barrel assembly, above the stock-dragged body center
//    yet correctly below the barrel. If a viewmodel change ever breaks this,
//    the 180° roll assumption no longer yields upright icons.
// (The rendered PNGs are deterministic output of the pinned matrix + these
// models; the visual outcome was VLM-probe-verified on ak47/m4 at 2x zoom.)
import './domstub'
import * as THREE from 'three'
import { BUY_ENTRIES, WEAPONS, BuyEntry, WeaponId } from '../shared/weapons'
import { buildViewModel } from '../src/game/weaponmodels'
import { readFileSync } from 'fs'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// --- 1. generator source pins
const genSrc = readFileSync('scripts/gen-buy-icons.ts', 'utf8')
check('generator gun view carries the 180° acceptance roll (RotZ after base)',
  genSrc.includes('makeRotationZ(R(180))') && /makeRotationZ\(R\(180\)\)\s*\n?\s*\.multiply\(/.test(genSrc))
check('roll applies to guns only (nade line unrolled)',
  /'nade'\) return new THREE\.Matrix4\(\)\.makeRotationX\(R\(18\)\)\.multiply\(/.test(genSrc))
check('gear view stays identity (frontal icons must not roll)',
  /return new THREE\.Matrix4\(\) \/\/ gear: identity front view/.test(genSrc))

// --- 2. per-gun profile anatomy
const NO_MAG = new Set(['revolver', 'taser'])
const TOP_MAG = new Set(['p90']) // anatomically top-mounted magazine

function bboxY(objs: { mesh: THREE.Mesh }[]): number {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const { mesh } of objs) {
    mesh.geometry.computeBoundingBox()
    const b = mesh.geometry.boundingBox!
    for (const corner of [b.min, b.max]) {
      v.copy(corner).applyMatrix4(mesh.matrixWorld)
      box.expandByPoint(v)
    }
  }
  return box.getCenter(new THREE.Vector3()).y
}

let guns = 0, skipped = 0
for (const e of BUY_ENTRIES as BuyEntry[]) {
  if (e.kind !== 'weapon') continue
  const def = (WEAPONS as Record<string, { throwable?: boolean }>)[e.id]
  if (def?.throwable) continue
  if (NO_MAG.has(e.id)) { skipped++; continue }
  const vm = buildViewModel(e.id as WeaponId, 'CT')
  vm.group.updateMatrixWorld(true)
  const magMeshes: { mesh: THREE.Mesh }[] = []
  vm.mag!.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) magMeshes.push({ mesh: m }) })
  const barrelY = vm.tip.y // muzzle height = barrel line (y invariant under side view)
  const magY = bboxY(magMeshes)
  const below = magY < barrelY
  const expected = TOP_MAG.has(e.id) ? !below : below
  guns++
  check(`[${e.id}] anatomy: magazine ${below ? 'below' : 'above'} barrel line (${TOP_MAG.has(e.id) ? 'top-mag by design' : 'standard'})`,
    expected, `magY ${magY.toFixed(3)} vs barrelY ${barrelY.toFixed(3)}`)
}
check('mag anatomy coverage (31 mag guns of 33; revolver/taser skipped)',
  guns === 31, `${guns} checked, ${skipped} no-mag skipped`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
