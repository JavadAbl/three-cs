// Procedural canvas textures — zero external assets, fully self-contained
import * as THREE from 'three'

function makeCanvas(w = 256, h = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return [c, c.getContext('2d')!]
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const x = Math.random() * w, y = Math.random() * h
    const s = 1 + Math.random() * 3
    const v = Math.floor(Math.random() * 90)
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`
    ctx.fillRect(x, y, s, s)
  }
}

function finish(c: HTMLCanvasElement, rx: number, ry: number): THREE.Texture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.anisotropy = 4
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function sandTexture(rx: number, ry: number): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#c2a878'
  ctx.fillRect(0, 0, 256, 256)
  // patchy variations
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256, y = Math.random() * 256
    const r = 10 + Math.random() * 40
    ctx.fillStyle = `rgba(${150 + Math.random() * 40 | 0},${130 + Math.random() * 35 | 0},${95 + Math.random() * 30 | 0},0.18)`
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  noise(ctx, 256, 256, 4000, 0.1)
  // small stones
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * 256, y = Math.random() * 256
    ctx.fillStyle = 'rgba(90,75,55,0.35)'
    ctx.fillRect(x, y, 1.5, 1.5)
  }
  return finish(c, rx, ry)
}

export function wallTexture(rx: number, ry: number): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#b59968'
  ctx.fillRect(0, 0, 256, 256)
  // horizontal plaster bands
  for (let y = 0; y < 256; y += 42) {
    ctx.fillStyle = `rgba(${160 + Math.random() * 25 | 0},${135 + Math.random() * 20 | 0},${95 + Math.random() * 15 | 0},0.5)`
    ctx.fillRect(0, y, 256, 40)
  }
  // cracks
  ctx.strokeStyle = 'rgba(80,60,40,0.35)'
  for (let i = 0; i < 12; i++) {
    ctx.beginPath()
    let x = Math.random() * 256, y = Math.random() * 256
    ctx.moveTo(x, y)
    for (let s = 0; s < 5; s++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 25; ctx.lineTo(x, y) }
    ctx.stroke()
  }
  noise(ctx, 256, 256, 3000, 0.09)
  return finish(c, rx, ry)
}

export function crateTexture(rx: number, ry: number): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#8a6a42'
  ctx.fillRect(0, 0, 256, 256)
  // planks
  for (let y = 0; y < 256; y += 64) {
    ctx.fillStyle = `rgb(${125 + Math.random() * 30 | 0},${92 + Math.random() * 22 | 0},${52 + Math.random() * 18 | 0})`
    ctx.fillRect(0, y, 256, 60)
    ctx.fillStyle = 'rgba(60,40,20,0.5)'
    ctx.fillRect(0, y + 60, 256, 4)
  }
  // wood grain
  ctx.strokeStyle = 'rgba(70,48,26,0.25)'
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * 256
    ctx.beginPath(); ctx.moveTo(0, y)
    ctx.bezierCurveTo(80, y + 6, 160, y - 6, 256, y + 2)
    ctx.stroke()
  }
  // frame edges
  ctx.strokeStyle = 'rgba(50,32,16,0.8)'
  ctx.lineWidth = 8
  ctx.strokeRect(4, 4, 248, 248)
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(256, 256); ctx.moveTo(256, 0); ctx.lineTo(0, 256); ctx.stroke()
  noise(ctx, 256, 256, 1500, 0.07)
  return finish(c, rx, ry)
}

export function metalTexture(rx: number, ry: number): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#6a7075'
  ctx.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 256; y += 16) {
    ctx.fillStyle = `rgba(${100 + Math.random() * 30 | 0},${106 + Math.random() * 28 | 0},${112 + Math.random() * 26 | 0},0.5)`
    ctx.fillRect(0, y, 256, 14)
  }
  // rivets
  for (let x = 16; x < 256; x += 48) {
    for (let y = 16; y < 256; y += 48) {
      ctx.fillStyle = 'rgba(40,44,48,0.8)'
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill()
      ctx.fillStyle = 'rgba(180,186,190,0.5)'
      ctx.beginPath(); ctx.arc(x - 1, y - 1, 1.4, 0, 7); ctx.fill()
    }
  }
  // rust
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 256, y = Math.random() * 256
    ctx.fillStyle = 'rgba(140,80,40,0.15)'
    ctx.beginPath(); ctx.arc(x, y, 4 + Math.random() * 14, 0, 7); ctx.fill()
  }
  noise(ctx, 256, 256, 2000, 0.08)
  return finish(c, rx, ry)
}

export function darkTexture(rx: number, ry: number): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#5d5346'
  ctx.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 256; y += 36) {
    ctx.fillStyle = `rgba(${85 + Math.random() * 20 | 0},${76 + Math.random() * 18 | 0},${62 + Math.random() * 14 | 0},0.6)`
    ctx.fillRect(0, y, 256, 33)
  }
  noise(ctx, 256, 256, 2500, 0.12)
  return finish(c, rx, ry)
}

export function plankTexture(rx: number, ry: number): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#96774c'
  ctx.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 256; y += 52) {
    ctx.fillStyle = `rgb(${135 + Math.random() * 25 | 0},${105 + Math.random() * 18 | 0},${62 + Math.random() * 15 | 0})`
    ctx.fillRect(0, y, 256, 48)
  }
  ctx.strokeStyle = 'rgba(60,40,22,0.5)'
  ctx.lineWidth = 3
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * 256
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y + (Math.random() - 0.5) * 10); ctx.stroke()
  }
  noise(ctx, 256, 256, 1200, 0.06)
  return finish(c, rx, ry)
}

export function doorTexture(rx: number, ry: number): THREE.Texture {
  const [c, ctx] = makeCanvas()
  ctx.fillStyle = '#596066'
  ctx.fillRect(0, 0, 256, 256)
  ctx.fillStyle = '#4c5257'
  ctx.fillRect(12, 12, 232, 232)
  ctx.strokeStyle = 'rgba(30,34,38,0.8)'
  ctx.lineWidth = 10
  ctx.strokeRect(6, 6, 244, 244)
  // handle
  ctx.fillStyle = '#2f3438'
  ctx.beginPath(); ctx.arc(210, 128, 10, 0, 7); ctx.fill()
  noise(ctx, 256, 256, 1600, 0.1)
  return finish(c, rx, ry)
}

// remote player body texture with team color tint
export function bodyTexture(team: 'CT' | 'T'): THREE.Texture {
  const [c, ctx] = makeCanvas(128, 128)
  const base = team === 'CT' ? '#5b7f9e' : '#b08d57'
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 128, 128)
  // vest straps
  ctx.fillStyle = 'rgba(30,30,30,0.55)'
  ctx.fillRect(0, 24, 128, 10)
  ctx.fillRect(0, 84, 128, 10)
  ctx.fillRect(54, 0, 12, 128)
  noise(ctx, 128, 128, 800, 0.1)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// sky: simple gradient canvas on a big sphere
export function skyMesh(): THREE.Mesh {
  const [c, ctx] = makeCanvas(64, 256)
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#8fb8d8')
  g.addColorStop(0.45, '#c9d8e2')
  g.addColorStop(0.62, '#e8d9b8')
  g.addColorStop(1, '#d8c49a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.SphereGeometry(300, 24, 16)
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  return new THREE.Mesh(geo, mat)
}

// bomb site decal ring texture
export function siteDecal(letter: 'A' | 'B'): THREE.Mesh {
  const [c, ctx] = makeCanvas(256, 256)
  ctx.strokeStyle = 'rgba(230,60,50,0.85)'
  ctx.lineWidth = 10
  ctx.setLineDash([28, 18])
  ctx.strokeRect(14, 14, 228, 228)
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(230,60,50,0.85)'
  ctx.font = 'bold 120px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(letter, 128, 132)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.PlaneGeometry(13, 13)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false })
  const m = new THREE.Mesh(geo, mat)
  m.rotation.x = -Math.PI / 2
  return m
}
