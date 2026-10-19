import * as THREE from 'three'
import '../scripts/domstub.js'
import { preloadUserModel, userModelReady, createUserModel } from '../src/game/usermodel'
const OrigRequest = globalThis.Request as unknown as new (u: string, init?: RequestInit) => Request
;(globalThis as unknown as Record<string, unknown>).Request = class extends OrigRequest {
  constructor(u: string, init?: RequestInit) { if (typeof u === 'string' && u.startsWith('/')) u = 'http://localhost:3000' + u; super(u, init) }
}
;(globalThis as unknown as Record<string, unknown>).ProgressEvent = class { constructor(t: string, i: Record<string, unknown> = {}) { Object.assign(this, i) } }

async function main() {
  await preloadUserModel()
  if (!userModelReady()) { console.log('not ready'); process.exit(2) }
  for (const team of ['CT', 'T'] as const) {
    const inst = createUserModel(team)
    const colors: string[] = []
    inst.model.traverse(o => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mm of mats) {
        const sm = mm as THREE.MeshStandardMaterial
        if (sm.color) colors.push('#' + sm.color.getHexString())
      }
    })
    const uniq = [...new Set(colors)]
    console.log(team, 'tint colors:', uniq.slice(0, 6).join(' '), '(' + uniq.length + ' unique)')
  }
}
main()
