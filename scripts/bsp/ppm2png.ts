// PPM (P6) → PNG converter, pure Node/bun, no deps
import { readFileSync, writeFileSync } from 'fs'
import zlib from 'zlib'

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

export function ppm2png(src: string, dst: string) {
  const raw = readFileSync(src)
  const idx = raw.indexOf(Buffer.from('255\n')) + 4
  const hdr = raw.toString('latin1', 0, idx).trim().split(/\s+/)
  const W = +hdr[1], H = +hdr[2]
  const px = raw.subarray(idx)
  const rows: Buffer[] = []
  for (let j = 0; j < H; j++) {
    rows.push(Buffer.from([0])) // filter type 0
    rows.push(px.subarray(j * W * 3, (j + 1) * W * 3))
  }
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 6 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(dst, png)
  console.log(dst, `${W}x${H}`)
}

if (process.argv[2]) {
  ppm2png(process.argv[2], process.argv[3] ?? process.argv[2].replace('.ppm', '.png'))
}
