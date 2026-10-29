// Task 115 — rebel node tree (with matrices!) + pose census.
// Lesson from Task 112 gotcha #1: raw accessor bounds are meaningless without
// node matrices — the Sketchfab_model wrapper usually carries rotX(-90).
import fs from 'node:fs'

function parseGLB(path) {
  const b = fs.readFileSync(path)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path)
  const jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString())
  let off = 20 + jsonLen
  if (off % 4) off += 4 - (off % 4)
  const binLen = b.readUInt32LE(off)
  const binStart = off + 8
  return { json, bin: b.slice(binStart, binStart + binLen), fileSize: b.length }
}

const p = parseGLB('upload/leather_rebel.glb')
const j = p.json

console.log('--- node tree (name, matrix/TRS, mesh) ---')
function dumpNode(i, depth) {
  const n = j.nodes[i]
  const pad = '  '.repeat(depth)
  let trs = ''
  if (n.matrix) trs = `matrix=[${n.matrix.map(v => v.toFixed(3)).join(', ')}]`
  else trs = `t=${(n.translation ?? [0, 0, 0]).map(v => v.toFixed(3)).join(',')} r=${JSON.stringify(n.rotation ?? [0, 0, 0, 1])} s=${(n.scale ?? [1, 1, 1]).join(',')}`
  console.log(`${pad}[${i}] "${n.name ?? ''}" ${trs}${n.mesh !== undefined ? ` MESH=${n.mesh}` : ''}${n.skin !== undefined ? ` SKIN=${n.skin}` : ''}`)
  for (const c of n.children ?? []) dumpNode(c, depth + 1)
}
for (const r of j.scenes[0].nodes) dumpNode(r, 0)

// ---- vertex census in the mesh-local frame, then in the world frame after applying node matrices
// gather node world matrices (column-major glTF -> three-style)
function matFromNode(n) {
  const m = n.matrix
    ? [
        [n.matrix[0], n.matrix[4], n.matrix[8], n.matrix[12]],
        [n.matrix[1], n.matrix[5], n.matrix[9], n.matrix[13]],
        [n.matrix[2], n.matrix[6], n.matrix[10], n.matrix[14]],
      ]
    : null
  return m
}
// compute world matrix per node (only TRS/identity needed here; multiply down)
function worldMat(i, parent) {
  const n = j.nodes[i]
  let local
  if (n.matrix) {
    const m = n.matrix
    local = m // column-major, treat as rows-of-columns below
  } else {
    // compose TRS crudely — translation only matters for census; rotation via quaternion -> matrix
    const [tx, ty, tz] = n.translation ?? [0, 0, 0]
    const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1]
    const [sx, sy, sz] = n.scale ?? [1, 1, 1]
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
    const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2
    const wx = qw * x2, wy = qw * y2, wz = qw * z2
    local = [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      tx, ty, tz, 1,
    ]
  }
  if (!parent) return local
  // parent * local (both column-major arrays of 16)
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += parent[k * 4 + r] * local[c * 4 + k]
    out[c * 4 + r] = s
  }
  return out
}
const nodeWorld = {}
function walk(i, parent) {
  nodeWorld[i] = worldMat(i, parent)
  for (const c of j.nodes[i].children ?? []) walk(c, nodeWorld[i])
}
for (const r of j.scenes[0].nodes) walk(r, null)

// ---- read POSITION accessors, apply world matrix, census
const compN = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
function readAccessor(accIdx) {
  const a = j.accessors[accIdx]
  const bv = j.bufferViews[a.bufferView]
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const n = a.count * compN[a.type]
  const t = a.componentType
  let arr
  if (t === 5126) arr = new Float32Array(p.bin.buffer, p.bin.byteOffset + off, n)
  else if (t === 5123) arr = new Uint16Array(p.bin.buffer, p.bin.byteOffset + off, n)
  else if (t === 5125) arr = new Uint32Array(p.bin.buffer, p.bin.byteOffset + off, n)
  else if (t === 5122) arr = new Int16Array(p.bin.buffer, p.bin.byteOffset + off, n)
  else throw new Error('comp type ' + t)
  return { a, arr }
}

let all = [] // world-space vertices
for (const [ni, n] of j.nodes.entries()) {
  if (n.mesh === undefined) continue
  const W = nodeWorld[ni]
  for (const prim of j.meshes[n.mesh].primitives) {
    const { arr } = readAccessor(prim.attributes.POSITION)
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2]
      all.push([
        W[0] * x + W[4] * y + W[8] * z + W[12],
        W[1] * x + W[5] * y + W[9] * z + W[13],
        W[2] * x + W[6] * y + W[10] * z + W[14],
      ])
    }
  }
}
console.log(`\nworld verts: ${all.length}`)

const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
for (const v of all) for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k] }
console.log('world bbox min:', min.map(v => v.toFixed(3)).join(', '))
console.log('world bbox max:', max.map(v => v.toFixed(3)).join(', '))
console.log('world size:', (max[0] - min[0]).toFixed(3), (max[1] - min[1]).toFixed(3), (max[2] - min[2]).toFixed(3))

// height-normalize like the game does (scale to 1.79) — BUT note the game
// normalizes the BAKED scene; here just normalize the world bbox height.
const s = 1.79 / (max[1] - min[1])
const nx = v => (v[0] - (min[0] + max[0]) / 2) * s
const ny = v => (v[1] - min[1]) * s
const nz = v => (v[2] - (min[2] + max[2]) / 2) * s

// arm census: |x| distribution in y bands (like find-wide-verts-t113)
console.log('\n--- arm census (normalized: y from ground, |x| from center) ---')
const bands = [[0, 0.5], [0.5, 0.75], [0.75, 0.95], [0.95, 1.1], [1.1, 1.3], [1.3, 1.45], [1.45, 1.55], [1.55, 1.79]]
for (const [y0, y1] of bands) {
  let cnt = 0, maxX = 0, sumAbsX = 0
  for (const v of all) {
    const y = ny(v)
    if (y < y0 || y >= y1) continue
    cnt++
    const ax = Math.abs(nx(v))
    if (ax > maxX) maxX = ax
    sumAbsX += ax
  }
  if (cnt) console.log(`y ${y0.toFixed(2)}-${y1.toFixed(2)}: n=${cnt} max|x|=${maxX.toFixed(3)} avg|x|=${(sumAbsX / cnt).toFixed(3)}`)
}

// where are the EXTREME |x| verts (hands?) — top 5 by |x| with y
console.log('\n--- widest verts (top 8 by |x|) ---')
const wide = [...all].sort((a, b) => Math.abs(nx(b)) - Math.abs(nx(a))).slice(0, 8)
for (const v of wide) console.log(`x=${nx(v).toFixed(3)} y=${ny(v).toFixed(3)} z=${nz(v).toFixed(3)}`)

// foot/head check: min-y verts z-spread (facing direction clue)
console.log('\n--- z-extremes ---')
const byZ = [...all].sort((a, b) => nz(a) - nz(b))
console.log('most -z (front?):', byZ.slice(0, 3).map(v => `(${nx(v).toFixed(2)}, ${ny(v).toFixed(2)}, ${nz(v).toFixed(2)})`).join(' '))
console.log('most +z (back?):', byZ.slice(-3).map(v => `(${nx(v).toFixed(2)}, ${ny(v).toFixed(2)}, ${nz(v).toFixed(2)})`).join(' '))
