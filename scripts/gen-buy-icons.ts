// PHASE 9 (plan 9.1c) — 1.6-style buy-menu weapon silhouettes.
// Procedural icons: each buyable entry's parametric viewmodel (the SAME
// geometry the player holds — weaponmodels.ts) is projected by a fixed 3/4
// side view, scanline-rasterized as a coverage mask (2x supersampled for
// AA), and encoded as a transparent PNG with a light neutral silhouette that
// reads on the HUD's dark rows. Hand meshes (glove_fabric colors) are
// excluded so icons show weapons only. Gear rows (kevlar / helm / kit) get
// simple procedural box models below — there is no viewmodel for those.
//
// Policy v3: output lands in public/staging/icons/ (gitignored, web-served);
// acceptance at Phase 9 = user OK -> mv to public/assets/icons + git add.
//
// Run: bun scripts/gen-buy-icons.ts
import './domstub'
import * as THREE from 'three'
import { BUY_ENTRIES, WEAPONS, BuyEntry, WeaponId } from '../shared/weapons'
import { buildViewModel } from '../src/game/weaponmodels'
import { mkdirSync, writeFileSync } from 'fs'
import { deflateSync } from 'node:zlib'

const OUT = '/home/z/my-project/public/staging/icons'

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  out.set(data, 8)
  out.writeUInt32BE(crc32(new Uint8Array(out.subarray(4, 8 + data.length))), 8 + data.length)
  return out
}
/** 8-bit RGBA, filter 0 per scanline. */
function encodePNG(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

// ---------------------------------------------------------------- rasterizer
const W = 240, H = 96, PAD = 10, SS = 2          // icon box + 2x supersample
const SW = W * SS, SH = H * SS, SPAD = PAD * SS

// Scale policy (VLM-reviewed): GUNS render at one uniform world scale so an
// AWP dwarfs a pistol like the real 1.6 menu; throwables + gear are small
// objects and render fit-to-half-box instead. A close (dilate+erode) pass
// bridges the 1-2px seams between receiver/mag/stock parts so silhouettes
// read as one solid weapon, not floating chunks.

// hand-material colors (glove_fabric + team cuffs) — excluded from icons
const HAND_HEX = new Set([0x1a1c1f, 0x232527, 0x1d1f21, 0x9a7f4e, 0x2c4a6e])

/** View matrices: guns 3/4 side, then a 180° roll about the view axis — the
 *  first-person viewmodel pose renders magazine-UP in profile (user
 *  acceptance feedback: "the weapons magazine are in top"), so every gun
 *  class is rolled 180° to hang the mag DOWN like a grounded weapon photo
 *  (muzzle ends up pointing left). Throwables angled so the pin ring + spoon
 *  lever read (edge-on they vanish, and they are NOT rolled — the pin would
 *  end up at the bottom); gear flat FRONT view — frontal icons by nature. */
function viewMatrix(kind: 'gun' | 'nade' | 'gear'): THREE.Matrix4 {
  const R = THREE.MathUtils.degToRad
  if (kind === 'gun') return new THREE.Matrix4().makeRotationZ(R(180))
    .multiply(new THREE.Matrix4().makeRotationX(R(10)).multiply(new THREE.Matrix4().makeRotationY(R(-70))))
  if (kind === 'nade') return new THREE.Matrix4().makeRotationX(R(18)).multiply(new THREE.Matrix4().makeRotationY(R(-35)))
  return new THREE.Matrix4() // gear: identity front view
}

/** View-space bbox of a model (w,h in view units) for scale computation. */
function viewBBox(model: THREE.Object3D, vk: 'gun' | 'nade' | 'gear'): { w: number; h: number; minX: number; minY: number; maxX: number; maxY: number } {
  const vm = viewMatrix(vk)
  const m = new THREE.Matrix4()
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  model.updateMatrixWorld(true)
  model.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!(mesh as THREE.Mesh).isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat && HAND_HEX.has(mat.color?.getHex?.() ?? -1)) return
    const pos = mesh.geometry.attributes.position
    if (!pos) return
    m.copy(vm).multiply(mesh.matrixWorld)
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      if (!isFinite(v.x + v.y)) continue
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x)
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y)
    }
  })
  return { w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY }
}

/** Morphological close (dilate then erode) at SS resolution — bridges the
 *  part seams so receivers/mags/stocks read as one solid silhouette. */
function closeMask(cov: Uint8Array, sw: number, sh: number) {
  const dil = new Uint8Array(cov)
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (cov[y * sw + x]) continue
    let hit = 0
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && nx < sw && ny >= 0 && ny < sh && cov[ny * sw + nx]) { hit = 1; break }
    }
    if (hit) dil[y * sw + x] = 1
  }
  const out = new Uint8Array(dil)
  // erode back: only keep original coverage OR pixels whose whole 3x3 was dilated
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (cov[y * sw + x]) continue
    let all = 1
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= sw || ny < 0 || ny >= sh || !dil[ny * sw + nx]) { all = 0; break }
    }
    if (!all) out[y * sw + x] = 0
  }
  return out
}

function collectTris(root: THREE.Object3D, vk: 'gun' | 'nade' | 'gear'): number[][] {
  const vm = viewMatrix(vk)
  const m = new THREE.Matrix4()
  const v = new THREE.Vector3()
  const tris: number[][] = []
  root.updateMatrixWorld(true)
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!(mesh as THREE.Mesh).isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat && HAND_HEX.has(mat.color?.getHex?.() ?? -1)) return // hands off
    const geo = mesh.geometry
    const pos = geo.attributes.position
    if (!pos) return
    m.copy(vm).multiply(mesh.matrixWorld) // model -> view space
    const idx = geo.index
    const emit = (a: number, b: number, c: number) => {
      const p0 = new THREE.Vector3().fromBufferAttribute(pos, a).applyMatrix4(m)
      const p1 = new THREE.Vector3().fromBufferAttribute(pos, b).applyMatrix4(m)
      const p2 = new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(m)
      if (!isFinite(p0.x + p0.y + p1.x + p1.y + p2.x + p2.y)) return
      tris.push([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y])
    }
    if (idx) for (let i = 0; i + 2 < idx.count; i += 3) emit(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2))
    else for (let i = 0; i + 2 < pos.count; i += 3) emit(i, i + 1, i + 2)
  })
  return tris
}

/** Scanline triangle fill into a coverage buffer (1 = covered). */
function fillTri(cov: Uint8Array, sw: number, sh: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  // sort by y
  let ax = x0, ay = y0, bx = x1, by = y1, cx = x2, cy = y2
  if (ay > by) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay] }
  if (by > cy) { [bx, cx] = [cx, bx]; [by, cy] = [cy, by] }
  if (ay > by) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay] }
  const minY = Math.max(0, Math.ceil(ay)), maxY = Math.min(sh - 1, Math.floor(cy))
  if (minY > maxY) return
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  if (Math.abs(area) < 1e-12) return
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5
    // intersect scanline with the 3 edges -> xs, take min/max pair
    const xs: number[] = []
    const edge = (px: number, py: number, qx: number, qy: number) => {
      if ((py <= yc && qy > yc) || (qy <= yc && py > yc)) {
        xs.push(px + (yc - py) / (qy - py) * (qx - px))
      }
    }
    edge(ax, ay, bx, by); edge(bx, by, cx, cy); edge(ax, ay, cx, cy)
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)
    const x0f = Math.max(0, Math.ceil(xs[0])), x1f = Math.min(sw - 1, Math.floor(xs[xs.length - 1]))
    for (let x = x0f; x <= x1f; x++) cov[y * sw + x] = 1
  }
}

function renderIcon(model: THREE.Object3D, scale: number, bbox: { minX: number; minY: number; maxX: number; maxY: number }, vk: 'gun' | 'nade' | 'gear'): Uint8Array {
  const tris = collectTris(model, vk)
  if (!tris.length) throw new Error('no triangles')
  const bw = bbox.maxX - bbox.minX, bh = bbox.maxY - bbox.minY
  const ox = (SW - bw * scale) / 2 - bbox.minX * scale
  const oy = (SH - bh * scale) / 2 - bbox.minY * scale
  let cov = new Uint8Array(SW * SH)
  for (const t of tris) {
    fillTri(cov, SW, SH,
      t[0] * scale + ox, t[1] * scale + oy,
      t[2] * scale + ox, t[3] * scale + oy,
      t[4] * scale + ox, t[5] * scale + oy)
  }
  cov = closeMask(cov, SW, SH)
  // downsample SSxSS -> alpha; constant light silhouette color
  const rgba = new Uint8Array(W * H * 4)
  const R = 0xe8, G = 0xea, B = 0xee
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let a = 0
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) a += cov[(y * SS + sy) * SW + x * SS + sx]
      const i = (y * W + x) * 4
      rgba[i] = R; rgba[i + 1] = G; rgba[i + 2] = B; rgba[i + 3] = Math.round(255 * a / (SS * SS))
    }
  }
  return rgba
}

// ---------------------------------------------------------------- gear models
// Kevlar / helmet / defuse kit have no viewmodel — flat frontal icons built
// from overlapping boxes (front view, connected silhouettes, iconic 1.6-style
// proportions: vest wider than tall, dome helmet, case + handle + cutters).
function buildGear(id: string): THREE.Group {
  const g = new THREE.Group()
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }))
    m.position.set(x, y, z); g.add(m); return m
  }
  if (id === 'kevlar' || id === 'kevlarhelm') {
    // vest front view: shoulders -> chest -> waist, stacked + overlapping
    add(0.40, 0.09, 0.06, 0, 0.155, 0, 0x23282c)       // shoulder bar
    add(0.31, 0.15, 0.06, 0, 0.04, 0, 0x2f3439)        // chest plate
    add(0.24, 0.11, 0.06, 0, -0.075, 0, 0x2f3439)     // waist taper
    add(0.06, 0.09, 0.07, -0.13, 0.10, 0, 0x1c2f4a)   // shoulder caps
    add(0.06, 0.09, 0.07, 0.13, 0.10, 0, 0x1c2f4a)
    if (id === 'kevlarhelm') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x2f3439 }))
      dome.position.set(0, 0.36, 0); g.add(dome)       // dome sits on shoulders
      add(0.21, 0.05, 0.21, 0, 0.325, 0, 0x23282c)     // brim
    }
  } else if (id === 'defusekit') {
    // flat case + top handle + crossed cutters tucked at the corner
    add(0.36, 0.17, 0.05, 0, 0, 0, 0x2c4a2e)
    add(0.36, 0.055, 0.052, 0, 0.105, 0, 0x1f3a21)    // lid overlaps body
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 10, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x8a8f96 }))
    handle.position.set(0, 0.16, 0); g.add(handle)    // handle overlaps lid
    add(0.015, 0.16, 0.03, 0.15, -0.02, 0.02, 0x8a8f96) // cutter blade 1
    add(0.015, 0.16, 0.03, 0.185, -0.02, -0.02, 0x8a8f96) // cutter blade 2
  } else throw new Error(`no gear model for ${id}`)
  return g
}

// ---------------------------------------------------------------- main
mkdirSync(OUT, { recursive: true })
let fails = 0
const seen = new Set<string>()

// pass 1: build models + view bboxes
type VK = 'gun' | 'nade' | 'gear'
type Job = { id: string; model: THREE.Object3D; vk: VK; bbox: ReturnType<typeof viewBBox> }
const jobs: Job[] = []
for (const e of BUY_ENTRIES as BuyEntry[]) {
  if (seen.has(e.id)) continue
  seen.add(e.id)
  try {
    const isThrowable = !!(WEAPONS as Record<string, { throwable?: boolean }>)[e.id]?.throwable
    const vk: VK = e.kind === 'gear' ? 'gear' : isThrowable ? 'nade' : 'gun'
    const model = e.kind === 'weapon'
      ? buildViewModel(e.id as WeaponId, 'CT').group
      : buildGear(e.id)
    jobs.push({ id: e.id, model, vk, bbox: viewBBox(model, vk) })
  } catch (err) {
    console.log(`FAIL build: ${e.id} — ${err}`)
    fails++
  }
}

// pass 2: uniform gun scale from the LARGEST gun silhouette (AWP-class);
// throwables fit ~55% width (small objects, but the pin/lever must read);
// gear fit ~70% (frontal icons)
let maxW = 0, maxH = 0
for (const j of jobs) if (j.vk === 'gun') { maxW = Math.max(maxW, j.bbox.w); maxH = Math.max(maxH, j.bbox.h) }
const gunScale = Math.min((SW - 2 * SPAD) / maxW, (SH - 2 * SPAD) / maxH)

for (const j of jobs) {
  try {
    let scale: number
    if (j.vk === 'gun') {
      scale = gunScale
      // floor: tiny guns (pistols) must stay legible — at least 45% of box width
      const minW = 0.45 * (SW - 2 * SPAD)
      if (j.bbox.w * scale < minW) scale = minW / j.bbox.w
      // ceiling: never taller than the padded box
      if (j.bbox.h * scale > SH - 2 * SPAD) scale = (SH - 2 * SPAD) / j.bbox.h
    } else {
      const wf = j.vk === 'nade' ? 0.55 : 0.70
      scale = Math.min(wf * (SW - 2 * SPAD) / j.bbox.w, 0.85 * (SH - 2 * SPAD) / j.bbox.h)
    }
    const rgba = renderIcon(j.model, scale, j.bbox, j.vk)
    writeFileSync(`${OUT}/${j.id}.png`, encodePNG(W, H, rgba))
  } catch (err) {
    console.log(`FAIL render: ${j.id} — ${err}`)
    fails++
  }
}
console.log(`staged: ${jobs.length - fails} icons${fails ? `, ${fails} FAILURES` : ''} -> ${OUT} (${W}x${H}, gunScale ${(gunScale).toFixed(0)}px/m)`)
process.exit(fails ? 1 : 0)
