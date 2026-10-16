// Visual effects (tracers, flashes, impacts, shells, dropped mags)
import * as THREE from 'three'
import { texMat, box } from './weaponmodels'
import { bulletHoleTexture, scorchTexture } from './textures'

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

/** Star-burst muzzle flash texture (spikes + hot core). */
function starTex(): THREE.Texture {
  const S = 96
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')!
  const cx = S / 2, cy = S / 2
  // spikes
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3
    const len = 20 + (i % 3) * 11
    const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len)
    g.addColorStop(0, 'rgba(255,250,220,0.95)')
    g.addColorStop(1, 'rgba(255,190,80,0)')
    ctx.strokeStyle = g
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len)
    ctx.stroke()
  }
  // hot core
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 16)
  g.addColorStop(0, 'rgba(255,255,240,1)')
  g.addColorStop(0.5, 'rgba(255,230,160,0.9)')
  g.addColorStop(1, 'rgba(255,200,90,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Expanding shockwave ring texture. */
function ringTex(): THREE.Texture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2)
  g.addColorStop(0.62, 'rgba(255,230,180,0)')
  g.addColorStop(0.76, 'rgba(255,236,200,0.75)')
  g.addColorStop(0.9, 'rgba(255,210,150,0.25)')
  g.addColorStop(1, 'rgba(255,200,140,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const sparkTex = () => radialTex('rgba(255,255,230,1)', 'rgba(255,180,60,0)', 32)

interface FxItem { obj: THREE.Object3D; born: number; life: number; vel?: THREE.Vector3; kind: string; mat?: THREE.Material }

const MAX_DECALS = 48

export class Effects {
  private scene: THREE.Scene
  private items: FxItem[] = []
  private decals: Array<{ mesh: THREE.Mesh; mat: THREE.Material; born: number; life: number }> = []
  private flashSpriteTex = flashTex()
  private starSpriteTex = starTex()
  private smokeSpriteTex = smokeTex()
  private bloodSpriteTex = bloodTex()
  private sparkSpriteTex = sparkTex()
  private ringSpriteTex = ringTex()
  private holeTex = bulletHoleTexture()
  private scorchTex = scorchTexture()
  private flashLight: THREE.PointLight
  private explLight: THREE.PointLight
  // dust motes (ambient atmosphere)
  private motes: THREE.Points | null = null
  private moteVel: Float32Array = new Float32Array(0)

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.flashLight = new THREE.PointLight(0xffc860, 0, 9)
    scene.add(this.flashLight)
    this.explLight = new THREE.PointLight(0xff8830, 0, 26)
    scene.add(this.explLight)
    this.initMotes()
  }

  // ---------------- ambient dust motes ----------------
  private initMotes() {
    const N = 170
    const pos = new Float32Array(N * 3)
    this.moteVel = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44
      pos[i * 3 + 1] = Math.random() * 8 + 0.3
      pos[i * 3 + 2] = (Math.random() - 0.5) * 44
      this.moteVel[i * 3] = (Math.random() - 0.5) * 0.14
      this.moteVel[i * 3 + 1] = (Math.random() - 0.5) * 0.05
      this.moteVel[i * 3 + 2] = (Math.random() - 0.5) * 0.14
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xd8c8a2, size: 0.035, sizeAttenuation: true,
      transparent: true, opacity: 0.3, depthWrite: false,
    })
    this.motes = new THREE.Points(geo, mat)
    this.motes.frustumCulled = false
    this.scene.add(this.motes)
  }

  private updateMotes(dt: number, cam: THREE.Vector3) {
    if (!this.motes) return
    const arr = (this.motes.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
    for (let i = 0; i < arr.length / 3; i++) {
      let x = arr[i * 3] + this.moteVel[i * 3] * dt
      let y = arr[i * 3 + 1] + this.moteVel[i * 3 + 1] * dt
      let z = arr[i * 3 + 2] + this.moteVel[i * 3 + 2] * dt
      // wrap around camera in a 44x8x44 box
      if (x - cam.x > 22) x -= 44; else if (x - cam.x < -22) x += 44
      if (z - cam.z > 22) z -= 44; else if (z - cam.z < -22) z += 44
      if (y > 8.5) y = 0.3; else if (y < 0.25) y = 8
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z
    }
    (this.motes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
  }

  update(dt: number, cameraPos: THREE.Vector3) {
    const now = performance.now()
    this.updateMotes(dt, cameraPos)
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      const age = (now - it.born) / 1000
      if (age > it.life) {
        this.scene.remove(it.obj)
        this.disposeItem(it)
        this.items.splice(i, 1)
        continue
      }
      const k = age / it.life
      switch (it.kind) {
        case 'tracer': {
          const m = (it.obj as THREE.Mesh).material as THREE.MeshBasicMaterial
          m.opacity = 0.85 * (1 - k)
          break
        }
        case 'flash': {
          const s = it.obj as THREE.Sprite
          const sm = s.material as THREE.SpriteMaterial
          sm.opacity = 1 - k
          const sc = 0.22 + k * 0.5
          s.scale.set(sc, sc, sc)
          break
        }
        case 'flashBig': {
          const s = it.obj as THREE.Sprite
          const sm = s.material as THREE.SpriteMaterial
          sm.opacity = 1 - k
          const sc = 2.5 + k * 9
          s.scale.set(sc, sc, sc)
          break
        }
        case 'puff': case 'blood': case 'spark': case 'smoke': {
          const s = it.obj as THREE.Sprite
          if (it.vel) {
            it.obj.position.addScaledVector(it.vel, dt)
            const g = it.kind === 'spark' ? 9 : it.kind === 'blood' ? 6 : it.kind === 'smoke' ? -1.1 : 1.2
            it.vel.y -= g * dt
            it.vel.multiplyScalar(1 - (it.kind === 'spark' ? 1.5 : 3.2) * dt)
          }
          const sm = s.material as THREE.SpriteMaterial
          sm.opacity = (1 - k) * (it.kind === 'smoke' ? 0.5 : it.kind === 'spark' ? 1 : 0.85)
          const base = it.kind === 'spark' ? 0.05 : it.kind === 'smoke' ? 1.1 : 0.12
          const grow = it.kind === 'spark' ? 0.01 : it.kind === 'smoke' ? 2.4 : it.kind === 'blood' ? 0.15 : 0.4
          const sc = base + k * grow
          s.scale.set(sc, sc, sc)
          break
        }
        case 'ring': {
          const s = it.obj as THREE.Sprite
          const sm = s.material as THREE.SpriteMaterial
          sm.opacity = 0.8 * (1 - k)
          const sc = 0.6 + k * 14
          s.scale.set(sc, sc, sc)
          break
        }
        case 'explosion': {
          const s = it.obj as THREE.Sprite
          const sm = s.material as THREE.SpriteMaterial
          sm.opacity = (1 - k) * 0.95
          const sc = 1.2 + k * 7
          s.scale.set(sc, sc, sc)
          break
        }
        case 'debris': case 'shellcase': {
          const m = it.obj as THREE.Mesh
          m.rotation.x += 11 * dt
          m.rotation.z += 8 * dt
          if (it.vel) {
            it.obj.position.addScaledVector(it.vel, dt)
            it.vel.y -= 13 * dt
          }
          const mat = m.material as THREE.MeshBasicMaterial
          if (age > it.life * 0.75) mat.opacity = 1 - (k - 0.75) / 0.25
          break
        }
      }
    }
    // decals: fade + recycle
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]
      const age = (now - d.born) / 1000
      if (age > d.life) {
        this.scene.remove(d.mesh)
        d.mesh.geometry.dispose()
        d.mat.dispose()
        this.decals.splice(i, 1)
        continue
      }
      if (age > d.life - 3) {
        (d.mesh.material as THREE.MeshBasicMaterial).opacity = ((d.life - age) / 3) * d.mesh.userData.baseOpacity
      }
    }
    // light decay
    this.flashLight.intensity *= Math.pow(0.0001, dt)
    this.explLight.intensity *= Math.pow(0.00001, dt)
  }

  private disposeItem(it: FxItem) {
    if (it.obj instanceof THREE.Mesh) {
      it.obj.geometry.dispose() // tracer/debris/shell geometry is per-instance
      const mat = it.obj.material as THREE.Material
      if (mat && it.kind !== 'shellcase' && it.kind !== 'debris') mat.dispose()
    }
    // sprites share textures; only dispose their per-instance material
    if (it.obj instanceof THREE.Sprite) (it.obj.material as THREE.Material).dispose()
  }

  private sprite(tex: THREE.Texture, at: THREE.Vector3, additive: boolean, color = 0xffffff): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, color,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      rotation: Math.random() * Math.PI,
    })
    const s = new THREE.Sprite(mat)
    s.position.copy(at)
    this.scene.add(s)
    return s
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const len = from.distanceTo(to)
    if (len < 1) return
    const geo = new THREE.CylinderGeometry(0.02, 0.02, len, 5, 1, true)
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)) // axis → Z
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const m = new THREE.Mesh(geo, mat)
    m.position.copy(from).add(to).multiplyScalar(0.5)
    m.lookAt(to)
    this.scene.add(m)
    this.items.push({ obj: m, born: performance.now(), life: 0.075, kind: 'tracer' })
  }

  muzzleFlash(at: THREE.Vector3) {
    // hot star core
    const s = this.sprite(this.starSpriteTex, at, true)
    s.scale.set(0.22, 0.22, 0.22)
    this.items.push({ obj: s, born: performance.now(), life: 0.055, kind: 'flash' })
    // wide glow
    const g = this.sprite(this.flashSpriteTex, at, true)
    g.scale.set(0.4, 0.4, 0.4)
    this.items.push({ obj: g, born: performance.now(), life: 0.08, kind: 'flash' })
    // smoke wisp
    const sm = this.sprite(this.smokeSpriteTex, at, false, 0xcbb693)
    sm.scale.set(0.1, 0.1, 0.1)
    this.items.push({
      obj: sm, born: performance.now(), life: 0.6, kind: 'smoke',
      vel: new THREE.Vector3(0, 0.7, 0),
    })
    this.flashLight.position.copy(at)
    this.flashLight.intensity = 3.2
  }

  impact(at: THREE.Vector3, normal?: THREE.Vector3, surf?: string) {
    const n = normal ?? new THREE.Vector3(0, 1, 0)
    const metal = surf === 'metal' || surf === 'door' || surf === 'doorBlue'
    // dust puffs (fewer on metal)
    const puffs = metal ? 2 : 4
    for (let i = 0; i < puffs; i++) {
      const s = this.sprite(this.smokeSpriteTex, at, false, metal ? 0x9a9a92 : 0xcbb693)
      s.scale.set(0.12, 0.12, 0.12)
      const vel = new THREE.Vector3((Math.random() - 0.5) * 2.2, Math.random() * 1.8 + 0.4, (Math.random() - 0.5) * 2.2)
      vel.addScaledVector(n, 1.4)
      this.items.push({ obj: s, born: performance.now(), life: 0.45 + Math.random() * 0.3, vel, kind: 'puff' })
    }
    // sparks (metal heavy)
    const sparks = metal ? 7 : 3
    for (let i = 0; i < sparks; i++) {
      const s = this.sprite(this.sparkSpriteTex, at, true)
      s.scale.set(0.05, 0.05, 0.05)
      const vel = new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3)
      vel.addScaledVector(n, 3 + Math.random() * 4)
      this.items.push({ obj: s, born: performance.now(), life: 0.18 + Math.random() * 0.16, vel, kind: 'spark' })
    }
    // debris chips
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BoxGeometry(0.02 + Math.random() * 0.03, 0.02, 0.02 + Math.random() * 0.03)
      const mat = new THREE.MeshBasicMaterial({ color: metal ? 0x6a6a68 : 0x8a7454, transparent: true })
      const m = new THREE.Mesh(geo, mat)
      m.position.copy(at)
      this.scene.add(m)
      const vel = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.4 + 0.8, (Math.random() - 0.5) * 3)
      vel.addScaledVector(n, 1.6)
      this.items.push({ obj: m, born: performance.now(), life: 0.55 + Math.random() * 0.2, vel, kind: 'debris' })
    }
    // bullet hole decal
    this.hole(at, n)
  }

  private hole(at: THREE.Vector3, n: THREE.Vector3) {
    const geo = new THREE.PlaneGeometry(0.12, 0.12)
    const mat = new THREE.MeshBasicMaterial({
      map: this.holeTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.95,
    })
    const m = new THREE.Mesh(geo, mat)
    m.position.copy(at).addScaledVector(n, 0.01)
    m.lookAt(at.clone().add(n))
    m.userData.baseOpacity = 0.95
    m.renderOrder = 1
    this.scene.add(m)
    this.decals.push({ mesh: m, mat, born: performance.now(), life: 16 })
    if (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift()!
      this.scene.remove(old.mesh)
      old.mesh.geometry.dispose()
      old.mat.dispose()
    }
  }

  blood(at: THREE.Vector3, dir?: THREE.Vector3) {
    const d = dir?.clone().normalize() ?? null
    for (let i = 0; i < 8; i++) {
      const s = this.sprite(this.bloodSpriteTex, at, false)
      s.scale.set(0.1, 0.1, 0.1)
      const vel = new THREE.Vector3((Math.random() - 0.5) * 2.6, Math.random() * 1.6, (Math.random() - 0.5) * 2.6)
      if (d) vel.addScaledVector(d, 1.6 + Math.random() * 2.2)
      this.items.push({ obj: s, born: performance.now(), life: 0.4 + Math.random() * 0.25, vel, kind: 'blood' })
    }
    // fine mist
    const mist = this.sprite(this.bloodSpriteTex, at, false, 0x991515)
    mist.scale.set(0.3, 0.3, 0.3)
    this.items.push({ obj: mist, born: performance.now(), life: 0.35, kind: 'smoke' })
  }

  explosion(at: THREE.Vector3) {
    // core flash
    const flash = this.sprite(this.starSpriteTex, at, true)
    flash.scale.set(3, 3, 3)
    this.items.push({ obj: flash, born: performance.now(), life: 0.14, kind: 'flashBig' })
    // fireball
    const fire = this.sprite(this.flashSpriteTex, at, true, 0xffb050)
    fire.scale.set(1.2, 1.2, 1.2)
    this.items.push({ obj: fire, born: performance.now(), life: 0.5, kind: 'explosion' })
    // shockwave ring on ground
    const ring = this.sprite(this.ringSpriteTex, new THREE.Vector3(at.x, at.y - 0.42, at.z), true)
    ring.scale.set(0.6, 0.6, 0.6)
    this.items.push({ obj: ring, born: performance.now(), life: 0.5, kind: 'ring' })
    // smoke column
    for (let i = 0; i < 7; i++) {
      const s = this.sprite(this.smokeSpriteTex, at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.2 + i * 0.5, (Math.random() - 0.5) * 1.2)), false, 0x5a5248)
      s.scale.set(1.1, 1.1, 1.1)
      this.items.push({
        obj: s, born: performance.now(), life: 1.9 + Math.random() * 0.8,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.8 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2),
        kind: 'smoke',
      })
    }
    // debris chunks
    for (let i = 0; i < 10; i++) {
      const sz = 0.05 + Math.random() * 0.1
      const geo = new THREE.BoxGeometry(sz, sz, sz)
      const mat = new THREE.MeshBasicMaterial({ color: 0x3a3228, transparent: true })
      const m = new THREE.Mesh(geo, mat)
      m.position.copy(at)
      this.scene.add(m)
      const a = Math.random() * Math.PI * 2
      const sp = 3 + Math.random() * 6
      this.items.push({
        obj: m, born: performance.now(), life: 1.2 + Math.random() * 0.5,
        vel: new THREE.Vector3(Math.cos(a) * sp, 4 + Math.random() * 5, Math.sin(a) * sp), kind: 'debris',
      })
    }
    // scorch mark on ground
    const scGeo = new THREE.PlaneGeometry(4.6, 4.6)
    const scMat = new THREE.MeshBasicMaterial({
      map: this.scorchTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, opacity: 0.8,
    })
    const sc = new THREE.Mesh(scGeo, scMat)
    sc.rotation.x = -Math.PI / 2
    sc.position.set(at.x, at.y - 0.44, at.z)
    sc.userData.baseOpacity = 0.8
    sc.renderOrder = 1
    this.scene.add(sc)
    this.decals.push({ mesh: sc, mat: scMat, born: performance.now(), life: 30 })
    // light
    this.explLight.position.copy(at).add(new THREE.Vector3(0, 1, 0))
    this.explLight.intensity = 26
  }

  shell(pos: THREE.Vector3, dir: THREE.Vector3) {
    const geo = new THREE.CylinderGeometry(0.007, 0.007, 0.026, 6)
    const mat = new THREE.MeshBasicMaterial({ color: 0xd9a441, transparent: true })
    const m = new THREE.Mesh(geo, mat)
    m.position.copy(pos)
    this.scene.add(m)
    const vel = dir.clone().multiplyScalar(1.5).add(new THREE.Vector3(0, 1.6, 0))
    this.items.push({ obj: m, born: performance.now(), life: 0.85, vel, kind: 'shellcase' })
  }

  /** dropped magazine during reload (textured, tumbles, fades) */
  dropMag(pos: THREE.Vector3) {
    const src = texMat('metal_dark', 1, 1, { roughnessMul: 0.8 })
    const mat = src.clone()
    mat.transparent = true
    const m = new THREE.Mesh(box(0.036, 0.12, 0.072), mat)
    m.position.copy(pos)
    this.scene.add(m)
    const vel = new THREE.Vector3(0.12, -0.15, 0.05)
    this.items.push({ obj: m, born: performance.now(), life: 2.4, vel, kind: 'debris' })
  }
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
