// scripts/island/props.ts — procedural model builders for the island map.
// Every builder appends triangle soup into per-family Groups (same schema as
// geom.json: tex/pos/norm/uv/color/idx). Vertex colors carry the baked
// sun+terrain-shadow light (propLight), mirroring the office pipeline.
// Collision/LOS boxes are returned separately — geometry renders +
// client-raycasts; boxes serve the headless server (LOS, nades, bot cover).
import { mulberry32, propLight } from './light'
import type { Group, Groups, LightFn, PropOut } from './types'

export type { PropOut } from './types'   // gen.ts consumes it through this module

export function groupOf(g: Groups, tex: string): Group {
  let g0 = g.get(tex)
  if (!g0) { g0 = { tex, pos: [], norm: [], uv: [], color: [], idx: [] }; g.set(tex, g0) }
  return g0
}

/** push one triangle (a,b,c = [x,y,z]) with per-corner uv and baked light */
export function tri(g: Group, sun: LightFn, a: number[], b: number[], c: number[], uva: number[], uvb: number[], uvc: number[]) {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2]
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2]
  let nx = e1y * e2z - e1z * e2y
  let ny = e1z * e2x - e1x * e2z
  let nz = e1x * e2y - e1y * e2x
  const len = Math.hypot(nx, ny, nz) || 1
  nx /= len; ny /= len; nz /= len
  const base = g.pos.length / 3
  const corners: [number[], number[]][] = [[a, uva], [b, uvb], [c, uvc]]
  for (const [p, uv] of corners) {
    g.pos.push(p[0], p[1], p[2])
    g.norm.push(nx, ny, nz)
    g.uv.push(uv[0], uv[1])
    const l = sun(p, [nx, ny, nz])
    g.color.push(l, l, l)
  }
  g.idx.push(base, base + 1, base + 2)
}

/** push a quad as two tris (a,b,c,d — consistent winding) */
export function quad(
  g: Group, sun: LightFn,
  a: number[], b: number[], c: number[], d: number[],
  uva: number[], uvb: number[], uvc: number[], uvd: number[],
) {
  tri(g, sun, a, b, c, uva, uvb, uvc)
  tri(g, sun, a, c, d, uva, uvc, uvd)
}

/** axis-aligned textured box (5 faces, +bottom when all=true) */
export function boxGeom(g: Group, sun: LightFn, x: number, y: number, z: number, w: number, h: number, d: number, bottom: boolean) {
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2, z0 = z - d / 2, z1 = z + d / 2
  const faces: number[][][] = [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
  ]
  if (bottom) faces.push([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]])
  for (const f of faces) {
    quad(g, sun, f[0], f[1], f[2], f[3],
      [0, 0], [w / 2, 0], [w / 2, d / 2], [0, d / 2])
  }
}

// ================================================================ palm
/** Coconut palm: leaning 9-segment ring trunk (joint bulges sell the bark)
 *  + a crown of 11-13 arcing fronds (15 blade quads each, drooping curve,
 *  tapering width — reads as pinnate leaves with zero alpha textures) +
 *  4-6 coconut spheres tucked under the crown. Collision: slim trunk box. */
export function palm(g: Groups, out: PropOut, x: number, z: number, groundY: number, rnd: () => number) {
  const h0 = 5.5 + rnd() * 3.5
  const lean = 0.9 + rnd() * 1.4            // horizontal drift at the crown
  const dirA = rnd() * Math.PI * 2
  const segs = 8
  const bark = groupOf(g, 'bark')
  const leaf = groupOf(g, 'leaf')
  const anchor = [x, groundY, z]
  const sun: LightFn = (p, n) => propLight(p, n, anchor) * (p[1] > groundY + h0 * 0.7 ? 1.04 : 1)

  const ring = (t: number): number[] => {
    const e = t * t                             // ease-out bend
    return [x + lean * e * Math.cos(dirA), groundY + h0 * t, z + lean * e * Math.sin(dirA)]
  }
  const rad = (t: number) => (0.27 - 0.115 * t) * (1 + 0.15 * Math.sin(t * segs * Math.PI * 2))
  const S = 7
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs, t1 = (s + 1) / segs
    const c0 = ring(t0), c1 = ring(t1)
    const r0 = rad(t0), r1 = rad(t1)
    for (let i = 0; i < S; i++) {
      const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2
      const P = (c: number[], a: number, r: number) => [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]
      const v0 = t0 * h0 * 0.42, v1 = t1 * h0 * 0.42
      quad(bark, sun,
        P(c0, a0, r0), P(c0, a1, r0), P(c1, a1, r1), P(c1, a0, r1),
        [i / S * 2, v0], [(i + 1) / S * 2, v0], [(i + 1) / S * 2, v1], [i / S * 2, v1])
    }
  }
  const top = ring(1)

  // fronds — DoubleSide material + three's backface normal flip shade the
  // undersides for free (the old duplicated-flipped copies doubled the tris)
  const blades = 11 + Math.floor(rnd() * 3)
  for (let bI = 0; bI < blades; bI++) {
    const ba = (bI / blades) * Math.PI * 2 + rnd() * 0.25
    const len = 2.3 + rnd() * 1.4
    const seg = 11
    const pt = (t: number): number[] => {
      const along = t * len
      const lift = Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.92) * 1.05 - t * t * 1.45
      return [top[0] + Math.cos(ba) * along, top[1] + 0.30 + lift, top[2] + Math.sin(ba) * along]
    }
    const wdt = (t: number) => 0.15 * Math.sin(Math.min(1, t * 3.4) * Math.PI * 0.5) * (1 - t * 0.72)
    const sideV = (t: number, s: number): number[] => {
      const c = pt(t)
      const ox = Math.cos(ba + Math.PI / 2) * wdt(t) * s
      const oz = Math.sin(ba + Math.PI / 2) * wdt(t) * s
      return [c[0] + ox, c[1] - Math.abs(s) * 0.008, c[2] + oz]
    }
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg, t1 = (i + 1) / seg
      const uv = (t: number, s: number) => [t * 2.3, s * 0.5 + 0.5]
      quad(leaf, sun, sideV(t0, 1), sideV(t1, 1), sideV(t1, -1), sideV(t0, -1),
        uv(t0, 1), uv(t1, 1), uv(t1, -1), uv(t0, -1))
    }
  }

  // coconuts
  const nuts = 4 + Math.floor(rnd() * 3)
  for (let i = 0; i < nuts; i++) {
    const na = (i / nuts) * Math.PI * 2 + rnd() * 0.7
    const c = [top[0] + Math.cos(na) * 0.36, top[1] - 0.34, top[2] + Math.sin(na) * 0.36]
    nutSphere(bark, sun, c, 0.16)
  }

  // server collision: slim box along the trunk (cover + nade bounce)
  const ex = x + lean * 0.5 * Math.cos(dirA), ez = z + lean * 0.5 * Math.sin(dirA)
  out.boxes.push({ x: ex, y: groundY + h0 / 2, z: ez, w: 0.9, h: h0, d: 0.9 })
}

function nutSphere(g: Group, sun: LightFn, c: number[], r: number) {
  const rings = 3, S = 5
  const dark: LightFn = (p, n) => propLight(p, n) * 0.42
  for (let i = 0; i < rings; i++) {
    const t0 = (i / rings) * Math.PI, t1 = ((i + 1) / rings) * Math.PI
    for (let j = 0; j < S; j++) {
      const a0 = (j / S) * Math.PI * 2, a1 = ((j + 1) / S) * Math.PI * 2
      const P = (t: number, a: number) => [c[0] + Math.sin(t) * Math.cos(a) * r, c[1] + Math.cos(t) * r, c[2] + Math.sin(t) * Math.sin(a) * r]
      const A = P(t0, a0), B = P(t0, a1), C = P(t1, a1), D = P(t1, a0)
      const uv = (p: number[]) => [(p[0] - c[0]) / r, (p[2] - c[2]) / r]
      quad(g, dark, A, B, C, D, uv(A), uv(B), uv(C), uv(D))
    }
  }
}

// ================================================================ rock
/** Displaced icosphere boulder: octahedron subdivided twice, vertices pushed
 *  along normals by seeded noise, Y-squashed, base sunk into the ground. */
export function rock(g: Groups, out: PropOut, x: number, z: number, groundY: number, r: number, seed: number, collide: boolean) {
  const irock = groupOf(g, 'irock')
  const rnd = mulberry32(seed)
  const anchor = [x, groundY, z]
  const sun: LightFn = (p, n) => propLight(p, n, anchor)
  let verts: number[][] = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1, 0]]
  let faces: number[][] = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]]
  for (let sub = 0; sub < 2; sub++) {
    const nf: number[][] = []
    const vm = new Map<string, number>()
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      let i = vm.get(k)
      if (i === undefined) {
        verts.push([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2])
        i = verts.length - 1; vm.set(k, i)
      }
      return i
    }
    const nf2: number[][] = []
    for (const f of faces) {
      const a = f[0], b = f[1], c = f[2]
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
      nf2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = nf2; nf.length = 0
  }
  const disp = verts.map(v => {
    const n = Math.hypot(v[0], v[1], v[2]) || 1
    const k = 1 + (rnd() - 0.5) * 0.55
    return [v[0] / n * r * k, v[1] / n * r * k * 0.62, v[2] / n * r * k]
  })
  const rotY = rnd() * Math.PI * 2, cr = Math.cos(rotY), sr = Math.sin(rotY)
  const w = (i: number): number[] => {
    const p = disp[i]
    return [x + p[0] * cr - p[2] * sr, groundY + Math.max(-0.35, p[1] + r * 0.18), z + p[0] * sr + p[2] * cr]
  }
  for (const f of faces) {
    const a = w(f[0]), b = w(f[1]), c = w(f[2])
    const cu = (p: number[]) => [(p[0] - x) / r * 0.5, (p[2] - z) / r * 0.5]
    tri(irock, sun, a, b, c, cu(a), cu(b), cu(c))
  }
  if (collide) out.boxes.push({ x, y: groundY + r * 0.35, z, w: r * 1.5, h: r * 0.95, d: r * 1.5 })
}

// ================================================================ hut
/** Beach hut: plank floor + 4 walls (south has a door gap) + corner posts +
 *  4-slope thatch pyramid roof (rows of leaf quads with row overlap) +
 *  interior darkened so it doesn't glow at noon. */
export function hut(g: Groups, out: PropOut, x: number, z: number, groundY: number, w: number, d: number, seed: number) {
  const rnd = mulberry32(seed)
  const plank = groupOf(g, 'plank')
  const leaf = groupOf(g, 'leaf')
  const wallH = 2.55
  const anchor = [x, groundY, z]
  const sun: LightFn = (p, n) => propLight(p, n, anchor)
  const inSun: LightFn = (p, n) => propLight(p, n, anchor) * 0.5
  const y0 = groundY + 0.22

  // floor slab
  boxGeom(plank, sun, x, y0 - 0.09, z, w, 0.18, d, false)

  const t = 0.15
  // north / west / east walls (solid)
  boxGeom(plank, sun, x, y0 + wallH / 2, z + d / 2, w, wallH, t, false)
  boxGeom(plank, sun, x - w / 2, y0 + wallH / 2, z, t, wallH, d, false)
  boxGeom(plank, sun, x + w / 2, y0 + wallH / 2, z, t, wallH, d, false)
  // south wall with a door gap (offset east of center)
  const doorW = 1.15, dx = x + w * 0.20
  const sL0 = x - w / 2, sR0 = dx - doorW / 2
  const sL1 = dx + doorW / 2, sR1 = x + w / 2
  if (sR0 > sL0 + 0.1) boxGeom(plank, sun, (sL0 + sR0) / 2, y0 + wallH / 2, z - d / 2, sR0 - sL0, wallH, t, false)
  if (sR1 > sL1 + 0.1) boxGeom(plank, sun, (sL1 + sR1) / 2, y0 + wallH / 2, z - d / 2, sR1 - sL1, wallH, t, false)
  // lintel over the door
  boxGeom(plank, sun, dx, y0 + wallH - 0.25, z - d / 2, doorW + 0.2, 0.5, t, false)
  // interior floor patch (dark) so the inside doesn't look hollow-bright
  const ip = [[x - w / 2 + t, z - d / 2 + t], [x + w / 2 - t, z - d / 2 + t], [x + w / 2 - t, z + d / 2 - t], [x - w / 2 + t, z + d / 2 - t]]
  quad(plank, inSun, [ip[0][0], y0, ip[0][1]], [ip[1][0], y0, ip[1][1]], [ip[2][0], y0, ip[2][1]], [ip[3][0], y0, ip[3][1]],
    [0, 0], [w / 2, 0], [w / 2, d / 2], [0, d / 2])

  // corner posts (slightly taller than walls, support the roof)
  const postT = 0.22, postH = wallH + 0.75
  for (const [px, pz] of [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x - w / 2, z + d / 2], [x + w / 2, z + d / 2]]) {
    boxGeom(plank, sun, px, y0 + postH / 2, pz, postT, postH, postT, false)
  }

  // thatch roof: 4 slopes from the eaves to an apex, rows of leaf quads
  const ry = y0 + wallH + 0.42, rh = 1.85, ov = 0.5
  const apexY = ry + rh
  const eaves: number[][] = []
  const roofs: Array<{ cx: number; cz: number; ux: number; uz: number }> = []
  // each slope: from an eave edge (pushed out by overhang) to the apex line
  roofs.push({ cx: x, cz: z - d / 2 - ov, ux: 1, uz: 0 })
  roofs.push({ cx: x, cz: z + d / 2 + ov, ux: 1, uz: 0 })
  roofs.push({ cx: x - w / 2 - ov, cz: z, ux: 0, uz: 1 })
  roofs.push({ cx: x + w / 2 + ov, cz: z, ux: 0, uz: 1 })
  eaves.length; // unused
  for (const r of roofs) {
    const rows = 7
    const inward = r.uz === 0 ? (r.cz < z ? 1 : -1) : (r.cx < x ? 1 : -1)
    const halfSpan = r.ux === 1 ? (w / 2 + ov) : (d / 2 + ov)
    for (let ri = 0; ri < rows; ri++) {
      const f0 = ri / rows, f1 = (ri + 1) / rows
      const segs = 6
      for (let si = 0; si < segs; si++) {
        const u0 = (si / segs - 0.5) * 2 * halfSpan
        const u1 = ((si + 1) / segs - 0.5) * 2 * halfSpan
        const pt = (f: number, u: number): number[] => {
          const ex = r.cx + r.ux * u
          const ez = r.cz + r.uz * u
          const dist = (r.uz === 0) ? (z - r.cz) * inward : (x - r.cx) * inward   // horizontal run to apex
          const bx = r.uz === 0 ? ex : ex + (x - ex) * f
          const bz = r.ux === 0 ? ez : ez + (z - ez) * f
          const by = ry + (apexY - ry) * f
          void dist
          return [bx, by, bz]
        }
        const a = pt(f0, u0), b = pt(f0, u1), c = pt(f1, u1), dq = pt(f1, u0)
        quad(leaf, sun, a, b, c, dq,
          [u0 * 0.5, f0 * 3.2], [u1 * 0.5, f0 * 3.2], [u1 * 0.5, f1 * 3.2], [u0 * 0.5, f1 * 3.2])
      }
    }
  }

  // server collision: 4 wall boxes (door side split), enterable interior
  const wb = (bx: number, bz: number, bw: number, bd: number) => out.boxes.push({ x: bx, y: y0 + wallH / 2, z: bz, w: bw, h: wallH, d: bd })
  if (sR0 > sL0 + 0.1) wb((sL0 + sR0) / 2, z - d / 2, sR0 - sL0, t + 0.1)
  if (sR1 > sL1 + 0.1) wb((sL1 + sR1) / 2, z - d / 2, sR1 - sL1, t + 0.1)
  wb(x, z + d / 2, w, t + 0.1)
  wb(x - w / 2, z, t + 0.1, d)
  wb(x + w / 2, z, t + 0.1, d)
  // roof is not walkable-blocking — no roof box (players can't jump 3 m)
}

// ================================================================ pier
/** Wooden pier: twin post rails + plank deck with jittered boards, running
 *  out over the water. Deck box keeps players/nades on top. */
export function pier(g: Groups, out: PropOut, x: number, z: number, dirX: number, dirZ: number, len: number, deckY: number, seed: number) {
  const rnd = mulberry32(seed)
  const plank = groupOf(g, 'plank')
  const anchor = [x, deckY, z]
  const sun: LightFn = (p, n) => propLight(p, n, anchor)
  const w = 2.6
  const px = -dirZ, pz = dirX
  const post = (t: number, side: number) => {
    const cx = x + dirX * t + px * side * (w / 2 - 0.22)
    const cz = z + dirZ * t + pz * side * (w / 2 - 0.22)
    boxGeom(plank, sun, cx, deckY - 0.95, cz, 0.26, 1.9, 0.26, true)
    out.boxes.push({ x: cx, y: deckY - 0.95, z: cz, w: 0.3, h: 1.9, d: 0.3 })
  }
  for (let t = 0; t <= len + 0.01; t += 2.3) { post(t, -1); post(t, 1) }
  const n = Math.round(len / 0.34)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n * len
    const bw = len / n * 0.9
    const cx = x + dirX * t, cz = z + dirZ * t
    const y = deckY + (rnd() - 0.5) * 0.035
    const ex = dirX * bw / 2, ez = dirZ * bw / 2
    quad(plank, sun,
      [cx - ex - px * w / 2, y, cz - ez - pz * w / 2],
      [cx - ex + px * w / 2, y, cz - ez + pz * w / 2],
      [cx + ex + px * w / 2, y, cz + ez + pz * w / 2],
      [cx + ex - px * w / 2, y, cz + ez - pz * w / 2],
      [0, 0], [w / 2, 0], [w / 2, bw / 2], [0, bw / 2])
  }
  out.boxes.push({
    x: x + dirX * len / 2, y: deckY - 0.28, z: z + dirZ * len / 2,
    w: Math.abs(dirX) * len + Math.abs(px) * w, h: 0.55,
    d: Math.abs(dirZ) * len + Math.abs(pz) * w,
  })
}

// ================================================================ radar
/** Radar station: concrete foundation + lattice mast + parabolic dish
 *  (front bright, back dim), tilted toward the sea. The A-site centerpiece. */
export function radar(g: Groups, out: PropOut, x: number, z: number, groundY: number, seed: number) {
  const _ = mulberry32(seed); void _
  const conc = groupOf(g, 'concrete')
  const metal = groupOf(g, 'metal')
  const anchor = [x, groundY, z]
  const sun: LightFn = (p, n) => propLight(p, n, anchor)
  // foundation
  boxGeom(conc, sun, x, groundY + 0.25, z, 7.6, 0.5, 7.6, true)
  out.boxes.push({ x, y: groundY + 0.25, z, w: 7.6, h: 0.5, d: 7.6 })
  // generator shed beside the mast (enterable, concrete)
  const shw = 3.4, shd = 2.8, shh = 2.3, sx = x - 3.4, sz = z + 2.4
  boxGeom(conc, sun, sx, groundY + 1.15, sz, shw, shh, shd, false)
  // mast
  const mastH = 8.2
  for (const [mx, mz] of [[x - 0.9, z - 0.9], [x + 0.9, z - 0.9], [x - 0.9, z + 0.9], [x + 0.9, z + 0.9]]) {
    boxGeom(metal, sun, mx, groundY + mastH / 2, mz, 0.2, mastH, 0.2, true)
  }
  for (let t = 1; t < mastH; t += 1.7) {
    boxGeom(metal, sun, x, groundY + t, z, 2.05, 0.12, 0.24, false)
    boxGeom(metal, sun, x, groundY + t + 0.85, z, 0.24, 0.12, 2.05, false)
  }
  out.boxes.push({ x, y: groundY + mastH / 2, z, w: 2.1, h: mastH, d: 2.1 })
  // dish
  const cy = groundY + mastH + 0.3
  const tilt = Math.PI * 0.27
  const aim = Math.PI * 1.22          // toward the SW sea
  const R = 2.7
  const grid = 8
  const cp = (u: number, v: number): number[] => {
    const r = R * v, a = u * Math.PI * 2
    const lz = -0.085 * r * r
    const lx = Math.cos(a) * r, ly = Math.sin(a) * r
    const ry = ly * Math.cos(tilt) - lz * Math.sin(tilt)
    const rz = ly * Math.sin(tilt) + lz * Math.cos(tilt)
    const ca = Math.cos(aim), sa = Math.sin(aim)
    return [x + lx * ca - rz * sa, cy + ry, z + lx * sa + rz * ca]
  }
  const bright: LightFn = (p, n) => propLight(p, n, anchor) * 1.05
  const dim: LightFn = (p, n) => propLight(p, n, anchor) * 0.38
  const us = (p: number[]) => [(p[0] - x) / R, (p[2] - z) / R]
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const u0 = i / grid, u1 = (i + 1) / grid, v0 = j / grid, v1 = (j + 1) / grid
      const a = cp(u0, v0), b = cp(u1, v0), c = cp(u1, v1), dq = cp(u0, v1)
      quad(metal, bright, a, b, c, dq, us(a), us(b), us(c), us(dq))
      quad(metal, dim, a, dq, c, b, us(a), us(dq), us(c), us(b))
    }
  }
}

// ================================================================ rowboat
/** Beached rowboat: U hull from ring strips, two bench thwarts, hull darker
 *  inside. Decoration + a squat collision box. */
export function rowboat(g: Groups, out: PropOut, x: number, z: number, groundY: number, rotY: number, seed: number) {
  const rnd = mulberry32(seed); void rnd
  const plank = groupOf(g, 'plank')
  const anchor = [x, groundY, z]
  const sun: LightFn = (p, n) => propLight(p, n, anchor)
  const inner: LightFn = (p, n) => propLight(p, n, anchor) * 0.55
  const L = 3.5, W = 1.2, H = 0.66
  const cr = Math.cos(rotY), sr = Math.sin(rotY)
  const pt = (t: number, side: number, up: number): number[] => {
    const along = (t * 2 - 1)
    const taper = Math.cos(along * Math.PI * 0.42) ** 0.8   // 1 mid, ~0 at ends
    const halfW = W / 2 * Math.max(0.12, taper)
    const gunwale = H * (0.5 + 0.5 * taper)
    const y = up > 0 ? gunwale : gunwale - H * 0.55 * Math.max(0.15, taper)
    const lx = t * L - L / 2
    const lz = halfW * side
    return [x + lx * cr - lz * sr, groundY + 0.14 + y, z + lx * sr + lz * cr]
  }
  const rings = 10
  for (let i = 0; i < rings; i++) {
    const t0 = (i + 0.5) / rings, t1 = (i + 1.5) / rings
    if (t1 > 1.0 && i === rings - 1) break
    for (const side of [-1, 1]) {
      const a = pt(t0, side, 1), b = pt(t1, side, 1), c = pt(t1, side, 0), dq = pt(t0, side, 0)
      quad(plank, sun, a, b, c, dq,
        [t0 * 3, side > 0 ? 0 : 1], [t1 * 3, side > 0 ? 0 : 1], [t1 * 3, side > 0 ? 0.35 : 0.65], [t0 * 3, side > 0 ? 0.35 : 0.65])
    }
    if (t0 > 0.08 && t0 < 0.92) {
      const s0 = pt(t0, -1, 1), s1 = pt(t0 + 0.09, -1, 1), s2 = pt(t0 + 0.09, 1, 1), s3 = pt(t0, 1, 1)
      quad(plank, inner, s3, s2, s1, s0, [0, 0], [1, 0], [1, 1], [0, 1])   // thwart top
      // hull inner strip
      const i0 = pt(t0, -1, 0), i1 = pt(t0, 1, 0)
      const i2 = pt(t0 + 0.1, 1, 0), i3 = pt(t0 + 0.1, -1, 0)
      quad(plank, inner, i3, i2, i1, i0, [t0 * 3, 0.3], [t0 * 3 + 0.3, 0.3], [t0 * 3 + 0.3, 0.5], [t0 * 3, 0.5])
    }
  }
  out.boxes.push({ x, y: groundY + 0.42, z, w: L * 0.75, h: 0.72, d: W * 1.05 })
}
