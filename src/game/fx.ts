// Visual effects + procedural weapon viewmodels
import * as THREE from 'three'
import type { WeaponId } from './weapons'

// ---------------- sprite textures ----------------
function radialTex(inner: string, outer: string, size = 64): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2)
  g.addColorStop(0, inner)
  g.addColorStop(0.4, inner)
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const flashTex = () => radialTex('rgba(255,240,180,1)', 'rgba(255,180,60,0)')
const smokeTex = () => radialTex('rgba(200,190,170,0.85)', 'rgba(200,190,170,0)')
const bloodTex = () => radialTex('rgba(190,20,20,0.95)', 'rgba(120,10,10,0)')

interface FxItem { obj: THREE.Object3D; born: number; life: number; vel?: THREE.Vector3; kind: string }

export class Effects {
  private scene: THREE.Scene
  private items: FxItem[] = []
  private tracerMat: THREE.LineBasicMaterial
  private flashSpriteTex = flashTex()
  private smokeSpriteTex = smokeTex()
  private bloodSpriteTex = bloodTex()
  private flashLight: THREE.PointLight

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.tracerMat = new THREE.LineBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.flashLight = new THREE.PointLight(0xffc860, 0, 8)
    scene.add(this.flashLight)
  }

  update(dt: number, cameraPos: THREE.Vector3) {
    const now = performance.now()
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      const age = (now - it.born) / 1000
      if (age > it.life) {
        this.scene.remove(it.obj)
        if (it.obj instanceof THREE.Line) it.obj.geometry.dispose()
        this.items.splice(i, 1)
        continue
      }
      const k = age / it.life
      if (it.kind === 'tracer') {
        (it.obj as THREE.Line).material = this.tracerMat
        this.tracerMat.opacity = 0.9 * (1 - k)
      } else if (it.kind === 'flash') {
        const s = it.obj as THREE.Sprite
        const sm = s.material as THREE.SpriteMaterial
        sm.opacity = 1 - k
        const sc = 0.25 + k * 0.35
        s.scale.set(sc, sc, sc)
      } else if (it.kind === 'puff' || it.kind === 'blood') {
        const s = it.obj as THREE.Sprite
        if (it.vel) {
          it.obj.position.addScaledVector(it.vel, dt)
          it.vel.multiplyScalar(1 - 3.5 * dt)
          it.vel.y -= (it.kind === 'blood' ? 6 : 1.2) * dt
        }
        const sm = s.material as THREE.SpriteMaterial
        sm.opacity = (1 - k) * 0.85
        const sc = 0.12 + k * (it.kind === 'blood' ? 0.15 : 0.4)
        s.scale.set(sc, sc, sc)
      } else if (it.kind === 'explosion') {
        const s = it.obj as THREE.Sprite
        const sm = s.material as THREE.SpriteMaterial
        sm.opacity = (1 - k) * 0.95
        const sc = 2 + k * 16
        s.scale.set(sc, sc, sc)
      } else if (it.kind === 'shellcase') {
        it.obj.rotation.x += 12 * dt
        it.obj.rotation.z += 9 * dt
        if (it.vel) {
          it.obj.position.addScaledVector(it.vel, dt)
          it.vel.y -= 12 * dt
        }
        if (age > it.life * 0.7) {
          const sm = (it.obj as THREE.Mesh).material as THREE.MeshBasicMaterial
          sm.opacity = 1 - (k - 0.7) / 0.3
        }
      }
    }
    // muzzle light decay
    this.flashLight.intensity *= Math.pow(0.0001, dt)
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()])
    const line = new THREE.Line(geo, this.tracerMat)
    this.scene.add(line)
    this.items.push({ obj: line, born: performance.now(), life: 0.07, kind: 'tracer' })
  }

  muzzleFlash(at: THREE.Vector3) {
    const mat = new THREE.SpriteMaterial({
      map: this.flashSpriteTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      rotation: Math.random() * Math.PI,
    })
    const s = new THREE.Sprite(mat)
    s.position.copy(at)
    s.scale.set(0.25, 0.25, 0.25)
    this.scene.add(s)
    this.items.push({ obj: s, born: performance.now(), life: 0.06, kind: 'flash' })
    this.flashLight.position.copy(at)
    this.flashLight.intensity = 2.5
  }

  impact(at: THREE.Vector3, normal?: THREE.Vector3) {
    // dust puff + sparks
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.smokeSpriteTex, transparent: true, depthWrite: false })
      const s = new THREE.Sprite(mat)
      s.position.copy(at)
      this.scene.add(s)
      const vel = new THREE.Vector3((Math.random() - 0.5) * 2.2, Math.random() * 1.8 + 0.4, (Math.random() - 0.5) * 2.2)
      if (normal) vel.addScaledVector(normal, 1.5)
      this.items.push({ obj: s, born: performance.now(), life: 0.45 + Math.random() * 0.25, vel, kind: 'puff' })
    }
  }

  blood(at: THREE.Vector3) {
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.bloodSpriteTex, transparent: true, depthWrite: false })
      const s = new THREE.Sprite(mat)
      s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2))
      this.scene.add(s)
      const vel = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3)
      this.items.push({ obj: s, born: performance.now(), life: 0.5, vel, kind: 'blood' })
    }
  }

  explosion(at: THREE.Vector3) {
    const mat = new THREE.SpriteMaterial({
      map: this.flashSpriteTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const s = new THREE.Sprite(mat)
    s.position.copy(at)
    this.scene.add(s)
    this.items.push({ obj: s, born: performance.now(), life: 0.9, kind: 'explosion' })
  }

  shell(pos: THREE.Vector3, dir: THREE.Vector3) {
    const geo = new THREE.BoxGeometry(0.02, 0.02, 0.05)
    const mat = new THREE.MeshBasicMaterial({ color: 0xd9a441, transparent: true })
    const m = new THREE.Mesh(geo, mat)
    m.position.copy(pos)
    this.scene.add(m)
    const vel = dir.clone().multiplyScalar(1.6).add(new THREE.Vector3(0, 1.4, 0))
    this.items.push({ obj: m, born: performance.now(), life: 1.2, vel, kind: 'shellcase' })
  }
}

// ---------------- procedural viewmodels ----------------
const woodMat = () => new THREE.MeshLambertMaterial({ color: 0x7a4f28 })
const darkMetal = () => new THREE.MeshLambertMaterial({ color: 0x2b2f33 })
const gunMetal = () => new THREE.MeshLambertMaterial({ color: 0x43494e })
const blackPoly = () => new THREE.MeshLambertMaterial({ color: 0x22262a })

function part(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  g.add(m)
  return m
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const cyl = (r: number, len: number) => new THREE.CylinderGeometry(r, r, len, 10)

/** Returns group positioned relative to camera; muzzle tip at zTip (negative forward). */
export function buildViewModel(weapon: WeaponId): { group: THREE.Group; tip: THREE.Vector3 } {
  const g = new THREE.Group()
  let tipZ = -0.55
  switch (weapon) {
    case 'ak47': {
      part(g, box(0.055, 0.075, 0.34), blackPoly(), 0, 0, -0.16)             // receiver
      part(g, cyl(0.012, 0.4), gunMetal(), 0, 0.006, -0.5, Math.PI / 2)     // barrel
      part(g, cyl(0.02, 0.09), gunMetal(), 0, 0.006, -0.33, Math.PI / 2)    // gas block
      part(g, box(0.05, 0.1, 0.13), woodMat(), 0, -0.075, -0.12, 0.35)      // mag (curved-ish tilt)
      part(g, box(0.045, 0.06, 0.17), woodMat(), 0, -0.01, 0.08)            // handguard
      part(g, box(0.04, 0.07, 0.16), woodMat(), 0, -0.02, 0.15)             // stock
      part(g, box(0.012, 0.02, 0.02), blackPoly(), 0, 0.05, -0.6)           // front sight
      tipZ = -0.72
      break
    }
    case 'm4': {
      part(g, box(0.05, 0.07, 0.3), blackPoly(), 0, 0, -0.14)
      part(g, cyl(0.011, 0.34), blackPoly(), 0, 0.004, -0.44, Math.PI / 2)
      part(g, cyl(0.018, 0.07), gunMetal(), 0, 0.004, -0.26, Math.PI / 2)   // suppressor-ish
      part(g, box(0.045, 0.09, 0.1), blackPoly(), 0, -0.07, -0.1, 0.15)
      part(g, box(0.042, 0.05, 0.2), blackPoly(), 0, 0, 0.02)
      part(g, box(0.014, 0.035, 0.12), blackPoly(), 0, 0.05, -0.12)         // carry handle rail
      tipZ = -0.62
      break
    }
    case 'awp': {
      part(g, box(0.05, 0.08, 0.42), gunMetal(), 0, 0, -0.2)
      part(g, cyl(0.013, 0.5), gunMetal(), 0, 0.005, -0.62, Math.PI / 2)
      part(g, cyl(0.024, 0.16), darkMetal(), 0, 0.065, -0.25, Math.PI / 2)  // scope
      part(g, cyl(0.028, 0.02), darkMetal(), 0, 0.065, -0.17, Math.PI / 2)
      part(g, box(0.05, 0.11, 0.12), blackPoly(), 0, -0.08, -0.16, 0.3)
      part(g, box(0.045, 0.075, 0.2), blackPoly(), 0, -0.02, 0.12)
      tipZ = -0.88
      break
    }
    case 'mp5': {
      part(g, box(0.05, 0.07, 0.24), blackPoly(), 0, 0, -0.12)
      part(g, cyl(0.02, 0.18), darkMetal(), 0, 0.004, -0.32, Math.PI / 2)   // suppressor
      part(g, box(0.04, 0.09, 0.08), blackPoly(), 0, -0.07, -0.08, 0.2)
      part(g, box(0.035, 0.05, 0.16), blackPoly(), 0, 0, 0.06)
      tipZ = -0.52
      break
    }
    case 'deagle': {
      part(g, box(0.045, 0.06, 0.22), gunMetal(), 0, 0.01, -0.1)
      part(g, cyl(0.008, 0.06), gunMetal(), 0, 0.028, -0.2, Math.PI / 2)
      part(g, box(0.04, 0.1, 0.05), blackPoly(), 0, -0.055, 0.02, 0.25)     // grip
      part(g, box(0.01, 0.015, 0.02), darkMetal(), 0, 0.045, -0.19)
      tipZ = -0.35
      break
    }
    case 'glock': case 'usp': {
      const col = weapon === 'usp' ? 0x30343a : 0x2a2e33
      part(g, box(0.04, 0.05, 0.18), new THREE.MeshLambertMaterial({ color: col }), 0, 0.01, -0.08)
      if (weapon === 'usp') part(g, cyl(0.016, 0.1), darkMetal(), 0, 0.012, -0.22, Math.PI / 2) // suppressor
      part(g, box(0.036, 0.09, 0.045), blackPoly(), 0, -0.05, 0.01, 0.22)
      tipZ = weapon === 'usp' ? -0.4 : -0.22
      break
    }
    case 'knife': {
      part(g, box(0.012, 0.035, 0.16), new THREE.MeshLambertMaterial({ color: 0xb9c2c8 }), 0, 0.01, -0.12) // blade
      part(g, box(0.02, 0.03, 0.09), blackPoly(), 0, -0.005, 0.0)           // handle
      tipZ = -0.2
      break
    }
    case 'c4': {
      part(g, box(0.13, 0.05, 0.18), darkMetal(), 0, 0, -0.1)
      part(g, box(0.06, 0.02, 0.05), new THREE.MeshLambertMaterial({ color: 0x113311 }), 0, 0.03, -0.1) // screen
      part(g, box(0.02, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: 0xff2222 }), 0.04, 0.03, -0.02) // LED
      tipZ = -0.2
      break
    }
  }
  return { group: g, tip: new THREE.Vector3(0, 0.02, tipZ) }
}

// remote player weapon stub (simple silhouette)
export function buildGunStub(): THREE.Group {
  const g = new THREE.Group()
  const m = new THREE.Mesh(box(0.05, 0.07, 0.5), darkMetal())
  m.position.set(0.16, 1.32, -0.25)
  g.add(m)
  return g
}

export function buildBombMesh(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(box(0.36, 0.14, 0.26), new THREE.MeshLambertMaterial({ color: 0x3a3f45 }))
  g.add(body)
  const led = new THREE.Mesh(box(0.05, 0.03, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2020 }))
  led.position.set(0.1, 0.085, 0.05)
  g.add(led)
  ;(g as THREE.Group & { userData: { led?: THREE.Mesh } }).userData.led = led
  return g
}
