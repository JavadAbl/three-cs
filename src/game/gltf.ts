// ============================================================
// gltf.ts — shared GLB loading plumbing.
//
// Every in-game GLB (human.glb today, weapon models per
// WEAPONS_PLAN's GLB decision, bomb, future props) parses through
// sharedGLTFLoader(): one memoized GLTFLoader with the Draco
// decoder attached.
//
// Draco (KHR_draco_mesh_compression): geometry-only compression,
// ~20x smaller meshes. Textures are untouched by it — re-encode
// textures to WebP at authoring time instead (scripts/compress-glb.sh
// does both). The decoder is SELF-HOSTED from /draco/gltf/ (three.js
// MIT-licensed files, committed — no CDN, game stays self-contained):
//   draco_decoder.wasm       192KB — fetched once per page session,
//                                  only when a Draco GLB is parsed
//   draco_wasm_wrapper.js     58KB — JS↔wasm bridge
//   draco_decoder.js         512KB — asm.js fallback (no-wasm browsers)
// Uncompressed GLBs never fetch the decoder at all. Decode is
// one-time per file at lobby preload; a budget-sized viewmodel
// (~15k tris) decodes in a few ms — never mid-round.
//
// Node names survive Draco (it compresses mesh data, not the node
// graph), which is why the engine's named-part animations
// (mag/slide/bolt/pump) keep working on compressed files.
// ============================================================
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

let cached: GLTFLoader | null = null

/** Memoized GLTFLoader with the self-hosted Draco decoder attached.
 *  Safe to call from any module; the instance (and the lazily-fetched
 *  wasm decoder) is shared by the whole page session. */
export function sharedGLTFLoader(): GLTFLoader {
  if (!cached) {
    cached = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/gltf/')
    cached.setDRACOLoader(draco)
  }
  return cached
}
