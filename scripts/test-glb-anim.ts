// Reproduce the GLB animation binding issue under bun:
// strip textures from Soldier.glb, parse with GLTFLoader, clone, run mixer, check bones.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import fs from 'node:fs'
import '../scripts/domstub.js'

const SRC = 'public/assets/models/Soldier.glb'

// --- strip texture references so parse completes without image decoding
const raw = fs.readFileSync(SRC)
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
const dv = new DataView(ab)
const jsonLen = dv.getUint32(12, true)
const jsonBytes = new Uint8Array(ab, 20, jsonLen)
const js = JSON.parse(new TextDecoder().decode(jsonBytes))

// remove all images/textures/samplers; point materials at nothing
delete js.images
delete js.textures
delete js.samplers
for (const m of js.materials ?? []) {
  delete m.normalTexture
  delete m.occlusionTexture
  delete m.emissiveTexture
  delete m.baseColorTexture
  delete m.metallicRoughnessTexture
  if (m.pbrMetallicRoughness) {
    delete m.pbrMetallicRoughness.baseColorTexture
    delete m.pbrMetallicRoughness.metallicRoughnessTexture
  }
}
const jsonMod = JSON.stringify(js)

// rebuild GLB: header + json chunk + original binary chunk
const binLen = dv.getUint32(20 + jsonLen, true) // after json chunk header (len+type)
const binChunkHeader = new Uint8Array(ab, 20 + jsonLen, 8)
const binChunkData = new Uint8Array(ab, 28 + jsonLen, binLen)

const enc = new TextEncoder()
const jsonArr = enc.encode(jsonMod)
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
for (let i = 0; i < jsonPad; i++) outArr[20 + jsonArr.length + i] = 0x20 // GLB spec: space-padding for JSON
odv.setUint32(20 + jsonArr.length + jsonPad, binChunkData.length + binPad, true)
odv.setUint32(24 + jsonArr.length + jsonPad, 0x004E4942, true)
outArr.set(binChunkData, 28 + jsonArr.length + jsonPad)

console.log('stripped GLB built:', total, 'bytes; animations:', js.animations?.length)

// --- parse it
const loader = new GLTFLoader()
loader.parse(out, '', (gltf) => {
  console.log('PARSE OK — animations:', gltf.animations.map(a => a.name))
  const clip = gltf.animations.find(a => a.name.toLowerCase().includes('walk'))!
  console.log('\n--- WALK CLIP TRACKS (first 8) ---')
  for (const t of clip.tracks.slice(0, 8)) console.log('  track:', t.name)

  const proto = gltf.scene
  proto.updateMatrixWorld(true)

  // node names sanity
  const names: string[] = []
  proto.traverse(o => { if (o.name) names.push(o.name) })
  console.log('\n--- first node names:', names.slice(0, 6).join(' | '))

  // try binding: does a track name match a node name?
  const trackName = clip.tracks[0].name.split('.')[0]
  const found = proto.getObjectByName(trackName)
  console.log('track root name:', trackName, '→ node found?', !!found)

  // clone + mixer
  const model = skeletonClone(proto)
  model.updateMatrixWorld(true)
  const mixer = new THREE.AnimationMixer(model)
  const action = mixer.clipAction(clip)
  action.play()
  const hips = model.getObjectByName('mixamorigHips')
  const thigh = model.getObjectByName('mixamorigRightUpLeg')
  const r0 = thigh ? [thigh.rotation.x, thigh.rotation.y, thigh.rotation.z] : null
  mixer.update(0.001) // trigger binding
  mixer.update(0.5)
  const r1 = thigh ? [thigh.rotation.x, thigh.rotation.y, thigh.rotation.z] : null
  console.log('\nthigh rot before:', r0)
  console.log('thigh rot after 0.5s of Walk:', r1)
  console.log('hips pos:', hips ? [hips.position.x, hips.position.y, hips.position.z] : null)
  const moved = r0 && r1 && (Math.abs(r0[0] - r1[0]) > 0.01 || Math.abs(r0[1] - r1[1]) > 0.01)
  console.log(moved ? 'ANIMATION WORKS ✓' : 'ANIMATION DEAD ✗ (T-pose bug reproduced)')
  process.exit(moved ? 0 : 1)
}, (err) => {
  console.error('PARSE FAILED:', err)
  process.exit(2)
})
