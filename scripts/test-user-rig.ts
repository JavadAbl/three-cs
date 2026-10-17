// Ground-truth test of the usermodel auto-rig: load via the dev server (bun fetch),
// create a per-player clone, rotate bones, CPU-skin vertices, verify deformation.
import * as THREE from 'three'
import '../scripts/domstub.js'
import { preloadUserModel, userModelReady, createUserModel, userModelState } from '../src/game/usermodel'

// rewrite root-relative asset URLs to the dev server (bun has no document base)
const OrigRequest = globalThis.Request as unknown as new (u: string, init?: RequestInit) => Request
; (globalThis as unknown as Record<string, unknown>).Request = class extends OrigRequest {
  constructor(u: string, init?: RequestInit) {
    if (typeof u === 'string' && u.startsWith('/')) u = 'http://localhost:3000' + u
    super(u, init)
  }
}
// usermodel.ts now fetch()es the model directly — rewrite that too
const origFetch = globalThis.fetch.bind(globalThis)
; (globalThis as unknown as Record<string, unknown>).fetch = (u: RequestInfo | URL, init?: RequestInit) =>
  origFetch(typeof u === 'string' && u.startsWith('/') ? 'http://localhost:3000' + u : u, init)
; (globalThis as unknown as Record<string, unknown>).ProgressEvent = class {
  type: string
  constructor(type: string, init: Record<string, unknown> = {}) { this.type = type; Object.assign(this, init) }
}

async function main() {
  await preloadUserModel()
  console.log('asset state:', userModelState())
  if (!userModelReady()) { console.log('FAIL: asset not ready'); process.exit(2) }

  const inst = createUserModel('CT')
  const model = inst.model
  model.updateMatrixWorld(true)

  // pick test vertices from the skinned meshes (geometry is baked in game space)
  type Sel = { mesh: THREE.SkinnedMesh; idx: number; orig: THREE.Vector3; label: string }
  const picks: Sel[] = []
  model.traverse(o => {
    const m = o as THREE.SkinnedMesh
    if (!m.isSkinnedMesh) return
    const pos = m.geometry.attributes.position as THREE.BufferAttribute
    const si = m.geometry.attributes.skinIndex as THREE.BufferAttribute
    const sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute
    let armR: number = -1, torso: number = -1, head: number = -1
    const BONE_ORDER = ['hips', 'torso', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR']
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      if (armR < 0 && x > 0.25 && y > 1.30 && y < 1.45 && Math.abs(z) < 0.15) armR = i
      if (torso < 0 && Math.abs(x) < 0.1 && y > 1.20 && y < 1.35 && Math.abs(z) < 0.15) torso = i
      if (head < 0 && Math.abs(x) < 0.1 && y > 1.70 && Math.abs(z) < 0.1) head = i
    }
    const add = (idx: number, label: string) => {
      if (idx < 0) return
      const infl: string[] = []
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(idx, k)
        if (w > 0.001) infl.push(BONE_ORDER[si.getComponent(idx, k)] + ':' + w.toFixed(2))
      }
      console.log(`  pick ${label}: mesh-vert ${idx} influences [${infl.join(', ')}] pos (${pos.getX(idx).toFixed(2)}, ${pos.getY(idx).toFixed(2)}, ${pos.getZ(idx).toFixed(2)})`)
      picks.push({ mesh: m, idx, orig: new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx)), label })
    }
    add(armR, 'armR-region')
    add(torso, 'torso-region')
    add(head, 'head-region')
  })
  if (picks.length === 0) { console.log('FAIL: no test vertices found'); process.exit(2) }

  const skin = (s: Sel) => {
    const v = s.orig.clone()
    // @ts-ignore — applyBoneTransform is public API on SkinnedMesh
    s.mesh.applyBoneTransform(s.idx, v)
    return v
  }

  const before = picks.map(skin)

  // rotate the arm bones strongly + head
  inst.bones.armR.rotation.set(1.4, 0, 0)
  inst.bones.foreR.rotation.set(1.2, 0, 0)
  inst.bones.head.rotation.set(0.6, 0.5, 0)
  model.updateMatrixWorld(true)
  inst.model.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && m.skeleton) m.skeleton.update() })

  let ok = true
  for (let i = 0; i < picks.length; i++) {
    const b = before[i]
    const a = skin(picks[i])
    const d = a.distanceTo(b)
    console.log(`${picks[i].label}: moved ${d.toFixed(4)} m  (${b.toArray().map(v => v.toFixed(2)).join(',')} → ${a.toArray().map(v => v.toFixed(2)).join(',')})`)
    if (picks[i].label === 'armR-region' && d < 0.05) { console.log('  ^ FAIL: arm vertex did not follow the arm bone'); ok = false }
    if (picks[i].label === 'head-region' && d < 0.05) { console.log('  ^ FAIL: head vertex did not follow the head bone'); ok = false }
    if (picks[i].label === 'torso-region' && d > 0.2) { console.log('  ^ WARN: torso vertex moved a lot (weights leaking?)'); }
  }
  console.log(ok ? 'SKINNING WORKS ✓' : 'SKINNING BROKEN ✗')
  process.exit(ok ? 0 : 1)
}

main().catch(e => { console.error('TEST ERROR', e); process.exit(3) })

// team tint check appended after main? no — run standalone
