/**
 * verify-guns-orientation.ts — side-view silhouette contact sheet of the
 * staged weapon GLBs (scripts/.tmp/guns-fixed/*.glb), for visual muzzle
 * verification with a VLM pass.
 *
 * Projection: screen x = +worldZ, screen y = −worldY (flipped so PNG row 0
 * is the TOP — guns render upright). After the fixup every gun must point
 * LEFT in this sheet (spec: muzzle −Z → renders at screen-x minimum).
 *
 * Zero three.js: raw GLB parse, positions + indices read from the BIN chunk,
 * baked node matrix applied, software scanline rasterization (borrowed from
 * gen-buy-icons.ts), PNG out.
 *
 * Run: bun scripts/verify-guns-orientation.ts
 * Out : scripts/.tmp/guns-fixed/orientation-sheet.png  (grid, row-major,
 *       alphabetical order of ids — printed with the sheet)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const DIR = '/home/z/my-project/scripts/.tmp/guns-fixed'
const OUT = join(DIR, 'orientation-sheet.png')

// cell + grid geometry — LARGE cells for reliable VLM reading
const CW = 380, CH = 150
const COLS = 3
const GAP = 4
const SS = 2

// ---------------------------------------------------------------- PNG encode
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
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

// ---------------------------------------------------------------- scanline fill
function fillTri(cov: Uint8Array, sw: number, sh: number,
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
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
    const xs: number[] = []
    const edge = (px: number, py: number, qx: number, qy: number) => {
      if ((py <= yc && qy > yc) || (qy <= yc && py > yc)) xs.push(px + (yc - py) / (qy - py) * (qx - px))
    }
    edge(ax, ay, bx, by); edge(bx, by, cx, cy); edge(ax, ay, cx, cy)
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)
    const x0f = Math.max(0, Math.ceil(xs[0])), x1f = Math.min(sw - 1, Math.floor(xs[xs.length - 1]))
    for (let x = x0f; x <= x1f; x++) cov[y * sw + x] = 1
  }
}

// ---------------------------------------------------------------- GLB raw parse
function parseGLB(path: string) {
  const buf = readFileSync(path)
  let off = 12, json: any = null, bin: Buffer | null = null
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (type === 0x004e4942) bin = Buffer.from(data)
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  return { json, bin: bin! }
}
function applyV(m: number[], v: number[]): [number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ]
}

// ---------------------------------------------------------------- main
const ids = readdirSync(DIR).filter(f => f.endsWith('.glb')).map(f => f.replace(/\.glb$/, '')).sort()
const rows = Math.ceil(ids.length / COLS)
const SHEET_W = COLS * CW + (COLS + 1) * GAP
const SHEET_H = rows * CH + (rows + 1) * GAP
const sheet = new Uint8Array(SHEET_W * SHEET_H * 4)
for (let i = 0; i < SHEET_W * SHEET_H; i++) {
  sheet[i * 4] = 24; sheet[i * 4 + 1] = 26; sheet[i * 4 + 2] = 30; sheet[i * 4 + 3] = 255
}

const SW = CW * SS, SH = CH * SS

ids.forEach((id, idx) => {
  try {
    const { json: j, bin } = parseGLB(join(DIR, `${id}.glb`))
    const accs = j.accessors, views = j.bufferViews, meshes = j.meshes, nodes = j.nodes

    const tris: number[][] = []
    for (const n of nodes) {
      if (n.mesh === undefined) continue
      const M = n.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      for (const p of meshes[n.mesh].primitives ?? []) {
        const pa = p.attributes?.POSITION, ia = p.indices
        if (pa === undefined) continue
        const pos = accs[pa]
        const pv = views[pos.bufferView]
        const pBase = (pv?.byteOffset ?? 0) + (pos.byteOffset ?? 0)
        const pStride = pv?.byteStride ?? 12
        const pdv = new DataView(bin.buffer, bin.byteOffset + pBase, pos.count * pStride)
        const getP = (i: number): [number, number, number] =>
          applyV(M, [pdv.getFloat32(i * pStride, true), pdv.getFloat32(i * pStride + 4, true), pdv.getFloat32(i * pStride + 8, true)])
        const emit = (a: number, b: number, c: number) => {
          const p0 = getP(a), p1 = getP(b), p2 = getP(c)
          // upright side view: screen x = +z (muzzle -Z -> LEFT), y = -y (upright)
          tris.push([p0[2], -p0[1], p1[2], -p1[1], p2[2], -p2[1]])
        }
        if (ia !== undefined) {
          const ind = accs[ia]
          const iv = views[ind.bufferView]
          const isU16 = ind.componentType === 5123
          const iBase = (iv?.byteOffset ?? 0) + (ind.byteOffset ?? 0)
          const cnt = ind.count
          if (isU16) {
            const idv = new DataView(bin.buffer, bin.byteOffset + iBase, cnt * 2)
            for (let k = 0; k + 2 < cnt; k += 3) emit(idv.getUint16(k * 2, true), idv.getUint16(k * 2 + 2, true), idv.getUint16(k * 2 + 4, true))
          } else {
            const idv = new DataView(bin.buffer, bin.byteOffset + iBase, cnt * 4)
            for (let k = 0; k + 2 < cnt; k += 3) emit(idv.getUint32(k * 4, true), idv.getUint32(k * 4 + 4, true), idv.getUint32(k * 4 + 8, true))
          }
        } else {
          for (let i = 0; i + 2 < pos.count; i += 3) emit(i, i + 1, i + 2)
        }
      }
    }

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const x = t[k * 2], y = t[k * 2 + 1]
        if (x < xMin) xMin = x; if (x > xMax) xMax = x
        if (y < yMin) yMin = y; if (y > yMax) yMax = y
      }
    }
    const bw = Math.max(1e-6, xMax - xMin), bh = Math.max(1e-6, yMax - yMin)
    const scale = Math.min((CW - 24) / bw, (CH - 24) / bh)
    const ox = (CW - bw * scale) / 2 - xMin * scale
    const oy = (CH - bh * scale) / 2 - yMin * scale

    const cov = new Uint8Array(SW * SH)
    for (const t of tris) {
      fillTri(cov, SW, SH,
        t[0] * scale * SS + ox * SS, t[1] * scale * SS + oy * SS,
        t[2] * scale * SS + ox * SS, t[3] * scale * SS + oy * SS,
        t[4] * scale * SS + ox * SS, t[5] * scale * SS + oy * SS)
    }

    const col = idx % COLS, row = Math.floor(idx / COLS)
    const bx = GAP + col * (CW + GAP), by = GAP + row * (CH + GAP)
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        let a = 0
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) a += cov[(y * SS + sy) * SW + x * SS + sx]
        if (a === 0) continue
        const si = ((by + y) * SHEET_W + bx + x) * 4
        const f = a / (SS * SS)
        sheet[si] = Math.round(30 + 200 * f)
        sheet[si + 1] = Math.round(34 + 205 * f)
        sheet[si + 2] = Math.round(40 + 215 * f)
        sheet[si + 3] = 255
      }
    }
  } catch (e) {
    console.log(`FAILED ${id}: ${(e as Error).message}`)
  }
})

writeFileSync(OUT, encodePNG(SHEET_W, SHEET_H, sheet))
console.log(`sheet: ${OUT} (${SHEET_W}x${SHEET_H}, ${ids.length} cells, ${COLS} cols)`)
console.log(`order (row-major, alphabetical): ${ids.join(', ')}`)
