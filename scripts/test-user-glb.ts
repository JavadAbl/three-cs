// Parse the user's uploaded glb.glb headless (bun) with GLTFLoader —
// reproduce the browser's "Maximum call stack size exceeded" with a stack trace.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import fs from 'node:fs'
import '../scripts/domstub.js'

// staged (pending) copy wins, else the accepted copy — mirrors the api route
const SRC = process.argv[2]
  ?? (fs.existsSync('public/staging/models/human.glb')
      ? 'public/staging/models/human.glb'
      : 'public/assets/models/human.glb')

const raw = fs.readFileSync(SRC)
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
const dv = new DataView(ab)
const jsonLen = dv.getUint32(12, true)
const jsonBytes = new Uint8Array(ab, 20, jsonLen)
const js = JSON.parse(new TextDecoder().decode(jsonBytes))
console.log('nodes:', js.nodes.length, 'meshes:', js.meshes.length, 'anims:', (js.animations ?? []).length)

// strip textures so no image decode needed
delete js.images
delete js.textures
delete js.samplers
for (const m of js.materials ?? []) {
  delete m.normalTexture
  delete m.occlusionTexture
  delete m.emissiveTexture
  if (m.pbrMetallicRoughness) {
    delete m.pbrMetallicRoughness.baseColorTexture
    delete m.pbrMetallicRoughness.metallicRoughnessTexture
  }
}

const binLen = dv.getUint32(20 + jsonLen, true)
const binChunkData = new Uint8Array(ab, 28 + jsonLen, binLen)
const enc = new TextEncoder()
const jsonArr = enc.encode(JSON.stringify(js))
const jsonPad = (4 - (jsonArr.length % 4)) % 4
const binPad = (4 - (binChunkData.length % 4)) % 4
const total = 12 + 8 + jsonArr.length + jsonPad + 8 + binChunkData.length + binPad
const out = new ArrayBuffer(total)
const odv = new DataView(out)
const outArr = new Uint8Array(out)
odv.setUint32(0, 0x46546C67, true)
odv.setUint32(4, 2, true)
odv.setUint32(8, total, true)
odv.setUint32(12, jsonArr.length + jsonPad, true)
odv.setUint32(16, 0x4E4F534A, true)
outArr.set(jsonArr, 20)
odv.setUint32(20 + jsonArr.length + jsonPad, binChunkData.length + binPad, true)
odv.setUint32(24 + jsonArr.length + jsonPad, 0x004E4942, true)
outArr.set(binChunkData, 28 + jsonArr.length + jsonPad)
console.log('stripped GLB built:', total, 'bytes')

const loader = new GLTFLoader()
loader.parse(out, '', (gltf) => {
  console.log('PARSE OK')
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const size = box.getSize(new THREE.Vector3())
  console.log('bbox size (local units):', size.toArray().map((v: number) => v.toFixed(3)))
  const names: string[] = []
  gltf.scene.traverse((o: any) => { names.push(o.name + (o.isMesh ? '[mesh]' : '')) })
  console.log('objects:', names.join(', '))
  let tris = 0
  gltf.scene.traverse((o: any) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 })
  console.log('total tris:', Math.round(tris))
  process.exit(0)
}, (err: any) => {
  console.error('PARSE FAILED:', err?.message ?? err)
  console.error(err?.stack ?? 'no stack')
  process.exit(2)
})
