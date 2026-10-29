// Procedural canvas textures v2 — hi-res (512), seeded PRNG, auto-aligned bump maps.
// Zero external assets, fully self-contained.
import * as THREE from 'three'

export const TEX = 512

// ---------------- deterministic PRNG (stable look across reloads) ----------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(w = TEX, h = TEX): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return [c, c.getContext('2d')!]
}

/** Smooth, tileable-ish noise via small random canvas upscaled bilinearly (one fbm octave). */
function smoothNoise(ctx: CanvasRenderingContext2D, size: number, seed: number, cells: number, alpha: number) {
  const small = document.createElement('canvas')
  small.width = cells; small.height = cells
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(cells, cells)
  const rnd = mulberry32(seed)
  for (let i = 0; i < cells * cells; i++) {
    const v = 110 + rnd() * 90
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(small, 0, 0, size, size)
  ctx.restore()
}

/** Speck noise (grain / sand grains / dust). */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, n: number, alpha: number, sz = 2) {
  const rnd = mulberry32(seed)
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h
    const v = Math.floor(60 + rnd() * 140)
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`
    ctx.fillRect(x, y, 1 + rnd() * sz, 1 + rnd() * sz)
  }
}

function finish(c: HTMLCanvasElement, rx = 1, ry = 1, srgb = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Auto-aligned bump map derived from the diffuse (grayscale + contrast boost). */
function bumpFrom(c: HTMLCanvasElement, contrast = 1.55, brightness = 0.92): THREE.Texture {
  const [b, bctx] = makeCanvas(c.width, c.height)
  bctx.filter = `grayscale(1) contrast(${contrast}) brightness(${brightness})`
  bctx.drawImage(c, 0, 0)
  bctx.filter = 'none'
  return finish(b, 1, 1, false)
}

// ---------------- terrain ----------------
export function sandTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(101)
  ctx.fillStyle = '#c6ab7c'
  ctx.fillRect(0, 0, TEX, TEX)
  // large soft patches
  for (let i = 0; i < 26; i++) {
    const x = rnd() * TEX, y = rnd() * TEX
    const r = 40 + rnd() * 130
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    const warm = rnd() < 0.5
    g.addColorStop(0, warm ? 'rgba(184,158,112,0.16)' : 'rgba(214,196,156,0.15)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  // fbm noise octaves
  smoothNoise(ctx, TEX, 11, 128, 0.10)
  smoothNoise(ctx, TEX, 12, 32, 0.13)
  smoothNoise(ctx, TEX, 13, 8, 0.07)
  // faint wind ripples
  ctx.strokeStyle = 'rgba(120,100,70,0.05)'
  ctx.lineWidth = 10
  for (let i = 0; i < 7; i++) {
    const y0 = rnd() * TEX
    ctx.beginPath()
    for (let x = 0; x <= TEX; x += 32) ctx.lineTo(x, y0 + Math.sin((x + i * 60) * 0.012 + i) * 14)
    ctx.stroke()
  }
  grain(ctx, TEX, TEX, 14, 3200, 0.12, 2)
  // pebbles
  for (let i = 0; i < 150; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, r = 0.8 + rnd() * 1.8
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(96,80,58,0.5)' : 'rgba(168,150,116,0.45)'
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  return finish(c, rx, ry)
}

// ---------------- walls ----------------
export function wallTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(201)
  ctx.fillStyle = '#b89b68'
  ctx.fillRect(0, 0, TEX, TEX)
  // plaster tint bands (old whitewash layers)
  for (let y = 0; y < TEX; y += 84) {
    const warm = 150 + rnd() * 35 | 0
    ctx.fillStyle = `rgba(${warm + 16},${warm - 6},${warm - 42},0.22)`
    ctx.fillRect(0, y, TEX, 74)
  }
  // exposed brick patches (classic Dust2)
  for (let p = 0; p < 3; p++) {
    const px = rnd() * (TEX - 120), py = rnd() * (TEX - 110)
    const pw = 90 + rnd() * 80, ph = 70 + rnd() * 60
    ctx.save()
    ctx.beginPath()
    // rough-edged patch
    ctx.moveTo(px, py + rnd() * 12)
    for (let k = 0; k <= 8; k++) ctx.lineTo(px + (pw * k) / 8, py + rnd() * 16 - 8)
    for (let k = 0; k <= 6; k++) ctx.lineTo(px + pw - rnd() * 14, py + (ph * k) / 6)
    for (let k = 8; k >= 0; k--) ctx.lineTo(px + (pw * k) / 8, py + ph - rnd() * 16 + 8)
    for (let k = 6; k >= 0; k--) ctx.lineTo(px + rnd() * 14, py + (ph * k) / 6)
    ctx.closePath(); ctx.clip()
    ctx.fillStyle = '#6d5c4a'; ctx.fillRect(px - 10, py - 10, pw + 20, ph + 20) // mortar
    for (let row = 0; row * 30 < ph + 8; row++) {
      for (let col = -1; col * 66 < pw + 66; col++) {
        const bx = px + col * 66 + (row % 2 ? 33 : 0), by = py + row * 30
        const t = rnd()
        ctx.fillStyle = `rgb(${160 + t * 40 | 0},${104 + t * 26 | 0},${70 + t * 20 | 0})`
        ctx.fillRect(bx + 2, by + 2, 62, 26)
      }
    }
    ctx.restore()
  }
  // damp stains rising from base / from top
  for (let i = 0; i < 7; i++) {
    const x = rnd() * TEX, w = 18 + rnd() * 50
    const g = ctx.createLinearGradient(0, TEX, 0, TEX - 120 - rnd() * 140)
    g.addColorStop(0, 'rgba(88,72,50,0.20)')
    g.addColorStop(1, 'rgba(88,72,50,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, TEX - 240, w, 240)
  }
  // cracks
  ctx.strokeStyle = 'rgba(70,52,34,0.5)'
  ctx.lineWidth = 1.6
  for (let i = 0; i < 11; i++) {
    ctx.beginPath()
    let x = rnd() * TEX, y = rnd() * TEX
    ctx.moveTo(x, y)
    for (let s = 0; s < 5; s++) { x += (rnd() - 0.5) * 60; y += rnd() * 34; ctx.lineTo(x, y) }
    ctx.stroke()
  }
  // pocks / spalling
  for (let i = 0; i < 55; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, r = 1.5 + rnd() * 4
    ctx.fillStyle = 'rgba(96,76,52,0.35)'
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  smoothNoise(ctx, TEX, 21, 128, 0.07)
  smoothNoise(ctx, TEX, 22, 32, 0.08)
  grain(ctx, TEX, TEX, 23, 2000, 0.07)
  return finish(c, rx, ry)
}

export function brickTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(301)
  ctx.fillStyle = '#6a5a48' // mortar
  ctx.fillRect(0, 0, TEX, TEX)
  const bw = 62, bh = 27, gap = 5
  for (let row = -1; row * (bh + gap) < TEX + bh; row++) {
    for (let col = -1; col * (bw + gap) < TEX + bw; col++) {
      const bx = col * (bw + gap) + (row % 2 ? (bw + gap) / 2 : 0)
      const by = row * (bh + gap)
      const t = rnd()
      ctx.fillStyle = `rgb(${150 + t * 44 | 0},${98 + t * 28 | 0},${64 + t * 22 | 0})`
      ctx.fillRect(bx, by, bw, bh)
      // top light / bottom shadow bevel
      ctx.fillStyle = 'rgba(255,235,200,0.13)'
      ctx.fillRect(bx, by, bw, 3)
      ctx.fillStyle = 'rgba(40,28,18,0.25)'
      ctx.fillRect(bx, by + bh - 3, bw, 3)
      if (rnd() < 0.13) { // chipped corner
        ctx.fillStyle = 'rgba(60,46,32,0.55)'
        ctx.fillRect(bx + rnd() * (bw - 14), by + rnd() * (bh - 10), 10 + rnd() * 8, 7)
      }
      if (rnd() < 0.1) { // dust / moss
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,124,88,0.22)' : 'rgba(190,170,130,0.2)'
        ctx.fillRect(bx, by, bw, bh)
      }
    }
  }
  smoothNoise(ctx, TEX, 31, 64, 0.09)
  grain(ctx, TEX, TEX, 32, 1600, 0.08)
  return finish(c, rx, ry)
}

export function concreteTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(401)
  ctx.fillStyle = '#9c978c'
  ctx.fillRect(0, 0, TEX, TEX)
  smoothNoise(ctx, TEX, 41, 128, 0.10)
  smoothNoise(ctx, TEX, 42, 32, 0.11)
  smoothNoise(ctx, TEX, 43, 8, 0.06)
  // hairline cracks
  ctx.strokeStyle = 'rgba(58,54,46,0.5)'
  ctx.lineWidth = 1.2
  for (let i = 0; i < 8; i++) {
    ctx.beginPath()
    let x = rnd() * TEX, y = rnd() * TEX
    ctx.moveTo(x, y)
    for (let s = 0; s < 6; s++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.5) * 40; ctx.lineTo(x, y) }
    ctx.stroke()
  }
  // form tie holes
  for (let gx = 0; gx < 3; gx++) for (let gy = 0; gy < 3; gy++) {
    const x = 64 + gx * 170, y = 64 + gy * 170
    ctx.fillStyle = 'rgba(50,46,40,0.6)'
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill()
    ctx.fillStyle = 'rgba(130,126,116,0.5)'
    ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 2.5, 0, 7); ctx.fill()
  }
  grain(ctx, TEX, TEX, 44, 2200, 0.08)
  return finish(c, rx, ry)
}

// ---------------- props / wood / metal ----------------
export function crateTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(501)
  ctx.fillStyle = '#8a6a42'
  ctx.fillRect(0, 0, TEX, TEX)
  // planks
  const ph = 100
  for (let y = 0, i = 0; y < TEX; y += ph + 6, i++) {
    const t = rnd()
    ctx.fillStyle = `rgb(${128 + t * 34 | 0},${92 + t * 24 | 0},${52 + t * 18 | 0})`
    ctx.fillRect(0, y, TEX, ph)
    // top light bevel + gap shadow
    ctx.fillStyle = 'rgba(255,225,170,0.16)'
    ctx.fillRect(0, y, TEX, 5)
    ctx.fillStyle = 'rgba(50,32,16,0.55)'
    ctx.fillRect(0, y + ph, TEX, 6)
    // wood grain
    ctx.strokeStyle = 'rgba(70,48,26,0.22)'
    ctx.lineWidth = 1.4
    for (let g = 0; g < 5; g++) {
      const gy = y + 8 + rnd() * (ph - 16)
      ctx.beginPath(); ctx.moveTo(0, gy)
      ctx.bezierCurveTo(TEX / 3, gy + (rnd() - 0.5) * 10, (2 * TEX) / 3, gy + (rnd() - 0.5) * 10, TEX, gy)
      ctx.stroke()
    }
    // nails
    ctx.fillStyle = 'rgba(40,30,20,0.8)'
    for (const nx of [14, TEX - 14]) {
      ctx.beginPath(); ctx.arc(nx, y + 12, 3, 0, 7); ctx.fill()
      ctx.beginPath(); ctx.arc(nx, y + ph - 12, 3, 0, 7); ctx.fill()
    }
  }
  // frame border
  ctx.strokeStyle = 'rgba(58,38,18,0.85)'
  ctx.lineWidth = 16
  ctx.strokeRect(8, 8, TEX - 16, TEX - 16)
  ctx.strokeStyle = 'rgba(255,225,170,0.12)'
  ctx.lineWidth = 3
  ctx.strokeRect(16, 16, TEX - 32, TEX - 32)
  // diagonal cross braces
  ctx.save()
  ctx.strokeStyle = 'rgba(74,50,26,0.75)'
  ctx.lineWidth = 22
  ctx.beginPath(); ctx.moveTo(20, 20); ctx.lineTo(TEX - 20, TEX - 20); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(TEX - 20, 20); ctx.lineTo(20, TEX - 20); ctx.stroke()
  ctx.restore()
  // stencil marking
  ctx.save()
  ctx.translate(TEX / 2, TEX / 2)
  ctx.rotate(-0.03)
  ctx.font = 'bold 54px "Courier New", monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(38,46,32,0.5)'
  ctx.fillText('7.62 AMMO', 0, 0)
  ctx.restore()
  grain(ctx, TEX, TEX, 51, 1400, 0.06)
  return finish(c, rx, ry)
}

export function metalTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(601)
  ctx.fillStyle = '#687077'
  ctx.fillRect(0, 0, TEX, TEX)
  // brushed horizontal streaks
  for (let i = 0; i < 380; i++) {
    const y = rnd() * TEX
    const v = rnd() < 0.5
    ctx.strokeStyle = v ? 'rgba(160,168,176,0.10)' : 'rgba(50,56,62,0.10)'
    ctx.lineWidth = 1 + rnd() * 2
    ctx.beginPath(); ctx.moveTo(rnd() * TEX, y); ctx.lineTo(rnd() * TEX, y + (rnd() - 0.5) * 6); ctx.stroke()
  }
  // panel seams
  ctx.strokeStyle = 'rgba(30,34,38,0.7)'
  ctx.lineWidth = 3
  for (const x of [TEX * 0.33, TEX * 0.66]) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TEX); ctx.stroke()
  }
  // rivets
  for (let x = 26; x < TEX; x += 64) for (let y = 26; y < TEX; y += 64) {
    ctx.fillStyle = 'rgba(36,40,44,0.85)'
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fill()
    ctx.fillStyle = 'rgba(196,204,210,0.55)'
    ctx.beginPath(); ctx.arc(x - 1.2, y - 1.2, 1.5, 0, 7); ctx.fill()
  }
  // rust blooms
  for (let i = 0; i < 36; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, r = 5 + rnd() * 18
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, 'rgba(146,82,40,0.30)')
    g.addColorStop(1, 'rgba(146,82,40,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  // rust creep streaks (from rivets downward)
  for (let i = 0; i < 14; i++) {
    const x = 26 + (rnd() * 7 | 0) * 64, y = 26 + (rnd() * 7 | 0) * 64
    const g = ctx.createLinearGradient(0, y, 0, y + 30 + rnd() * 40)
    g.addColorStop(0, 'rgba(130,72,34,0.28)')
    g.addColorStop(1, 'rgba(130,72,34,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - 2, y, 4, 30 + rnd() * 40)
  }
  grain(ctx, TEX, TEX, 61, 1600, 0.08)
  return finish(c, rx, ry)
}

export function darkTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(701)
  ctx.fillStyle = '#4e453a'
  ctx.fillRect(0, 0, TEX, TEX)
  for (let y = 0; y < TEX; y += 72) {
    const v = 66 + rnd() * 26 | 0
    ctx.fillStyle = `rgba(${v + 8},${v},${v - 12},0.55)`
    ctx.fillRect(0, y, TEX, 64)
  }
  // soot blooms
  for (let i = 0; i < 20; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, r = 20 + rnd() * 60
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, 'rgba(20,16,12,0.35)')
    g.addColorStop(1, 'rgba(20,16,12,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  // moisture streaks
  for (let i = 0; i < 12; i++) {
    const x = rnd() * TEX, w = 10 + rnd() * 30, h = 60 + rnd() * 180
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, 'rgba(30,26,20,0.22)')
    g.addColorStop(1, 'rgba(30,26,20,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, 0, w, h)
  }
  smoothNoise(ctx, TEX, 71, 64, 0.12)
  grain(ctx, TEX, TEX, 72, 2200, 0.1)
  return finish(c, rx, ry)
}

export function plankTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(801)
  ctx.fillStyle = '#96774c'
  ctx.fillRect(0, 0, TEX, TEX)
  const ph = 82
  for (let y = 0, i = 0; y < TEX; y += ph + 6, i++) {
    const t = rnd()
    ctx.fillStyle = `rgb(${138 + t * 26 | 0},${106 + t * 20 | 0},${62 + t * 14 | 0})`
    ctx.fillRect(0, y, TEX, ph)
    ctx.fillStyle = 'rgba(255,225,170,0.13)'
    ctx.fillRect(0, y, TEX, 4)
    ctx.fillStyle = 'rgba(48,30,16,0.5)'
    ctx.fillRect(0, y + ph, TEX, 6)
    // knots
    if (rnd() < 0.6) {
      const kx = 40 + rnd() * (TEX - 80), ky = y + 10 + rnd() * (ph - 20)
      const g = ctx.createRadialGradient(kx, ky, 1, kx, ky, 7 + rnd() * 5)
      g.addColorStop(0, 'rgba(52,32,14,0.75)')
      g.addColorStop(0.6, 'rgba(90,60,30,0.4)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(kx, ky, 12, 0, 7); ctx.fill()
    }
    // grain
    ctx.strokeStyle = 'rgba(64,42,22,0.24)'
    ctx.lineWidth = 1.3
    for (let g = 0; g < 4; g++) {
      const gy = y + 6 + rnd() * (ph - 12)
      ctx.beginPath(); ctx.moveTo(0, gy)
      ctx.bezierCurveTo(TEX / 3, gy + (rnd() - 0.5) * 8, (2 * TEX) / 3, gy + (rnd() - 0.5) * 8, TEX, gy)
      ctx.stroke()
    }
  }
  grain(ctx, TEX, TEX, 81, 1100, 0.05)
  return finish(c, rx, ry)
}

// weathered wood/metal door (long doors)
export function doorTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(901)
  ctx.fillStyle = '#6e7266'
  ctx.fillRect(0, 0, TEX, TEX)
  // vertical planks under peeling paint
  const pw = 64
  for (let x = 0; x < TEX; x += pw) {
    const t = rnd()
    ctx.fillStyle = `rgb(${96 + t * 22 | 0},${100 + t * 22 | 0},${88 + t * 20 | 0})`
    ctx.fillRect(x, 0, pw - 3, TEX)
    ctx.fillStyle = 'rgba(30,34,28,0.45)'
    ctx.fillRect(x + pw - 3, 0, 3, TEX)
  }
  // chipped paint revealing wood
  for (let i = 0; i < 9; i++) {
    const x = rnd() * (TEX - 90), y = rnd() * (TEX - 90), w = 26 + rnd() * 62, h = 20 + rnd() * 50
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let k = 1; k <= 6; k++) ctx.lineTo(x + (w * k) / 6, y + (rnd() - 0.5) * 14)
    for (let k = 6; k >= 0; k--) ctx.lineTo(x + (w * k) / 6, y + h + (rnd() - 0.5) * 14)
    ctx.closePath(); ctx.clip()
    ctx.fillStyle = '#8a6a42'; ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = 'rgba(70,48,26,0.4)'
    ctx.lineWidth = 1.4
    for (let g = 0; g < 4; g++) {
      const gy = y + rnd() * h
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy + (rnd() - 0.5) * 8); ctx.stroke()
    }
    ctx.restore()
  }
  // horizontal metal straps with bolts
  for (const y of [TEX * 0.26, TEX * 0.74]) {
    ctx.fillStyle = 'rgba(52,58,60,0.92)'
    ctx.fillRect(0, y - 13, TEX, 26)
    ctx.fillStyle = 'rgba(20,24,26,0.5)'
    ctx.fillRect(0, y + 10, TEX, 4)
    for (let x = 24; x < TEX; x += 74) {
      ctx.fillStyle = 'rgba(26,30,32,0.9)'
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill()
      ctx.fillStyle = 'rgba(180,186,190,0.5)'
      ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 2, 0, 7); ctx.fill()
    }
  }
  // rust edges
  for (let i = 0; i < 16; i++) {
    const edge = rnd() < 0.5
    const x = edge ? (rnd() < 0.5 ? rnd() * 30 : TEX - rnd() * 30) : rnd() * TEX
    const y = edge ? rnd() * TEX : (rnd() < 0.5 ? rnd() * 30 : TEX - rnd() * 30)
    const r = 6 + rnd() * 16
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, 'rgba(140,78,36,0.35)')
    g.addColorStop(1, 'rgba(140,78,36,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  grain(ctx, TEX, TEX, 91, 1300, 0.09)
  return finish(c, rx, ry)
}

// blue metal door (mid doors / B doors — CS style)
export function doorBlueTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(1001)
  ctx.fillStyle = '#49657f'
  ctx.fillRect(0, 0, TEX, TEX)
  smoothNoise(ctx, TEX, 1001, 64, 0.08)
  // two recessed panels
  for (const [px, py, pw, ph] of [[52, 40, 408, 170], [52, 302, 408, 170]] as const) {
    ctx.fillStyle = 'rgba(30,46,62,0.45)'
    ctx.fillRect(px, py, pw, ph)
    ctx.fillStyle = 'rgba(52,76,100,0.8)'
    ctx.fillRect(px + 8, py + 8, pw - 16, ph - 16)
    ctx.fillStyle = 'rgba(140,170,200,0.18)'
    ctx.fillRect(px + 8, py + 8, pw - 16, 6)
    ctx.fillStyle = 'rgba(14,22,32,0.4)'
    ctx.fillRect(px + 8, py + ph - 14, pw - 16, 6)
  }
  // rivets around border
  for (let x = 26; x < TEX; x += 60) {
    for (const y of [18, TEX - 18]) {
      ctx.fillStyle = 'rgba(24,36,50,0.9)'
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, 7); ctx.fill()
      ctx.fillStyle = 'rgba(150,180,210,0.5)'
      ctx.beginPath(); ctx.arc(x - 1.2, y - 1.2, 1.6, 0, 7); ctx.fill()
    }
  }
  // scratches revealing bare metal
  ctx.strokeStyle = 'rgba(190,200,205,0.35)'
  for (let i = 0; i < 16; i++) {
    ctx.lineWidth = 0.8 + rnd() * 1.6
    ctx.beginPath()
    const x = rnd() * TEX, y = rnd() * TEX
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rnd() - 0.5) * 70, y + (rnd() - 0.5) * 30)
    ctx.stroke()
  }
  // bottom rust creep
  const g = ctx.createLinearGradient(0, TEX - 110, 0, TEX)
  g.addColorStop(0, 'rgba(120,66,30,0)')
  g.addColorStop(1, 'rgba(120,66,30,0.4)')
  ctx.fillStyle = g
  ctx.fillRect(0, TEX - 110, TEX, 110)
  // faded stencil number
  ctx.save()
  ctx.font = 'bold 60px "Courier New", monospace'
  ctx.fillStyle = 'rgba(220,230,235,0.28)'
  ctx.textAlign = 'center'
  ctx.fillText('47', TEX / 2, TEX / 2 + 20)
  ctx.restore()
  grain(ctx, TEX, TEX, 1011, 1400, 0.09)
  return finish(c, rx, ry)
}

// ---------------- sky ----------------
export function skyMesh(mapId?: string): THREE.Mesh {
  const W = 1024, H = 512
  const [c, ctx] = makeCanvas(W, H)
  const rnd = mulberry32(2025)
  const aztec = mapId === 'aimhead'   // Task 77: de_aztec mood — blue down to
  // the horizon (no desert tan band), slightly deeper zenith
  const night = mapId === 'aimdepot'  // Task 100: moonlit depot — deep
  // indigo sky, star field, glowing moon disc (clear night, no clouds)
  const winter = mapId === 'office'   // Task 126: cs_office — overcast
  // winter sky: pale grey-blue, bright snow-bounce horizon, flat diffuse sun
  const tropical = mapId === 'island'  // Task 131: vivid tropical day
  const g = ctx.createLinearGradient(0, 0, 0, H)
  if (night) {
    g.addColorStop(0, '#060a1c')      // zenith — deep indigo
    g.addColorStop(0.45, '#0b1330')
    g.addColorStop(0.7, '#131f42')
    g.addColorStop(0.85, '#1a2a52')  // faint horizon lift
    g.addColorStop(1, '#22335e')     // horizon glow band
  } else if (winter) {
    // live VLM t126: (a) bright bands read as a 'white void' — deepen the
    // upper sky; (b) the NADIR (canvas bottom) was the brightest stop
    // (#eef1f3), so any sightline leaking past the world shell below the
    // horizon hit a stark white plane (HOM read). Brightest band now sits
    // AT the horizon, the below-horizon hemisphere fades to muted grey.
    g.addColorStop(0, '#78899c')      // zenith — grey-blue overcast
    g.addColorStop(0.32, '#9db0c0')
    g.addColorStop(0.46, '#dfe5e9')   // bright haze band at the horizon
    g.addColorStop(0.5, '#e7ebee')    // horizon line itself
    g.addColorStop(0.62, '#adb8c1')   // below-horizon fade (leak reads as haze)
    g.addColorStop(0.8, '#7f8a94')
    g.addColorStop(1, '#626c76')      // nadir — dark muted grey, never white
  } else if (tropical) {
    // Task 131 island: deep azure zenith, bright haze band AT the horizon;
    // the below-horizon nadir fades to sea grey-blue (the Task-126 winter
    // HOM lesson: never leave a bright/white nadir for shell leaks to hit —
    // here any leak past the ocean reads as distant sea haze)
    g.addColorStop(0, '#2f74d6')
    g.addColorStop(0.3, '#5b9fe2')
    g.addColorStop(0.45, '#aad2ea')
    g.addColorStop(0.5, '#d8ecf4')
    g.addColorStop(0.56, '#b9d8e4')
    g.addColorStop(0.75, '#8fb4c6')
    g.addColorStop(1, '#7292a5')
  } else if (aztec) {
    g.addColorStop(0, '#5d8fc2')
    g.addColorStop(0.35, '#9dc0dc')
    g.addColorStop(0.6, '#cfdfe9')
    g.addColorStop(0.8, '#dfe9ee')
    g.addColorStop(1, '#c9d6d5')
  } else {
    g.addColorStop(0, '#6d9ec7')
    g.addColorStop(0.35, '#a3c4dd')
    g.addColorStop(0.55, '#cfdde7')
    g.addColorStop(0.68, '#e9ddb9') // haze at horizon
    g.addColorStop(0.8, '#d9c69b')
    g.addColorStop(1, '#c4b088')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  if (night) {
    // Task 101: the painted star field + haloed moon disc were REPLACED by
    // real 3D models (user-provided GLBs -> moon.bin + stars-night.bin),
    // attached to this sky mesh by nightsky.ts. The canvas keeps only the
    // indigo gradient backdrop; two Task-100 live lessons carry over into
    // nightsky.ts placement constants (elevation ~24 deg = in-frame past
    // the 6 m walls at pitch 0; ~4.6-deg angular size = believable moon).
  } else {
    // clouds (soft layered blobs) — aztec: whiter, denser jungle cover;
    // winter: many wide flat low-contrast overcast sheets
    const nClouds = winter ? 72 : aztec ? 44 : 34
    for (let i = 0; i < nClouds; i++) {
      const x = rnd() * W
      const y = H * (0.08 + rnd() * (winter ? 0.52 : 0.4))
      const rw = (winter ? 90 : 45) + rnd() * (winter ? 200 : 140)
      const rh = rw * (winter ? 0.14 + rnd() * 0.1 : 0.22 + rnd() * 0.16)
      const a = winter ? 0.14 + rnd() * 0.16 : 0.16 + rnd() * 0.2
      const cg = ctx.createRadialGradient(x, y, 1, x, y, rw)
      cg.addColorStop(0, `rgba(255,252,245,${a})`)
      cg.addColorStop(0.6, `rgba(250,246,238,${a * 0.55})`)
      cg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = cg
      ctx.save()
      ctx.translate(x, y); ctx.scale(1, rh / rw); ctx.translate(-x, -y)
      ctx.beginPath(); ctx.arc(x, y, rw, 0, 7); ctx.fill()
      ctx.restore()
    }
    // sun disc + glow (place away from mid lane sightlines — NE high sky);
    // winter: soft diffuse silver disc behind the overcast
    const sx = W * 0.78, sy = H * 0.2
    const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, winter ? 130 : 190)
    glow.addColorStop(0, winter ? 'rgba(255,255,252,0.55)' : 'rgba(255,246,214,0.9)')
    glow.addColorStop(0.25, winter ? 'rgba(244,247,250,0.22)' : 'rgba(255,238,190,0.35)')
    glow.addColorStop(1, 'rgba(255,235,170,0)')
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.arc(sx, sy, winter ? 130 : 190, 0, 7); ctx.fill()
    ctx.fillStyle = winter ? 'rgba(252,253,254,0.85)' : 'rgba(255,251,238,0.98)'
    ctx.beginPath(); ctx.arc(sx, sy, winter ? 26 : 17, 0, 7); ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.SphereGeometry(350, 32, 20)
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
  const m = new THREE.Mesh(geo, mat)
  m.renderOrder = -10
  if (tropical) {
    // Task 132: upgrade the procedural canvas dome to the ambientCG
    // DaySkyHDRI017B equirect jpg the moment it ships (staging until
    // accept — same assets-first policy as the surface textures). The
    // image sun sits at lon 180 => +X on an unrotated dome; the engine
    // sun vector (55,70,18) is atan2(18,55) = 18.1 deg from +X towards
    // +Z, so yawing the dome -0.316 rad puts the image sun disc on the
    // light's azimuth (38.4 deg image elevation vs 50.4 deg light is an
    // accepted delta — the disc is small, shadows carry the perception).
    // Canvas gradient stays as the no-network fallback.
    const urls = ['/assets/maps/island/sky.jpg', '/staging/maps/island/sky.jpg']
    const tryLoad = (i: number) => {
      if (i >= urls.length) return
      new THREE.TextureLoader().loadAsync(urls[i]).then(t => {
        t.colorSpace = THREE.SRGBColorSpace
        t.wrapS = THREE.RepeatWrapping   // seam-longitude interpolation
        t.anisotropy = 4
        mat.map = t
        mat.needsUpdate = true
        m.rotation.y = -0.316
      }).catch(() => tryLoad(i + 1))
    }
    tryLoad(0)
  }
  return m
}

// ---------------- decals & signs ----------------
export function bulletHoleTexture(): THREE.Texture {
  const S = 64
  const [c, ctx] = makeCanvas(S, S)
  const rnd = mulberry32(77)
  // outer chipped ring (irregular dashes)
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2
    const r = 12 + rnd() * 6
    ctx.strokeStyle = `rgba(120,100,76,${0.25 + rnd() * 0.25})`
    ctx.lineWidth = 2 + rnd() * 3
    ctx.beginPath()
    ctx.arc(S / 2, S / 2, r, a, a + 0.3 + rnd() * 0.4)
    ctx.stroke()
  }
  // cracks radiating out
  ctx.strokeStyle = 'rgba(40,30,20,0.55)'
  ctx.lineWidth = 1.4
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(S / 2 + Math.cos(a) * 8, S / 2 + Math.sin(a) * 8)
    ctx.lineTo(S / 2 + Math.cos(a) * (15 + rnd() * 8), S / 2 + Math.sin(a) * (15 + rnd() * 8))
    ctx.stroke()
  }
  // dark core
  const g = ctx.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, 10)
  g.addColorStop(0, 'rgba(16,12,8,0.95)')
  g.addColorStop(0.6, 'rgba(28,22,14,0.8)')
  g.addColorStop(1, 'rgba(28,22,14,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(S / 2, S / 2, 11, 0, 7); ctx.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function scorchTexture(): THREE.Texture {
  const S = 128
  const [c, ctx] = makeCanvas(S, S)
  const rnd = mulberry32(88)
  for (let i = 0; i < 24; i++) {
    const a = rnd() * Math.PI * 2, rr = rnd() * S * 0.42
    const x = S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr
    const r = 8 + rnd() * 20
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, `rgba(18,14,10,${0.35 + rnd() * 0.3})`)
    g.addColorStop(1, 'rgba(18,14,10,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  const g2 = ctx.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S * 0.4)
  g2.addColorStop(0, 'rgba(10,8,6,0.65)')
  g2.addColorStop(1, 'rgba(10,8,6,0)')
  ctx.fillStyle = g2
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.4, 0, 7); ctx.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Worn dirt track strip for lane decals. Soft side fade, grainy. */
export function dirtTrackTexture(): THREE.Texture {
  const W = 128, H = 512
  const [c, ctx] = makeCanvas(W, H)
  const rnd = mulberry32(99)
  ctx.fillStyle = 'rgba(105,88,60,0.34)'
  ctx.fillRect(0, 0, W, H)
  // wheel rut lines
  for (const x of [W * 0.3, W * 0.7]) {
    ctx.fillStyle = 'rgba(80,64,44,0.22)'
    ctx.fillRect(x - 7, 0, 14, H)
  }
  smoothNoise(ctx, W, 1101, 24, 0.16)
  grain(ctx, W, H, 111, 900, 0.14, 3)
  // horizontal soft fade at both ends (so strips don't end abruptly)
  ctx.globalCompositeOperation = 'destination-in'
  for (const [y0, h] of [[0, 60], [H - 60, 60]] as const) {
    const lg = ctx.createLinearGradient(0, y0 === 0 ? 0 : H, 0, y0 === 0 ? 60 : H - 60)
    lg.addColorStop(0, 'rgba(0,0,0,0)')
    lg.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = y0 === 0 ? lg : lg
    ctx.fillRect(0, y0, W, h)
  }
  // vertical side fade
  const sg = ctx.createLinearGradient(0, 0, W, 0)
  sg.addColorStop(0, 'rgba(0,0,0,0)')
  sg.addColorStop(0.25, 'rgba(0,0,0,1)')
  sg.addColorStop(0.75, 'rgba(0,0,0,1)')
  sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sg
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Spray-painted wall sign (stencil look). */
export function signTexture(text: string, color = 'rgba(200,60,40,0.85)', W = 256, H = 256): THREE.Texture {
  const [c, ctx] = makeCanvas(W, H)
  const rnd = mulberry32(text.length * 37 + 5)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((rnd() - 0.5) * 0.06)
  ctx.font = `bold ${Math.floor(H * 0.62)}px "Arial Black", Arial, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, 0, 4)
  // drips
  ctx.fillStyle = color
  for (let i = 0; i < 4; i++) {
    const x = (rnd() - 0.5) * W * 0.7
    const y = H * 0.2 + rnd() * H * 0.2
    ctx.fillRect(x, y, 2 + rnd() * 2, 10 + rnd() * 26)
  }
  // overspray fuzz
  ctx.shadowColor = color
  ctx.shadowBlur = 8
  ctx.fillText(text, 0, 4)
  ctx.restore()
  // weathering: erode with specks
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = rnd() * H
    ctx.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.4})`
    ctx.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 3)
  }
  ctx.globalCompositeOperation = 'source-over'
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Directional arrow sign plane texture. */
export function arrowSignTexture(color = 'rgba(225,190,60,0.9)'): THREE.Texture {
  const W = 128, H = 128
  const [c, ctx] = makeCanvas(W, H)
  ctx.fillStyle = color
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.beginPath()
  ctx.moveTo(-40, -14); ctx.lineTo(10, -14); ctx.lineTo(10, -34); ctx.lineTo(44, 0)
  ctx.lineTo(10, 34); ctx.lineTo(10, 14); ctx.lineTo(-40, 14)
  ctx.closePath(); ctx.fill()
  ctx.restore()
  ctx.globalCompositeOperation = 'destination-out'
  const rnd = mulberry32(3)
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.4})`
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// bomb site decal (ground)
export function siteDecal(letter: 'A' | 'B'): THREE.Mesh {
  const [c, ctx] = makeCanvas(256, 256)
  ctx.strokeStyle = 'rgba(226,58,44,0.9)'
  ctx.lineWidth = 14
  ctx.setLineDash([30, 20])
  ctx.strokeRect(18, 18, 220, 220)
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(226,58,44,0.12)'
  ctx.fillRect(18, 18, 220, 220)
  ctx.fillStyle = 'rgba(226,58,44,0.9)'
  ctx.font = 'bold 130px "Arial Black", Arial, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(letter, 128, 134)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.PlaneGeometry(13, 13)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  const m = new THREE.Mesh(geo, mat)
  m.rotation.x = -Math.PI / 2
  return m
}

// ---------------- soldier (remote player) textures ----------------
// ---------------- office families (Task 126 — cs_office BSP import) ----------------
// Seven new procedural canvases, each designed at the BSP's measured world
// scale (see scripts/bsp/office-uvdensity.ts): one canvas repeat covers the
// family's m/UV span, so e.g. the ceiling grid lands at real 0.6 m tiles.
// The ambientCG PBR hot-swap (PBR_BY_MAP.office) replaces albedo/relief for
// the five photo families; glass (transparent) and fence (alphaTest lattice)
// stay procedural by design — jpgs cannot carry alpha.

/** commercial carpet — dense two-tone peppered pile with 0.5 m tile seams */
export function carpetTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(301)
  ctx.fillStyle = '#66705f'
  ctx.fillRect(0, 0, TEX, TEX)
  // worn-install tonal drift
  for (let i = 0; i < 14; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, r = 60 + rnd() * 150
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, rnd() < 0.5 ? 'rgba(94,106,86,0.18)' : 'rgba(128,136,116,0.15)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  // the commercial-carpet signature: 3-tone fleck, dense enough to read as pile
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, v = rnd()
    ctx.fillStyle = v < 0.42 ? 'rgba(72,82,68,0.5)' : v < 0.8 ? 'rgba(118,128,104,0.45)' : 'rgba(146,154,128,0.4)'
    ctx.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2)
  }
  smoothNoise(ctx, TEX, 77, 96, 0.14)
  smoothNoise(ctx, TEX, 78, 24, 0.10)
  // carpet-tile seams (2 m span / 4 = 0.5 m tiles)
  ctx.strokeStyle = 'rgba(48,54,44,0.32)'
  ctx.lineWidth = 2
  for (let k = 1; k < 4; k++) {
    const p = (k * TEX) / 4
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, TEX); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(TEX, p); ctx.stroke()
  }
  grain(ctx, TEX, TEX, 79, 2400, 0.1, 1)
  return finish(c, rx, ry)
}

/** office drywall — warm off-white paint with roller sheen + orange-peel */
export function offwallTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(401)
  ctx.fillStyle = '#dcd6c4'
  ctx.fillRect(0, 0, TEX, TEX)
  // vertical roller-applied sheen bands
  for (let x = 0; x < TEX; x += 26) {
    const l = 214 + rnd() * 16 | 0
    ctx.fillStyle = `rgba(${l},${(l - 8) | 0},${(l - 28) | 0},0.22)`
    ctx.fillRect(x, 0, 22, TEX)
  }
  // orange-peel surface
  smoothNoise(ctx, TEX, 402, 160, 0.09)
  smoothNoise(ctx, TEX, 403, 40, 0.07)
  grain(ctx, TEX, TEX, 404, 4200, 0.06, 1)
  // sparse scuffs / furniture knicks
  for (let i = 0; i < 16; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, len = 6 + rnd() * 26
    ctx.strokeStyle = `rgba(118,110,94,${0.1 + rnd() * 0.13})`
    ctx.lineWidth = 1 + rnd() * 1.5
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len * (rnd() - 0.5), y + len * (rnd() - 0.5)); ctx.stroke()
  }
  return finish(c, rx, ry)
}

/** drop ceiling — mineral-fiber tiles, acoustic pinholes, T-bar grid seams */
export function ceilingTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(501)
  ctx.fillStyle = '#e9e7e0'
  ctx.fillRect(0, 0, TEX, TEX)
  // fiber speckle
  for (let i = 0; i < 2600; i++) {
    const v = 150 + rnd() * 100 | 0
    ctx.fillStyle = `rgba(${v},${v},${(v - 8) | 0},0.26)`
    ctx.fillRect(rnd() * TEX, rnd() * TEX, 1 + rnd() * 2, 1 + rnd() * 2)
  }
  // acoustic pinholes
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(112,110,102,${0.22 + rnd() * 0.3})`
    ctx.beginPath(); ctx.arc(rnd() * TEX, rnd() * TEX, 0.7 + rnd() * 1.4, 0, 7); ctx.fill()
  }
  // T-bar grid: 4x4 tiles per canvas (0.6 m each) — seam shadow + rail highlight
  for (let k = 0; k <= 4; k++) {
    const p = Math.min(TEX, (k * TEX) / 4)
    for (const [x0, y0, w, h] of [[0, p - 2, TEX, 5], [p - 2, 0, 5, TEX]] as Array<[number, number, number, number]>) {
      ctx.fillStyle = 'rgba(122,120,112,0.75)'
      ctx.fillRect(x0, y0, w, h)
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.fillRect(x0, y0, w, 1)
      ctx.fillRect(x0, y0, 1, h)
    }
  }
  grain(ctx, TEX, TEX, 504, 900, 0.05, 1)
  return finish(c, rx, ry)
}

/** snow yard — blue-white drifts, wind striations, sparkle grains */
export function snowTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(601)
  ctx.fillStyle = '#edf1f7'
  ctx.fillRect(0, 0, TEX, TEX)
  // soft drift shading (bluish hollows / bright crowns)
  for (let i = 0; i < 22; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, r = 50 + rnd() * 170
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, rnd() < 0.6 ? 'rgba(192,205,226,0.2)' : 'rgba(255,255,255,0.2)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  // wind striations — long faint curves
  for (let i = 0; i < 9; i++) {
    const y0 = rnd() * TEX
    ctx.strokeStyle = 'rgba(184,198,220,0.13)'
    ctx.lineWidth = 5 + rnd() * 9
    ctx.beginPath()
    for (let x = 0; x <= TEX; x += 32) ctx.lineTo(x, y0 + Math.sin((x + i * 60) * 0.011 + i * 2.1) * 16)
    ctx.stroke()
  }
  // ice sparkles
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(226,238,252,0.6)'
    ctx.fillRect(rnd() * TEX, rnd() * TEX, 1, 1)
  }
  smoothNoise(ctx, TEX, 603, 64, 0.07)
  grain(ctx, TEX, TEX, 604, 2200, 0.05, 1)
  return finish(c, rx, ry)
}

/** hallway floor — 0.3 m ceramic tiles, grout, per-tile mottle, corner wear */
export function tileTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(701)
  ctx.fillStyle = '#b9b2a0'   // grout
  ctx.fillRect(0, 0, TEX, TEX)
  const N = 4, S = TEX / N, G = 4
  for (let ty = 0; ty < N; ty++) for (let txx = 0; txx < N; txx++) {
    const x0 = txx * S, y0 = ty * S
    const v = 198 + rnd() * 22 | 0
    ctx.fillStyle = `rgb(${v},${(v - 10) | 0},${(v - 38) | 0})`
    ctx.fillRect(x0 + G, y0 + G, S - G * 2, S - G * 2)
    // per-tile mottle (subtle), clipped
    ctx.save()
    ctx.beginPath(); ctx.rect(x0 + G, y0 + G, S - G * 2, S - G * 2); ctx.clip()
    for (let i = 0; i < 130; i++) {
      const m = 160 + rnd() * 90 | 0
      ctx.fillStyle = `rgba(${m},${(m - 10) | 0},${(m - 40) | 0},0.18)`
      ctx.fillRect(x0 + rnd() * S, y0 + rnd() * S, 2 + rnd() * 4, 2 + rnd() * 4)
    }
    // scuffed tiles occasionally
    if (rnd() < 0.22) {
      ctx.fillStyle = 'rgba(120,112,96,0.1)'
      ctx.fillRect(x0 + G, y0 + G, S - G * 2, S - G * 2)
    }
    ctx.restore()
  }
  // floor-sheen streaks over everything
  smoothNoise(ctx, TEX, 702, 48, 0.06)
  grain(ctx, TEX, TEX, 703, 1800, 0.05, 1)
  return finish(c, rx, ry)
}

/** window glass — pale blue-green pane with wipe streaks (material is transparent) */
export function glassTexture(rx = 1, ry = 1): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const rnd = mulberry32(801)
  const g = ctx.createLinearGradient(0, 0, TEX, TEX)
  g.addColorStop(0, '#d9e5ec'); g.addColorStop(0.5, '#c6d5de'); g.addColorStop(1, '#d6e2e9')
  ctx.fillStyle = g; ctx.fillRect(0, 0, TEX, TEX)
  // diagonal wipe streaks
  for (let i = 0; i < 20; i++) {
    const x = rnd() * TEX
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.06})`
    ctx.lineWidth = 4 + rnd() * 14
    ctx.beginPath(); ctx.moveTo(x, -20); ctx.lineTo(x + TEX * 0.35, TEX + 20); ctx.stroke()
  }
  // dust specks + faint edge grime
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = 'rgba(150,165,176,0.22)'
    ctx.fillRect(rnd() * TEX, rnd() * TEX, 1, 1)
  }
  ctx.strokeStyle = 'rgba(140,155,166,0.25)'
  ctx.lineWidth = 10
  ctx.strokeRect(0, 0, TEX, TEX)
  return finish(c, rx, ry)
}

/** railing/fence — ALPHA-CUTOUT canvas (alphaTest), 2x2 cells per repeat.
 * Task 141 (two-part fix):
 *  (a) CONVERTER: railing_3 + sphinx_railing_ (2557 m2, the CT-entrance
 *      courtyard + map perimeter) were mis-mapped to this family, but they
 *      are OPAQUE CONCRETE walls — VLM + palette audit of the embedded WAD
 *      data, and the GoldSrc rule that only '{'-prefixed textures render
 *      with transparency. They now remap to 'concrete' at the geom level.
 *  (b) THIS CANVAS: what legitimately remains in the fence family after (a)
 *      is the true-alpha set ({rail1c rails, {ladder2/{ladder2b ladder
 *      rungs, 378 m2 of small props). The old diagonal-X truss read as
 *      CONSTRUCTION SCAFFOLDING there — replaced by horizontal rails +
 *      vertical posts + one thin mid picket per 1 m cell, which reads as
 *      proper railing/ladder work. Cells stay 2x2 per repeat (t126
 *      anti-moire constraint: 4x4 cells aliased into a checkerboard at
 *      distance). No PBR twin (jpgs have no alpha) — this canvas IS the
 *      final look. */
export function fenceTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas()
  const N = 2, S = TEX / N, B = 13        // cell 1 m, bar 13 px (~5 cm)
  ctx.clearRect(0, 0, TEX, TEX)
  for (let k = 0; k < N; k++) {
    const p = k * S
    // horizontal rail at each cell row top (bottom rails = next row's top;
    // the v=1 edge wraps onto the v=0 rail, so the pattern tiles seamlessly)
    // galvanized steel (t126 live: dark bars read as a 'corrupted black grid')
    const g = ctx.createLinearGradient(0, p, 0, p + B)
    g.addColorStop(0, '#a8b0ba'); g.addColorStop(0.4, '#828a95'); g.addColorStop(1, '#5c636d')
    ctx.fillStyle = g
    ctx.fillRect(0, p, TEX, B)
    ctx.fillStyle = 'rgba(235,241,247,0.6)'
    ctx.fillRect(0, p, TEX, 2)
    // vertical post at each cell column left
    const g2 = ctx.createLinearGradient(p, 0, p + B, 0)
    g2.addColorStop(0, '#a8b0ba'); g2.addColorStop(0.4, '#828a95'); g2.addColorStop(1, '#5c636d')
    ctx.fillStyle = g2
    ctx.fillRect(p, 0, B, TEX)
    ctx.fillStyle = 'rgba(235,241,247,0.6)'
    ctx.fillRect(p, 0, 2, TEX)
  }
  // one thin mid picket per cell (0.5 m spacing — the thinnest feature that
  // stays below the t126 moire threshold; fades to open air at distance
  // instead of aliasing, rails+posts carry the silhouette)
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    const x0 = cx * S, y0 = cy * S
    const g = ctx.createLinearGradient(x0 + S / 2 - 3, 0, x0 + S / 2 + 4, 0)
    g.addColorStop(0, '#767e88'); g.addColorStop(0.5, '#8d95a0'); g.addColorStop(1, '#5f666f')
    ctx.fillStyle = g
    ctx.fillRect(x0 + S / 2 - 3, y0 + B, 7, S - B)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Procedural CS-style operator skins: camo fabric, chest rig, face.

const soldierTexCache = new Map<string, THREE.Texture>()

const CAMO: Record<'CT' | 'T', { base: string; blobs: string[] }> = {
  CT: { base: '#47535e', blobs: ['#333c44', '#5a6a77', '#2a3138'] },   // urban blue-grey
  T: { base: '#8f7a4e', blobs: ['#75623c', '#a3905f', '#5f4f33'] },    // desert tan
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, color: string) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot)
  ctx.fillStyle = color
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

function camoBase(ctx: CanvasRenderingContext2D, team: 'CT' | 'T', seed: number) {
  const pal = CAMO[team]
  ctx.fillStyle = pal.base
  ctx.fillRect(0, 0, 128, 128)
  let s = seed
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 30; i++) {
    blob(ctx, rnd() * 128, rnd() * 128, 6 + rnd() * 15, 4 + rnd() * 9, rnd() * Math.PI, pal.blobs[i % 3])
  }
  grain(ctx, 128, 128, 4, 400, 0.07)
}

/** camo fabric — torso sides/back, sleeves, thighs */
export function soldierCamo(team: 'CT' | 'T'): THREE.Texture {
  const key = `camo-${team}`
  const hit = soldierTexCache.get(key)
  if (hit) return hit
  const [c, ctx] = makeCanvas(128, 128)
  camoBase(ctx, team, team === 'CT' ? 7 : 13)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  soldierTexCache.set(key, t)
  return t
}

/** torso FRONT: camo + tactical vest, mag pouches, radio, belt */
export function soldierVest(team: 'CT' | 'T'): THREE.Texture {
  const key = `vest-${team}`
  const hit = soldierTexCache.get(key)
  if (hit) return hit
  const [c, ctx] = makeCanvas(128, 128)
  camoBase(ctx, team, team === 'CT' ? 23 : 41)
  // shoulder straps
  ctx.fillStyle = '#1f2225'
  ctx.fillRect(10, 6, 26, 16); ctx.fillRect(92, 6, 26, 16)
  // vest plate
  ctx.fillStyle = '#26292d'
  ctx.fillRect(14, 20, 100, 56)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2
  ctx.strokeRect(15, 21, 98, 54)
  // 3 mag pouches
  for (let i = 0; i < 3; i++) {
    const x = 24 + i * 28
    ctx.fillStyle = '#3b4147'; ctx.fillRect(x, 42, 22, 26)
    ctx.fillStyle = '#2c3136'; ctx.fillRect(x, 42, 22, 9)
    ctx.fillStyle = '#151719'; ctx.fillRect(x + 9, 46, 4, 3)
  }
  // radio + antenna on right chest
  ctx.fillStyle = '#202329'; ctx.fillRect(102, 28, 12, 18)
  ctx.fillStyle = '#0d8a3d'; ctx.fillRect(106, 31, 2, 2)
  ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.moveTo(108, 28); ctx.lineTo(106, 14); ctx.stroke()
  // admin pouch left
  ctx.fillStyle = '#33383d'; ctx.fillRect(18, 42, 12, 16)
  // belt
  ctx.fillStyle = '#1b1e21'; ctx.fillRect(0, 82, 128, 14)
  ctx.fillStyle = '#4a4f55'; ctx.fillRect(58, 84, 12, 10)
  grain(ctx, 128, 128, 9, 350, 0.08)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  soldierTexCache.set(key, t)
  return t
}

/** face — balaclava with eye slit; CT navy, T sand */
export function soldierFace(team: 'CT' | 'T'): THREE.Texture {
  const key = `face-${team}`
  const hit = soldierTexCache.get(key)
  if (hit) return hit
  const [c, ctx] = makeCanvas(64, 64)
  const mask = team === 'CT' ? '#2c333d' : '#7d6a4a'
  const skin = team === 'CT' ? '#c9a17c' : '#b58a63'
  ctx.fillStyle = mask
  ctx.fillRect(0, 0, 64, 64)
  grain(ctx, 64, 64, 5, 260, 0.1)
  // eye slit
  ctx.fillStyle = skin
  ctx.fillRect(10, 24, 44, 14)
  // war paint stripes across the slit
  ctx.fillStyle = 'rgba(30,25,20,0.45)'
  ctx.fillRect(14, 24, 3, 14); ctx.fillRect(30, 24, 4, 14); ctx.fillRect(46, 24, 3, 14)
  // brows
  ctx.fillStyle = '#1a1613'
  ctx.fillRect(12, 22, 16, 4); ctx.fillRect(36, 22, 16, 4)
  // eyes
  ctx.fillStyle = '#e8e4dc'
  ctx.fillRect(16, 29, 10, 6); ctx.fillRect(38, 29, 10, 6)
  ctx.fillStyle = '#20140a'
  ctx.fillRect(20, 30, 4, 4); ctx.fillRect(42, 30, 4, 4)
  // mouth hint (T mask has a breathing slit)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(26, 48, 12, 3)
  // helmet shadow at top
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(0, 0, 64, 8)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  soldierTexCache.set(key, t)
  return t
}

// ---------------- Task 131: island procedural fallbacks ----------------
// Keep the map testable + pretty BEFORE the ambientCG photo bake lands
// (PBR_BY_MAP.island upgrades these to jpgs the moment they exist — same
// office pattern: canvas first, identity files later).
function islandSpeckle(palette: string[], grain: number, blotch: number): THREE.CanvasTexture {
  const S = 256
  const [c, ctx] = makeCanvas(S, S)
  ctx.fillStyle = palette[0]
  ctx.fillRect(0, 0, S, S)
  const rnd = mulberry32(131)
  for (let i = 0; i < grain; i++) {
    ctx.fillStyle = palette[1 + Math.floor(rnd() * (palette.length - 1))]
    const w = 1 + rnd() * (blotch ? 13 : 2.2)
    const h = 1 + rnd() * (blotch ? 8 : 2.2)
    ctx.fillRect(rnd() * S, rnd() * S, w, h)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
export function isandTexture(): THREE.Texture {
  return islandSpeckle(['#dcc9a0', '#cdb98e', '#e6d8b4', '#c2ad7f'], 2600, 0)   // fine beach grain
}
export function igrassTexture(): THREE.Texture {
  return islandSpeckle(['#74904f', '#668244', '#82a05e', '#577343'], 3400, 3)  // dune grass + blade clumps
}
export function irockTexture(): THREE.Texture {
  return islandSpeckle(['#8a8578', '#767167', '#9c968b', '#655f57'], 1400, 8)   // coarse cliff blotches
}
export function barkTexture(): THREE.CanvasTexture {
  // palm trunk: horizontal ring bands (the segmented bark read) + grit
  const S = 256
  const [c, ctx] = makeCanvas(S, S)
  ctx.fillStyle = '#8c6f52'
  ctx.fillRect(0, 0, S, S)
  const rnd = mulberry32(77)
  for (let y = 0; y < S; y += 9 + Math.floor(rnd() * 7)) {
    ctx.fillStyle = rnd() > 0.5 ? '#75573c' : '#9d8266'
    ctx.fillRect(0, y, S, 3 + rnd() * 5)
  }
  ctx.fillStyle = '#6a4f37'
  for (let i = 0; i < 650; i++) ctx.fillRect(rnd() * S, rnd() * S, 2, 2)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
export function leafTexture(): THREE.Texture {
  return islandSpeckle(['#3f7032', '#356128', '#4d8040', '#2c5222'], 2200, 2)  // frond/thatch green
}

// ---------------- material factory (map + bump, shared by mapview/details) ----------------
export type SurfaceTex = 'sand' | 'wall' | 'crate' | 'metal' | 'dark' | 'plank' | 'door' | 'doorBlue' | 'brick' | 'concrete'
  | 'carpet' | 'offwall' | 'ceiling' | 'snow' | 'tile' | 'glass' | 'fence'   // Task 126 office families
  | 'isand' | 'igrass' | 'irock' | 'bark' | 'leaf'   // Task 131 island families

/** fence bump: the railing's own relief — holes would poison bumpFrom's
 * grayscale copy (transparent canvas), so draw an opaque grayscale twin.
 * Task 141: bars only (rails/posts/pickets) — the old diagonal-X truss
 * relief is gone with the scaffolding look. */
let fenceBumpCache: THREE.Texture | null = null
function fenceBump(): THREE.Texture {
  if (fenceBumpCache) return fenceBumpCache
  const [c, ctx] = makeCanvas(128, 128)
  ctx.fillStyle = '#20242a'   // hole depth
  ctx.fillRect(0, 0, 128, 128)
  // rails + posts every 64 px (= 1 m at the 2 m repeat)
  ctx.fillStyle = '#b8bec6'   // bar relief
  for (let k = 0; k < 2; k++) {
    const p = k * 64
    ctx.fillRect(0, p, 128, 7)
    ctx.fillRect(p, 0, 7, 128)
  }
  // thin mid picket per cell
  ctx.fillStyle = '#9aa0a8'
  ctx.fillRect(32, 0, 4, 128)
  ctx.fillRect(96, 0, 4, 128)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  fenceBumpCache = t
  return t
}

const matCache = new Map<string, THREE.MeshLambertMaterial>()

/** Task 77: materials are now scoped per map — maps can carry their own
 * texture identity (aimhead = aztec greens; dust/dust2 share the desert set
 * via the shared/no-override key). key = mapId ? `${mapId}:${tex}` : tex. */
export function surfaceMaterial(tex: SurfaceTex, mapId?: string): THREE.MeshLambertMaterial {
  const key = mapId ? `${mapId}:${tex}` : tex
  const hit = matCache.get(key)
  if (hit) return hit
  let map: THREE.Texture
  let bumpScale = 0.4
  switch (tex) {
    case 'sand': map = sandTexture(); bumpScale = 0.22; break
    case 'wall': map = wallTexture(); bumpScale = 0.45; break
    case 'crate': map = crateTexture(); bumpScale = 0.55; break
    case 'metal': map = metalTexture(); bumpScale = 0.3; break
    case 'dark': map = darkTexture(); bumpScale = 0.35; break
    case 'plank': map = plankTexture(); bumpScale = 0.5; break
    case 'door': map = doorTexture(); bumpScale = 0.4; break
    case 'doorBlue': map = doorBlueTexture(); bumpScale = 0.35; break
    case 'brick': map = brickTexture(); bumpScale = 0.65; break
    case 'concrete': map = concreteTexture(); bumpScale = 0.3; break
    // Task 126 office families — high-quality procedural canvases (see the
    // generators above for what each one draws)
    case 'carpet': map = carpetTexture(); bumpScale = 0.5; break
    case 'offwall': map = offwallTexture(); bumpScale = 0.35; break
    case 'ceiling': map = ceilingTexture(); bumpScale = 0.5; break
    case 'snow': map = snowTexture(); bumpScale = 0.3; break
    case 'tile': map = tileTexture(); bumpScale = 0.55; break
    case 'glass': map = glassTexture(); bumpScale = 0.12; break
    case 'fence': map = fenceTexture(); bumpScale = 0.7; break
    // Task 131 island families (canvas fallbacks — see generators above)
    case 'isand': map = isandTexture(); bumpScale = 0.5; break
    case 'igrass': map = igrassTexture(); bumpScale = 0.5; break
    case 'irock': map = irockTexture(); bumpScale = 0.6; break
    case 'bark': map = barkTexture(); bumpScale = 0.4; break
    case 'leaf': map = leafTexture(); bumpScale = 0.3; break
  }
  const src = map.image as HTMLCanvasElement
  const mat = new THREE.MeshLambertMaterial({
    map,
    bumpMap: tex === 'fence' ? fenceBump() : bumpFrom(src, tex === 'brick' ? 1.7 : 1.55),
    bumpScale,
  })
  // office BSP geom carries per-vertex BAKED CS 1.6 lightmap colors — the
  // map's PBR_BY_MAP entries flag lit:true and this material multiplies them
  // in. Box-built maps have no color attribute, so non-lit scopes stay false
  // (a vertexColors material without geometry colors renders black).
  if (pbrSpec(tex, mapId).lit) mat.vertexColors = true
  if (tex === 'glass') {
    mat.transparent = true
    mat.opacity = 0.34
    mat.depthWrite = false      // see + shoot through windows cleanly
    // BSP windows emit BOTH brush sides as coplanar panes — z-fight shimmer
    mat.polygonOffset = true
    mat.polygonOffsetFactor = -1
    mat.polygonOffsetUnits = -1
  }
  if (tex === 'fence') {
    mat.alphaTest = 0.45        // lattice holes discard — see-through railings
  }
  mat.onBeforeCompile = patchSurfaceShader           // Task 76: world-space albedo variation
  mat.customProgramCacheKey = () => 'surface-var-2'  // patched materials share programs (v2: lightmap gamma lift)
  matCache.set(key, mat)
  if (!pbrKickStarted) {
    pendingUpgrades.push([tex, mapId]) // map-scoped mats are swept too (Task 77)
    kickPbrUpgrade()                     // first material ever: sweep what exists
  } else upgradeSurface(tex, mapId)        // late-created surface: upgrade just it
  return mat
}

// ---------------- world-space albedo variation (Task 76) ----------------
// Large surfaces repeat their tile dozens of times (the 96 m T-back wall =
// 32 wall tiles) and every box face used to start at the same texture phase —
// that reads as a grid. Two complementary kills: (1) mapview/mapdetails bake
// per-face UV phase offsets into the geometry (different pattern slice per
// face); (2) THIS — a seamless 256x256 value-noise texture multiplied into
// diffuse at WORLD position (~11 m period, +-7% luminance), so identical
// tiles in different places no longer match. Patched into every cached
// surface material via onBeforeCompile; the photo-PBR hot-swap only swaps
// mat.map/bumpMap (no recompile), so the patch survives upgrades.

let variationTex: THREE.CanvasTexture | null = null
function variationTexture(): THREE.CanvasTexture {
  if (variationTex) return variationTex
  const N = 256
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  // seamless multi-octave value noise: every octave grid size divides N so
  // sampling wraps without a seam; deterministic seed (no Math.random)
  const grids = [4, 8, 16]
  const amps = [1, 0.5, 0.25]
  const rand = grids.map(g => {
    const a: number[] = []
    let s = 0x9E3779B9
    for (let i = 0; i < g * g; i++) {
      s = Math.imul(s ^ (s >>> 15), 2246822519)
      a.push((s >>> 0) / 4294967296)
    }
    return a
  })
  const at = (o: number, gx: number, gy: number) => {
    const g = grids[o]
    return rand[o][((gy % g + g) % g) * g + ((gx % g + g) % g)]
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0
      for (let o = 0; o < grids.length; o++) {
        const g = grids[o]
        const fx = (x / N) * g, fy = (y / N) * g
        const x0 = Math.floor(fx), y0 = Math.floor(fy)
        const tx = smooth(fx - x0), ty = smooth(fy - y0)
        const q = (gx: number, gy: number) => at(o, gx, gy)
        v += amps[o] * ((q(x0, y0) * (1 - tx) + q(x0 + 1, y0) * tx) * (1 - ty)
                      + (q(x0, y0 + 1) * (1 - tx) + q(x0 + 1, y0 + 1) * tx) * ty)
      }
      v /= 1.75 // amp sum -> [0..1]
      const lum = Math.round(255 * (0.87 + 0.13 * v)) // 0.87..1.0; shader gain re-centers at ~1
      const i = (y * N + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = lum
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  variationTex = t
  return t
}

const VAR_TEX_U: THREE.IUniform = { value: null as THREE.Texture | null }

/** onBeforeCompile patch: world-position varyings + diffuse multiply after map. */
function patchSurfaceShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  VAR_TEX_U.value = variationTexture()
  shader.uniforms.varTex = VAR_TEX_U
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
    .replace('#include <project_vertex>',
      `#include <project_vertex>\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvWNorm = normalize( mat3( modelMatrix ) * objectNormal );`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nuniform sampler2D varTex;')
    .replace('#include <map_fragment>',
      `#include <map_fragment>\n{\n  vec2 varUv = abs( vWNorm.y ) > 0.5 ? vWPos.xz : ( abs( vWNorm.x ) > 0.5 ? vWPos.zy : vWPos.xy );\n  diffuseColor.rgb *= texture2D( varTex, varUv * 0.09 ).rgb * 1.0695;\n}`)
    // Task 126: baked GoldSrc lightmaps multiply the albedo AND standard
    // lighting applies on top — interiors double-dipped to ~30% brightness.
    // Gamma-lift the vertex color (USE_COLOR only defined when vertexColors
    // is on = the lit BSP maps) so lightmap 0.3 -> ~0.51, 0.5 -> ~0.68:
    // brightens rooms while keeping the baked light's contrast and pools.
    .replace('#include <color_fragment>',
      `#ifdef USE_COLOR\n  diffuseColor.rgb *= pow( vColor.rgb, vec3( 0.55 ) );\n#endif`)
}

// ---------------- photo-PBR upgrade (Task 73, PolyHaven CC0 set) ----------------
// Progressive enhancement: real photo albedo + height maps hot-swap onto the
// CACHED surface materials once fetched — every merged map mesh updates,
// nothing rebuilds. Loader policy (AGENTS.md): /assets/textures/maps first,
// /staging/textures/maps fallback; on a fresh clone both 404 and the
// procedural canvas look stays (the zero-external-assets guarantee holds).
// Sources + per-file provenance: public/{staging,assets}/textures/maps/sources.json
// (scripts/fetch-map-textures.py reproduces every staged byte from polyhaven.com).

/** Real-world span of one texture tile, meters — sets repeat = 2.86/tile
 * (mapview UV_PER_M 0.35). Bump scales are retuned per surface because the
 * PolyHaven displacement maps are gentler than the contrast-boosted canvas
 * bumps. `normal` (Task 88) = optional tangent-space normalScale when the
 * surface ships a <s>_normal.jpg — normal maps supersede the height bump
 * when present; the bump pair stays as the offline fallback. All tuning
 * knobs, not contracts. */
type PbrSpec = { tile: number; bump: number; normal?: number; lit?: boolean }
const PBR: Record<SurfaceTex, PbrSpec> = {
  sand:     { tile: 14,  bump: 0.55 }, // aerial_sand — 15 m capture, ruts
  wall:     { tile: 3.0, bump: 1.0  }, // worn_cracked_plaster 2K — weathered sand plaster, cracks (Task 74; larger tile cuts visible repetition on long walls)
  brick:    { tile: 1.8, bump: 1.5  }, // large_sandstone_blocks
  concrete: { tile: 3.0, bump: 0.8  }, // concrete — dirty outdoor
  crate:    { tile: 1.2, bump: 1.3  }, // plywood — per crate face
  plank:    { tile: 2.0, bump: 1.2  }, // wood_planks_dirt
  metal:    { tile: 1.5, bump: 0.8  }, // worn_corrugated_iron
  dark:     { tile: 3.5, bump: 0.8  }, // asphalt_03 — dirty road
  door:     { tile: 1.1, bump: 1.0  }, // painted_metal_shutter
  doorBlue: { tile: 1.2, bump: 0.9  }, // blue_painted_planks
  // Task 126 office families — conservative shared specs (office's real tiles
  // live in PBR_BY_MAP.office, calibrated to the BSP's measured UV density).
  // glass/fence ship no jpgs by design (alpha) — the loader 404s and the
  // procedural canvas look stays, exactly like the fresh-clone fallback.
  carpet:   { tile: 2.0, bump: 0.5  },
  offwall:  { tile: 3.0, bump: 0.35 },
  ceiling:  { tile: 2.4, bump: 0.5  },
  snow:     { tile: 6.0, bump: 0.3  },
  tile:     { tile: 1.2, bump: 0.55 },
  glass:    { tile: 1.5, bump: 0.12 },
  fence:    { tile: 1.2, bump: 0.7  },
  // Task 131 island families — conservative shared specs (island's real
  // tiles live in PBR_BY_MAP.island, calibrated to world/3 UVs). No shared
  // jpgs ship: the loader 404s and the procedural canvas look stays.
  isand:    { tile: 1.15, bump: 0.5  },
  igrass:   { tile: 1.15, bump: 0.55 },
  irock:    { tile: 1.0,  bump: 0.75 },
  bark:     { tile: 1.0,  bump: 0.45 },
  leaf:     { tile: 1.4,  bump: 0.35 },
}

/** Task 77 — per-map texture identities. A map with an entry here renders its
 * surfaces from /textures/maps/<mapId>/<surface>.jpg instead of the shared
 * desert set (dust/dust2 = shared albedo + scoped normals — Tasks 90/96).
 * The ORIGINAL aim_headshot is built from
 * de_aztec.wad textures (AzGrass/AzWll/AzStat... — the "Az" prefix = Aztec,
 * confirmed via the BSP worldspawn wad list), so aimhead gets the aztec
 * greens: grass ground, mossy temple sandstone walls, mossy statues,
 * olive military crates, mossy trim. crate stays shared (universal CS wooden
 * crates). Tiles/bumps re-tuned per map surface.
 *
 * Task 88 — aimdepot gets the first ambientCG identity (ambientcg.com, CC0:
 * user-contributed source site). Beige river-sand yard, sandstone window
 * walls, light-grey concrete perimeter, plywood crates — each with a real
 * tangent-space normal map (the first _normal.jpg set in the game).
 *
 * Task 90 — dust2 + aimhead get the scoped normal upgrade: each surface's
 * OWN PolyHaven nor_gl map (the albedo/height sets are PolyHaven CC0
 * already, Tasks 73-77), so the relief matches the accepted look
 * pixel-for-pixel geometrically. dust2's dir ships only the 10 normals
 * (albedo/bump stay shared through the chain); aimhead's 5 aztec identity
 * surfaces get theirs appended (the hue-baked grass keeps its native
 * normal — hue moves color, not geometry). Task 96 — plain "dust" mirrors
 * the dust2 normals byte-for-byte (same shared desert set). */
const PBR_BY_MAP: Record<string, Partial<Record<SurfaceTex, PbrSpec>>> = {
  aimhead: {
    // tile params derive from MEASURED BSP UV density (Task 77): geom groups
    // carry 3.2 m/UV (ground+walls), 5.89 (plank), 1.68 (metal), 1.22 (dark);
    // spec tile = 2.86 × target_world_m / m_per_uv. Targets: grass 5 m,
    // cobble walls 2.5 m, trim 3 m, crate-metal 1.2 m, statue 2 m.
    sand:  { tile: 4.5, bump: 0.8, normal: 0.8  }, // grass_path_2 hue-baked — aztec lawn (bump raised iter3: tuft relief; Task 90: native nor_gl)
    brick: { tile: 2.2, bump: 1.3, normal: 1.1  }, // mossy_cobblestone hue-baked — temple walls (AzWll) (bump raised iter3: stone relief)
    dark:  { tile: 4.7, bump: 0.9, normal: 0.9  }, // mossy_rock — center statues (AzStat)
    metal: { tile: 2.0, bump: 0.9, normal: 0.9  }, // green_metal_rust — military crates (MltryCrte)
    plank: { tile: 1.5, bump: 1.1, normal: 1.0  }, // moss_wood — trim (AzTrim)
  },
  aimdepot: {
    // ambientCG 1K sets (CC0, ambientcg.com — user-shared source site) — VLM
    // A/B picks (Tasks 88 + 92): grey pavement yard framed by dark walls.
    // Provenance + fetch pipeline: sources.json in the aimdepot texture dir
    // (HuggingFace tar mirror; ambientcg.com is TCP-blocked from the box).
    sand:  { tile: 8,   bump: 0.8, normal: 0.85 }, // PavingStones034 — city pavement pavers (Task 92: user — ground must not be sand; VLM pick of 8 hardscape candidates, mid-grey depot fit; tile 10->8 for believable paver scale)
    brick: { tile: 2.2, bump: 1.3, normal: 1.1  }, // Bricks083 — tan medieval sandstone blocks
    wall:  { tile: 4.5, bump: 0.9, normal: 0.7  }, // Concrete044A — smooth charcoal concrete (tile raised 3.0->4.5 iter2: form-work band tiled visibly on the 64 m perimeter walls — Task-74 remedy)
    crate: { tile: 1.5, bump: 1.3, normal: 1.0  }, // Wood092 — warm fine crate wood (tile 1.2->1.5 iter2: finer grain, less vertical smear)
  },
  // Task 96 — plain 'dust' mirrors the dust2 scoped normal upgrade
  // BYTE-FOR-BYTE: dust shares the desert albedo/height set with dust2
  // (dust was the bare-key map), so its dir ships the same 10 PolyHaven
  // nor_gl normals (copied from dust2/ — provenance in dust/sources.json);
  // albedo/bump resolve through the chain to the shared files. Tiles/bumps
  // mirror the dust2 spec verbatim. All four maps now carry real relief.
  dust: {
    sand:     { tile: 14,  bump: 0.55, normal: 0.6  }, // aerial_sand — ruts
    wall:     { tile: 3.0, bump: 1.0,  normal: 0.75 }, // worn_cracked_plaster 2K — hairline cracks (dominant surface)
    brick:    { tile: 1.8, bump: 1.5,  normal: 1.0  }, // large_sandstone_blocks
    concrete: { tile: 3.0, bump: 0.8,  normal: 0.7  }, // concrete — dirty outdoor
    crate:    { tile: 1.2, bump: 1.3,  normal: 1.0  }, // plywood
    plank:    { tile: 2.0, bump: 1.2,  normal: 1.0  }, // wood_planks_dirt
    metal:    { tile: 1.5, bump: 0.8,  normal: 0.8  }, // worn_corrugated_iron
    dark:     { tile: 3.5, bump: 0.8,  normal: 0.6  }, // asphalt_03
    door:     { tile: 1.1, bump: 1.0,  normal: 0.9  }, // painted_metal_shutter
    doorBlue: { tile: 1.2, bump: 0.9,  normal: 0.9  }, // blue_painted_planks
  },
  dust2: {
    // Task 90 — dust2 gets the scoped normal upgrade: this dir ships ONLY the
    // 10 <s>_normal.jpg (each surface's OWN PolyHaven nor_gl, matching the
    // shared desert set asset-for-asset — scripts/fetch-normal-maps.py);
    // albedo/bump resolve through the loader chain to the shared files, so
    // the accepted Task-75 look is untouched. Tiles/bumps mirror the shared
    // spec verbatim — only real surface relief is added.
    sand:     { tile: 14,  bump: 0.55, normal: 0.6  }, // aerial_sand — ruts
    wall:     { tile: 3.0, bump: 1.0,  normal: 0.75 }, // worn_cracked_plaster 2K — hairline cracks (dominant surface)
    brick:    { tile: 1.8, bump: 1.5,  normal: 1.0  }, // large_sandstone_blocks
    concrete: { tile: 3.0, bump: 0.8,  normal: 0.7  }, // concrete — dirty outdoor
    crate:    { tile: 1.2, bump: 1.3,  normal: 1.0  }, // plywood
    plank:    { tile: 2.0, bump: 1.2,  normal: 1.0  }, // wood_planks_dirt
    metal:    { tile: 1.5, bump: 0.8,  normal: 0.8  }, // worn_corrugated_iron
    dark:     { tile: 3.5, bump: 0.8,  normal: 0.6  }, // asphalt_03
    door:     { tile: 1.1, bump: 1.0,  normal: 0.9  }, // painted_metal_shutter
    doorBlue: { tile: 1.2, bump: 0.9,  normal: 0.9  }, // blue_painted_planks
  },
  office: {
    // Task 126 — cs_office BSP import. Every family is lit:true (geom.json
    // carries per-vertex baked GoldSrc lightmaps — surfaceMaterial flips
    // vertexColors on from this flag). Tiles calibrated to the BSP's MEASURED
    // UV density (scripts/bsp/office-uvdensity.ts): tile = 2.86 × target_m /
    // m_per_uv. ambientCG CC0 identities for the five photo families + red
    // brick / clean-wood overrides (the shared brick is desert SANDstone and
    // plank is dirt planks — office wants classic red courses and clean oak
    // desks); concrete/metal/dark/crate reuse the accepted shared sets.
    // glass/fence stay procedural (alpha textures can't ship as jpgs).
    carpet:   { tile: 2.39, bump: 0.55, normal: 0.75, lit: true },  // carpet fleck — 2 m span
    offwall:  { tile: 4.00, bump: 0.40, normal: 0.45, lit: true },  // painted drywall — 3 m span
    ceiling:  { tile: 4.16, bump: 0.50, normal: 0.60, lit: true },  // drop-ceiling 0.6 m grid
    snow:     { tile: 2.02, bump: 0.35, normal: 0.50, lit: true },  // snow yard — 6 m drifts
    tile:     { tile: 1.07, bump: 0.70, normal: 0.80, lit: true },  // hallway ceramic 0.3 m
    concrete: { tile: 1.86, bump: 0.80, normal: 0.70, lit: true },
    brick:    { tile: 0.89, bump: 1.30, normal: 1.00, lit: true },  // office override: classic RED brick (shared = sandstone)
    metal:    { tile: 1.79, bump: 0.80, normal: 0.80, lit: true },
    plank:    { tile: 2.84, bump: 1.10, normal: 0.90, lit: true },  // office override: clean oak desks/doors
    dark:     { tile: 5.26, bump: 0.60, normal: 0.60, lit: true },  // parking asphalt
    crate:    { tile: 1.80, bump: 1.20, normal: 0.90, lit: true },
    glass:    { tile: 1.48, bump: 0.12,              lit: true },  // procedural only (no jpg by design)
    fence:    { tile: 1.42, bump: 0.70,              lit: true },  // procedural only (alphaTest lattice)
  },
  island: {
    // Task 131 — tropical island. Every family lit:true (geom carries the
    // per-vertex sun+AO bake, light.ts SUN == the engine sun position).
    // Terrain UVs are world-m/3, so tile k spans 3/k m (isand/igrass ~2.6 m).
    // Task 132: photo-PBR jpgs ACCEPTED — live in /assets/textures/maps/island/
    isand:    { tile: 1.15, bump: 0.50, normal: 0.55, lit: true },   // beach sand
    igrass:  { tile: 1.15, bump: 0.55, normal: 0.60, lit: true },   // dune grass
    irock:   { tile: 1.0,  bump: 0.75, normal: 0.70, lit: true },   // cliffs + boulders
    bark:    { tile: 1.0,  bump: 0.45, normal: 0.45, lit: true },   // palm trunks
    leaf:    { tile: 1.4,  bump: 0.35, normal: 0.40, lit: true },   // fronds + thatch roofs
    plank:   { tile: 2.0,  bump: 1.0,  normal: 0.85, lit: true },   // pier/hut planks (uv 0.5/m)
    metal:   { tile: 2.0,  bump: 0.8,  normal: 0.8,  lit: true },   // radar mast/dish
    concrete:{ tile: 2.0,  bump: 0.8,  normal: 0.7,  lit: true },   // radar foundation
  },
}

/** Effective PBR spec for (map, surface): map override falls back to shared. */
function pbrSpec(s: SurfaceTex, mapId?: string): PbrSpec {
  return (mapId && PBR_BY_MAP[mapId]?.[s]) || PBR[s]
}

/** Task 88 preloader: does this (map, surface) pair ship an optional
 * <s>_normal.jpg to warm? Only scoped identity surfaces declare one. */
export function pbrHasNormal(s: SurfaceTex, mapId?: string): boolean {
  return pbrSpec(s, mapId).normal !== undefined
}

/** Task 81 preloader: candidate URL chain for one surface file, in the exact
 * order loadTexFirst tries them (below) — preloading the same URLs the
 * loader will ask for is what makes the loader's own fetch an instant cache
 * hit. Keep in sync with loadTexFirst. */
export function texChain(base: string, mapId?: string): string[] {
  if (!mapId) return [`/assets/textures/maps/${base}`, `/staging/textures/maps/${base}`]
  return [
    `/assets/textures/maps/${mapId}/${base}`,
    `/staging/textures/maps/${mapId}/${base}`,
    `/assets/textures/maps/${base}`,
    `/staging/textures/maps/${base}`,
  ]
}

/** Map id to scope materials under — only maps WITH a PBR_BY_MAP entry get
 * their own identity; everything else stays on the shared (bare-key) path,
 * byte-identical to pre-Task-77 behavior. */
export function pbrMapScope(mapId?: string): string | undefined {
  return (mapId && PBR_BY_MAP[mapId]) ? mapId : undefined
}

const SURFACES = Object.keys(PBR) as SurfaceTex[]
/** Task 81 preloader: every surface the map view will PBR-upgrade. */
export const PBR_SURFACES: SurfaceTex[] = SURFACES
let pbrKickStarted = false
const pendingUpgrades: Array<[SurfaceTex, string | undefined]> = []
export const pbrState: Record<string, 'idle' | 'loading' | 'ready' | 'failed'> = {}
SURFACES.forEach(s => { pbrState[s] = 'idle' })

function loadTexFirst(srgb: boolean, base: string, tile: number, mapId?: string): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader()
  const one = (p: string) => loader.loadAsync(p).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    const r = 2.86 / tile
    t.repeat.set(r, r)
    t.anisotropy = 8   // Task 74: 4 blurred long walls at glancing angles
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    return t
  })
  // per-map identity first (staged map set evaluates live over accepted
  // shared), then shared desert set; assets-first, staged-fallback per the
  // AGENTS.md acceptance policy. Map-scoped = 4-step chain, single code path.
  if (!mapId) return one(`/assets/textures/maps/${base}`).catch(() => one(`/staging/textures/maps/${base}`))
  return one(`/assets/textures/maps/${mapId}/${base}`)
    .catch(() => one(`/staging/textures/maps/${mapId}/${base}`))
    .catch(() => one(`/assets/textures/maps/${base}`))
    .catch(() => one(`/staging/textures/maps/${base}`))
}

/** Upgrade one surface type (idempotent — first call wins).
 * State key: `${mapId}:${s}` when map-scoped (bare surface otherwise). */
function upgradeSurface(s: SurfaceTex, mapId?: string) {
  const key = mapId ? `${mapId}:${s}` : s
  const mat = matCache.get(key)
  // scoped keys are NOT pre-initialized at module load — undefined === 'idle'
  if (!mat || (pbrState[key] ?? 'idle') !== 'idle') return
  pbrState[key] = 'loading'
  const spec = pbrSpec(s, mapId)
  Promise.all([
    loadTexFirst(true, `${s}.jpg`, spec.tile, mapId),
    loadTexFirst(false, `${s}_bump.jpg`, spec.tile, mapId),
  ]).then(([albedo, bump]) => {
    mat.map = albedo
    mat.bumpMap = bump
    mat.bumpScale = spec.bump
    mat.needsUpdate = true
    pbrState[key] = 'ready'
    // Task 88 — optional tangent-space normal map: the real surface relief
    // upgrade for per-map identity sets. Fails soft on purpose (fresh clone /
    // offline keeps the height-bump look); also only surfaces whose spec
    // declares normal: ship a _normal.jpg.
    if (spec.normal !== undefined) {
      loadTexFirst(false, `${s}_normal.jpg`, spec.tile, mapId).then(nrm => {
        mat.normalMap = nrm
        mat.normalScale.set(spec.normal!, spec.normal!)
        // normal map supersedes the height bump — stacking the contrast-
        // boosted height AND the photo normal over-etches every surface
        mat.bumpMap = null
        mat.needsUpdate = true
      }).catch(() => { /* bump fallback stays */ })
    }
  }).catch(() => {
    // fresh clone / offline → procedural look stays, by design
    pbrState[key] = 'failed'
  })
}

function kickPbrUpgrade() {
  if (pbrKickStarted || typeof window === 'undefined') return
  pbrKickStarted = true
  // debugging/verification hook (harmless in production, mirrors __cs2hud)
  ;(window as unknown as { __pbrState?: unknown }).__pbrState = pbrState
  for (const [s, m] of pendingUpgrades) upgradeSurface(s, m) // every cached pair, scoped or bare
  pendingUpgrades.length = 0
}
