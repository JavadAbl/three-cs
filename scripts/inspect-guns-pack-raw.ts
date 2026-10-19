/**
 * inspect-guns-pack-raw.ts — zero-dependency GLB inventory.
 * Raw-parses the GLB container: header + JSON chunk (+ BIN chunk length only).
 * Reports: generator, extensions, nodes+hierarchy names, mesh/tri/vert counts,
 * materials, textures, animations, world bbox (accessor min/max * node matrices),
 * longest axis (orientation check), scale sanity.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? '/home/z/my-project/staging/ultimate-guns-pack';

function parseGLB(path: string): any {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  let binLen = 0;
  const binHeaderOff = 20 + jsonLen;
  if (buf.length >= binHeaderOff + 8) {
    const bl = buf.readUInt32LE(binHeaderOff);
    const bt = buf.readUInt32LE(binHeaderOff + 4);
    if (bt === 0x004e4942) binLen = bl; // "BIN"
  }
  return { json, totalSize: buf.length, binLen };
}

// column-major 4x4 math
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function nodeMatrix(n: any): number[] {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0];
  const s = n.scale ?? [1, 1, 1];
  const q = n.rotation ?? [0, 0, 0, 1]; // [x, y, z, w]
  const [qx, qy, qz, qw] = q;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  // column-major R (glTF: column vectors, M = T · R · S)
  const M = [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
  return M;
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const fmt = (v: number) =>
  (v === undefined || v === null || Number.isNaN(v) || !Number.isFinite(v)) ? '?' :
  (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

const files = readdirSync(DIR).filter(f => f.endsWith('.glb')).sort();
const rows: any[] = [];

for (const f of files) {
  const path = join(DIR, f);
  const sizeKB = statSync(path).size / 1024;
  const row: any = {
    file: f, sizeKB, generator: '', ext: [], nodes: 0, nodeNames: [], meshes: 0,
    tris: 0, verts: 0, prims: 0, mats: [], texCount: 0, anims: 0,
    bboxMin: [Infinity, Infinity, Infinity], bboxMax: [-Infinity, -Infinity, -Infinity],
    longAxis: '?', longLen: 0,
  };
  try {
    const { json, binLen } = parseGLB(path);
    const j = json;
    row.generator = j.asset?.generator ?? '';
    row.ext = j.extensionsUsed ?? [];

    const nodes: any[] = j.nodes ?? [];
    row.nodes = nodes.length;
    row.nodeNames = nodes.map((n: any) => n.name ?? '(unnamed)');

    // meshes
    const meshes: any[] = j.meshes ?? [];
    row.meshes = meshes.length;

    const accessors: any[] = j.accessors ?? [];

    const expand = (mat: number[], min: number[], max: number[]) => {
      for (let i = 0; i < 8; i++) {
        const c = [
          (i & 1) ? max[0] : min[0],
          (i & 2) ? max[1] : min[1],
          (i & 4) ? max[2] : min[2],
        ];
        const wx = mat[0] * c[0] + mat[4] * c[1] + mat[8] * c[2] + mat[12];
        const wy = mat[1] * c[0] + mat[5] * c[1] + mat[9] * c[2] + mat[13];
        const wz = mat[2] * c[0] + mat[6] * c[1] + mat[10] * c[2] + mat[14];
        row.bboxMin[0] = Math.min(row.bboxMin[0], wx); row.bboxMax[0] = Math.max(row.bboxMax[0], wx);
        row.bboxMin[1] = Math.min(row.bboxMin[1], wy); row.bboxMax[1] = Math.max(row.bboxMax[1], wy);
        row.bboxMin[2] = Math.min(row.bboxMin[2], wz); row.bboxMax[2] = Math.max(row.bboxMax[2], wz);
      }
    };

    const sceneNodes = (j.scenes?.[0]?.nodes) ?? [];
    const visit = (ni: number, parentMat: number[]) => {
      const n = nodes[ni];
      if (!n) return;
      const m = mul(parentMat, nodeMatrix(n));
      if (n.mesh !== undefined) {
        const mesh = meshes[n.mesh];
        for (const p of mesh.primitives ?? []) {
          row.prims++;
          const posAcc = p.attributes?.POSITION !== undefined ? accessors[p.attributes.POSITION] : null;
          if (posAcc) {
            if (posAcc.min && posAcc.max) expand(m, posAcc.min, posAcc.max);
            row.verts += posAcc.count ?? 0;
          }
          if (p.indices !== undefined) row.tris += (accessors[p.indices].count ?? 0) / 3;
          else if (posAcc) row.tris += (posAcc.count ?? 0) / 3;
        }
      }
      for (const c of n.children ?? []) visit(c, m);
    };
    for (const sn of sceneNodes) visit(sn, IDENT);

    row.mats = (j.materials ?? []).map((m: any) => m.name ?? '(unnamed)');
    row.texCount = (j.textures ?? []).length;
    row.anims = (j.animations ?? []).length;
    row.hasSkin = (j.skins ?? []).length > 0;
    row.binLen = binLen;

    const lens = [row.bboxMax[0] - row.bboxMin[0], row.bboxMax[1] - row.bboxMin[1], row.bboxMax[2] - row.bboxMin[2]];
    const ai = lens.indexOf(Math.max(...lens));
    row.longAxis = ['X', 'Y', 'Z'][ai];
    row.longLen = lens[ai];
  } catch (e) {
    row.error = (e as Error).message;
  }
  rows.push(row);
}

console.log('# Ultimate Guns Pack — raw GLB inventory\n');
for (const r of rows) {
  console.log(`## ${r.file}${r.error ? '  !! ERROR: ' + r.error : ''}`);
  console.log(`   size=${r.sizeKB.toFixed(1)}KB (bin=${(r.binLen / 1024).toFixed(1)}KB) gen="${r.generator}" ext=[${r.ext.join(',') || '-'}]`);
  console.log(`   nodes=${r.nodes} [${r.nodeNames.join(' | ')}]`);
  console.log(`   meshes=${r.meshes} prims=${r.prims} tris=${r.tris} verts=${r.verts} tex=${r.texCount} anims=${r.anims}${r.hasSkin ? ' SKINNED' : ''}`);
  console.log(`   mats=[${r.mats.join(', ')}]`);
  console.log(`   bbox=[${fmt(r.bboxMin[0])}, ${fmt(r.bboxMin[1])}, ${fmt(r.bboxMin[2])}] .. [${fmt(r.bboxMax[0])}, ${fmt(r.bboxMax[1])}, ${fmt(r.bboxMax[2])}] longest=${r.longAxis}(${fmt(r.longLen)})`);
  console.log('');
}

const ok = rows.filter(r => !r.error);
const totTris = ok.reduce((a, r) => a + r.tris, 0);
const totKB = ok.reduce((a, r) => a + r.sizeKB, 0);
console.log('# SUMMARY');
console.log(`files=${ok.length}/${rows.length} parsed OK, totalSize=${totKB.toFixed(0)}KB, totalTris=${totTris}`);
console.log(`withAnims=${ok.filter(r => r.anims > 0).length} withTextures=${ok.filter(r => r.texCount > 0).length} withSkins=${ok.filter(r => r.hasSkin).length}`);
const multiMesh = ok.filter(r => r.meshes > 1);
console.log(`multiMesh files=${multiMesh.length}${multiMesh.length ? ': ' + multiMesh.map(r => `${r.file}(${r.meshes})`).join(', ') : ''}`);
const axes = ok.map(r => r.longAxis);
console.log(`longestAxis: X=${axes.filter(a => a === 'X').length} Y=${axes.filter(a => a === 'Y').length} Z=${axes.filter(a => a === 'Z').length}`);
const tris = ok.map(r => r.tris).sort((a, b) => a - b);
console.log(`tris: min=${tris[0]} median=${tris[Math.floor(tris.length / 2)]} max=${tris[tris.length - 1]}`);
const gens = [...new Set(ok.map(r => r.generator))];
console.log(`generators: ${gens.join(' | ')}`);
