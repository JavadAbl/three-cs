// Contact sheet for VLM orientation check: gun icons pasted on a dark HUD-like
// background, 2 per row. Order is documented in the VLM prompt, not baked into
// the image (no text rasterizer needed).
import { readFileSync, writeFileSync } from 'fs'
import { inflateSync, deflateSync } from 'node:zlib'

function decodePNG(path: string): { w: number; h: number; rgba: Uint8Array } {
  const buf = readFileSync(path)
  let w = 0, h = 0, idat: Buffer[] = []
  let off = 8
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const rgba = new Uint8Array(w * h * 4)
  const stride = w * 4 + 1
  for (let y = 0; y < h; y++) Buffer.from(raw.buffer, raw.byteOffset + y * stride + 1, w * 4).copy(rgba, y * w * 4)
  return { w, h, rgba }
}

// tiny PNG encoder (same as gen-buy-icons.ts — filter 0, 8-bit RGBA)
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
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii')
  out.set(data, 8); out.writeUInt32BE(crc32(new Uint8Array(out.subarray(4, 8 + data.length))), 8 + data.length)
  return out
}
function encodePNG(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0)),
  ])
}

const ids = ['ak47', 'deagle', 'awp', 'negev', 'm4', 'mp9']
const COLS = 2, IW = 240, IH = 96, GAP = 16
const W = COLS * IW + (COLS + 1) * GAP
const H = Math.ceil(ids.length / COLS) * (IH + GAP) + GAP
const sheet = new Uint8Array(W * H * 4)
for (let i = 0; i < W * H; i++) { // dark HUD row background
  sheet[i * 4] = 0x18; sheet[i * 4 + 1] = 0x1b; sheet[i * 4 + 2] = 0x20; sheet[i * 4 + 3] = 0xff
}
ids.forEach((id, i) => {
  const img = decodePNG(`public/staging/icons/${id}.png`)
  const cx = GAP + (i % COLS) * (IW + GAP)
  const cy = GAP + Math.floor(i / COLS) * (IH + GAP)
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
    const s = (y * IW + x) * 4, d = ((cy + y) * W + cx + x) * 4
    const a = img.rgba[s + 3] / 255
    sheet[d] = Math.round(img.rgba[s] * a + sheet[d] * (1 - a))
    sheet[d + 1] = Math.round(img.rgba[s + 1] * a + sheet[d + 1] * (1 - a))
    sheet[d + 2] = Math.round(img.rgba[s + 2] * a + sheet[d + 2] * (1 - a))
    sheet[d + 3] = 255
  }
})
writeFileSync('/home/z/my-project/icon-sheet.png', encodePNG(W, H, sheet))
console.log(`sheet: ${W}x${H}, order L->R, T->B: ${ids.join(', ')}`)
