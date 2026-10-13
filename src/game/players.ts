// Remote player rendering: model + hitboxes + snapshot interpolation
import * as THREE from 'three'
import { bodyTexture } from './textures'
import { buildGunStub } from './fx'
import type { TeamId } from './weapons'

export interface RemotePlayer {
  id: string
  name: string
  team: TeamId
  bot: boolean
  alive: boolean
  hp: number
  // root transform (feet position)
  root: THREE.Group
  bodyMesh: THREE.Mesh
  headMesh: THREE.Mesh
  legsMesh: THREE.Mesh
  gunStub: THREE.Group
  nameSprite: THREE.Sprite | null
  // hitboxes (invisible, raycastable)
  hbHead: THREE.Mesh
  hbBody: THREE.Mesh
  hbLegs: THREE.Mesh
  // interpolation buffer
  buf: Array<{ t: number; x: number; y: number; z: number; yaw: number; pitch: number; crouch: boolean }>
  kills: number
  deaths: number
  money: number
  weapon: string
  hasBomb: boolean
  deathAt: number
}

const HEAD_R = 0.16

function nameSpriteTex(name: string, team: TeamId): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 64
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 34px "Arial Narrow", sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 8, 256, 48)
  ctx.fillStyle = team === 'CT' ? '#9ec9ee' : '#f0c878'
  ctx.fillText(name.slice(0, 14), 128, 32)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class PlayerManager {
  players = new Map<string, RemotePlayer>()
  private scene: THREE.Scene
  private myTeam: TeamId

  constructor(scene: THREE.Scene, myTeam: TeamId) {
    this.scene = scene
    this.myTeam = myTeam
  }

  setMyTeam(t: TeamId) { this.myTeam = t }

  getOrCreate(id: string, name: string, team: TeamId, bot: boolean): RemotePlayer {
    let p = this.players.get(id)
    if (p) return p
    const root = new THREE.Group()
    const bodyMat = new THREE.MeshLambertMaterial({ map: bodyTexture(team) })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat)
    body.position.y = 1.18
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.8, 0.28), new THREE.MeshLambertMaterial({ color: team === 'CT' ? 0x3f5a72 : 0x6e5a3a }))
    legs.position.y = 0.4
    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 12, 10), new THREE.MeshLambertMaterial({ color: 0xd8b590 }))
    head.position.y = 1.62
    const gunStub = buildGunStub()
    root.add(body, legs, head, gunStub)

    // nametag only for teammates
    let sprite: THREE.Sprite | null = null
    if (team === this.myTeam && !bot) {
      const tex = nameSpriteTex(name, team)
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
      sprite.scale.set(1.6, 0.4, 1)
      sprite.position.y = 2.1
      root.add(sprite)
    }

    // invisible hitboxes
    const hbMat = new THREE.MeshBasicMaterial({ visible: false })
    const hbHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), hbMat)
    hbHead.position.y = 1.62
    hbHead.userData = { pid: id, part: 'head' }
    const hbBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.42), hbMat)
    hbBody.position.y = 1.15
    hbBody.userData = { pid: id, part: 'body' }
    const hbLegs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.82, 0.36), hbMat)
    hbLegs.position.y = 0.4
    hbLegs.userData = { pid: id, part: 'legs' }
    root.add(hbHead, hbBody, hbLegs)

    this.scene.add(root)
    p = {
      id, name, team, bot, alive: true, hp: 100,
      root, bodyMesh: body, headMesh: head, legsMesh: legs, gunStub,
      nameSprite: sprite,
      hbHead, hbBody, hbLegs,
      buf: [], kills: 0, deaths: 0, money: 0, weapon: 'knife', hasBomb: false,
      deathAt: 0,
    }
    this.players.set(id, p)
    return p
  }

  remove(id: string) {
    const p = this.players.get(id)
    if (!p) return
    this.scene.remove(p.root)
    this.players.delete(id)
  }

  pushSnapshot(id: string, t: number, x: number, y: number, z: number, yaw: number, pitch: number, crouch: boolean) {
    const p = this.players.get(id)
    if (!p) return
    p.buf.push({ t, x, y, z, yaw, pitch, crouch })
    if (p.buf.length > 12) p.buf.shift()
  }

  /** interpolate at render time */
  update(renderT: number, myId: string) {
    const delay = 130
    const target = renderT - delay
    for (const p of this.players.values()) {
      if (p.id === myId) continue
      const buf = p.buf
      if (!buf.length) continue
      let a = buf[0], b = buf[buf.length - 1]
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= target && buf[i + 1].t >= target) { a = buf[i]; b = buf[i + 1]; break }
      }
      const span = Math.max(1, b.t - a.t)
      let k = Math.min(1.2, Math.max(0, (target - a.t) / span))
      // yaw lerp shortest
      let dy = b.yaw - a.yaw
      while (dy > Math.PI) dy -= 2 * Math.PI
      while (dy < -Math.PI) dy += 2 * Math.PI
      const x = a.x + (b.x - a.x) * k
      const y = a.y + (b.y - a.y) * k
      const z = a.z + (b.z - a.z) * k
      const yaw = a.yaw + dy * k
      p.root.position.set(x, y, z)
      p.root.rotation.y = yaw
      const crouch = b.crouch
      const scale = crouch ? 0.68 : 1
      p.bodyMesh.position.y = 1.18 * scale
      p.headMesh.position.y = 1.62 * scale
      p.hbHead.position.y = 1.62 * scale
      p.hbBody.position.y = 1.15 * scale
      p.hbLegs.position.y = 0.4
      p.gunStub.position.y = crouch ? -0.35 : 0
      // dead: fall over
      if (!p.alive) {
        const since = (performance.now() - p.deathAt) / 1000
        p.root.rotation.x = Math.min(Math.PI / 2, since * 4)
        p.root.position.y = y + Math.max(-0.35, -since * 0.3)
        if (p.nameSprite) p.nameSprite.visible = false
        p.hbHead.visible = false
        p.hbBody.visible = false
        p.hbLegs.visible = false
      } else {
        p.root.rotation.x = 0
        p.hbHead.visible = true
        p.hbBody.visible = true
        p.hbLegs.visible = true
        if (p.nameSprite) {
          // hide names of players not visible in view? keep always for teammates
          p.nameSprite.visible = true
        }
      }
    }
  }

  hitboxMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    for (const p of this.players.values()) {
      if (!p.alive) continue
      out.push(p.hbHead, p.hbBody, p.hbLegs)
    }
    return out
  }

  getById(id: string) { return this.players.get(id) }

  currentPos(id: string): THREE.Vector3 | null {
    const p = this.players.get(id)
    if (!p) return null
    return p.root.position.clone()
  }
}
