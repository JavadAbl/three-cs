// Dump geom.json render triangles + map collision boxes around the ramps (game coords)
// West ramp: bsp x -1280..-992, y 192..320 → game x -32..-24.8, z -8..-4.8
// East ramp: bsp x 992..1280, y 192..320 → game x 24.8..32, z -8..-4.8
import { readFileSync } from 'fs'

const geom = JSON.parse(readFileSync('/home/z/my-project/public/assets/maps/aimhead/geom.json', 'utf8'))
const mapSrc = readFileSync('/home/z/my-project/mini-services/game-server/map-aimhead.ts', 'utf8')

// parse boxes from the generated TS (boxes: [{x,y,z,w,h,d,tex},...])
const boxMatch = mapSrc.match(/boxes: (\[.*?\]),\n/s)!
const boxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; tex: string }> = JSON.parse(boxMatch[1])

const areas = [
  { name: 'WEST-RAMP', x0: -33, x1: -24, z0: -8.6, z1: -4.2 },
  { name: 'EAST-RAMP', x0: 24, x1: 33, z0: -8.6, z1: -4.2 },
]

// triangle list from groups
const tris: Array<{ tex: string; p: number[][] }> = []
for (const g of geom.groups) {
  for (let i = 0; i < g.idx.length; i += 3) {
    const a = g.idx[i], b = g.idx[i + 1], c = g.idx[i + 2]
    tris.push({
      tex: g.tex,
      p: [a, b, c].map(v => [g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]]),
    })
  }
}

for (const ar of areas) {
  console.log(`\n===== ${ar.name} (x ${ar.x0}..${ar.x1}, z ${ar.z0}..${ar.z1}) =====`)
  console.log(`render tris in area: ${tris.filter(t => t.p.some(v => v[0] >= ar.x0 && v[0] <= ar.x1 && v[2] >= ar.z0 && v[2] <= ar.z1)).length}`)
  // vertical surfaces (side walls): triangle with all 3 verts xz-near a boundary line
  const inArea = tris.filter(t => t.p.some(v => v[0] >= ar.x0 && v[0] <= ar.x1 && v[2] >= ar.z0 && v[2] <= ar.z1))
  // classify: horizontal-ish (norm y>0.7), vertical (norm y<0.3), slope
  const vert = inArea.filter(t => {
    const [a, b, c] = t.p
    const nx = (b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1])
    const ny = (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])
    const l = Math.hypot(nx, ny)
    return l > 0 && Math.abs(ny) / l < 0.3 // vertical
  })
  console.log(`vertical (side-wall) tris: ${vert.length}`)
  for (const t of vert.slice(0, 40)) {
    const zs = t.p.map(v => v[2]), ys = t.p.map(v => v[1]), xs = t.p.map(v => v[0])
    console.log(`  ${t.tex} z ${Math.min(...zs).toFixed(2)}..${Math.max(...zs).toFixed(2)} x ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)} y ${Math.min(...ys).toFixed(2)}..${Math.max(...ys).toFixed(2)}`)
  }

  // collision boxes near the ramp incl. approach corridor (extend x outward from ramp bottom)
  const near = boxes.filter(b => {
    const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2
    const bz0 = b.z - b.d / 2, bz1 = b.z + b.d / 2
    return bx1 >= ar.x0 - 2 && bx0 <= ar.x1 + 2 && bz1 >= ar.z0 - 0.5 && bz0 <= ar.z1 + 0.5
  })
  console.log(`collision boxes in area(+2m x): ${near.length}`)
  for (const b of near) {
    const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2
    const by0 = b.y - b.h / 2, by1 = b.y + b.h / 2
    const bz0 = b.z - b.d / 2, bz1 = b.z + b.d / 2
    console.log(`  ${b.tex} x ${bx0.toFixed(1)}..${bx1.toFixed(1)} z ${bz0.toFixed(1)}..${bz1.toFixed(1)} y ${by0.toFixed(2)}..${by1.toFixed(2)}`)
  }
}
