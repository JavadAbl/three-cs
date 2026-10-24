// ============================================================
// nightsky.ts — Task 101: REAL 3D moon + star field for AIM DEPOT.
//
// The user supplied two GLB models (a textured lunar sphere and a
// 45k-quad "15k stars" cluster). They are converted at authoring time
// into engine-native assets (scripts/make-night-sky-assets-t101.mjs,
// provenance in public/assets/models/sky/sources.json):
//   moon.bin        raw geometry slices — unit sphere, 3223 verts
//   moon_diffuse.jpg  equirect lunar albedo (the glTF used the legacy
//                    KHR_materials_pbrSpecularGlossiness workflow that
//                    three r166+ no longer parses, hence extraction)
//   stars-night.bin  camera-facing point cloud, 22.5k stars in 7 size
//                    buckets (below-horizon half culled)
//   star-sprite.png  soft radial glow (additive: black = zero emission)
//
// Everything attaches as a CHILD of the sky mesh: the engine's sky
// switch (scene.remove(map.sky)) disposes of it with the sky, its
// camera-follow positioning applies for free, and the night drift
// (engine slows it 10x for aimdepot) wheels the whole firmament.
//
// Draw-order contract: sky sphere renders first (renderOrder -10, no
// depth write) -> moon renders at -9 IN THE OPAQUE PASS (it WRITES
// depth, so transparent-pass stars behind the disc get occluded,
// while world geometry drawn later overwrites the moon where walls
// stand) -> glow sprite + star Points draw in the transparent pass,
// depth-tested against moon + world (stars never shine through walls,
// never through the moon face).
// ============================================================
import * as THREE from 'three'

const DIR = '/assets/models/sky/'

// Moon placement — the Task-100 painted-moon direction (equirect u=0.78,
// v=0.37 on the sky texture = this local-frame vector). Two live lessons
// are baked into these numbers: elevation ~24 deg clears the 6 m perimeter
// walls yet stays inside a 75-deg-FOV frame at pitch 0 (54 deg was invisible
// at eye level), and a 24-u disc at 300 u reads ~4.6 deg wide (~78 px at
// 720p) — the tuned "real moon" size, not a comedy 10-deg disc.
const MOON_DIR = new THREE.Vector3(-0.172, 0.397, -0.902).normalize()
const MOON_DIST = 300        // inside the 350-r sky sphere, which follows the camera
const MOON_RADIUS = 12       // unit-sphere model scale
const MOON_GLOW = 170        // soft additive bloom diameter (Task-100 halo equivalent)

// moon.bin layout (see the conversion script): f32 pos[3223] + f32
// norm[3223] + f32 uv[3223] + u32 idx[17664], all tightly packed
const MOON_V = 3223
const MOON_I = 17664
const OFF_NORM = MOON_V * 12
const OFF_UV = MOON_V * 24
const OFF_IDX = MOON_V * 24 + MOON_V * 8

let groupPromise: Promise<THREE.Group | null> | null = null

/** Moon bloom — generated radial gradient (cool white-blue), additive. */
function glowTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(224,232,255,0.55)')
  g.addColorStop(0.25, 'rgba(196,210,246,0.22)')
  g.addColorStop(0.55, 'rgba(180,195,240,0.07)')
  g.addColorStop(1, 'rgba(180,195,240,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

async function buildNightSky(): Promise<THREE.Group | null> {
  const [moonBin, moonTex, spriteTex] = await Promise.all([
    fetch(DIR + 'moon.bin').then(r => { if (!r.ok) throw new Error('moon.bin ' + r.status); return r.arrayBuffer() }),
    new THREE.TextureLoader().loadAsync(DIR + 'moon_diffuse.jpg'),
    new THREE.TextureLoader().loadAsync(DIR + 'star-sprite.png'),
  ])
  moonTex.colorSpace = THREE.SRGBColorSpace
  spriteTex.colorSpace = THREE.SRGBColorSpace

  const g = new THREE.Group()
  g.userData.nightSkyGroup = true    // visual layer only — never raycast/collide

  // ---- moon: opaque self-lit disc (writes depth; stars occlude behind it)
  const geo = new THREE.BufferGeometry()
  const f32 = (off: number, n: number) =>
    new THREE.BufferAttribute(new Float32Array(moonBin, off, n), 3)
  geo.setAttribute('position', f32(0, MOON_V * 3))
  geo.setAttribute('normal', f32(OFF_NORM, MOON_V * 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(moonBin, OFF_UV, MOON_V * 2), 2))
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(moonBin, OFF_IDX, MOON_I), 1))
  geo.computeBoundingSphere()
  const moonMat = new THREE.MeshBasicMaterial({
    map: moonTex,
    fog: false,          // fog far is 190 on night — a fogged moon would vanish
    toneMapped: false,   // keeps the albedo crisp-bright instead of ACES-greyed
  })
  // overdrive the mid-grey lunar albedo toward bright white-blue: bright
  // plains clip to white, maria/craters keep detail — the "bright disc,
  // subtle crater mottling" read from Task 100, now with real relief data
  moonMat.color.setRGB(1.22, 1.26, 1.35)
  const moon = new THREE.Mesh(geo, moonMat)
  moon.position.copy(MOON_DIR).multiplyScalar(MOON_DIST)
  moon.scale.setScalar(MOON_RADIUS)
  moon.renderOrder = -9
  g.add(moon)

  // ---- glow: additive sprite just in front of the disc (298 < 300 so the
  // depth test never fights the moon's own written depth)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  }))
  glow.position.copy(MOON_DIR).multiplyScalar(MOON_DIST - 2)
  glow.scale.set(MOON_GLOW, MOON_GLOW, 1)
  g.add(glow)

  // ---- stars: one THREE.Points per size bucket (built-in PointsMaterial
  // has a single size per cloud — the conversion script buckets accordingly,
  // and the renderer auto-scales points for DPR/resolution)
  const starBuf = await fetch(DIR + 'stars-night.bin').then(r => { if (!r.ok) throw new Error('stars-night.bin ' + r.status); return r.arrayBuffer() })
  const dv = new DataView(starBuf)
  const nBuckets = dv.getUint32(0, true)
  let off = 4
  let total = 0
  for (let b = 0; b < nBuckets; b++) {
    const count = dv.getUint32(off, true)
    const size = dv.getFloat32(off + 4, true)
    off += 8
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const base = off
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = dv.getFloat32(base + i * 24 + k * 4, true)
        col[i * 3 + k] = dv.getFloat32(base + i * 24 + 12 + k * 4, true)
      }
    }
    off += count * 24
    total += count
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3))
    pg.computeBoundingSphere()
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({
      size,
      map: spriteTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,   // star glows never block each other or the moon
      vertexColors: true,
      sizeAttenuation: true,
      fog: false,
    }))
    g.add(pts)
  }

  ;(g.userData as Record<string, unknown>).nightSky = { stars: total, buckets: nBuckets }
  return g
}

/** Attach the 3D night sky to a freshly built sky mesh (aimdepot only).
 *  Async + cached: a map re-switch to aimdepot re-parents the same group. */
export function attachNightSky(sky: THREE.Mesh): void {
  if (!groupPromise) {
    groupPromise = buildNightSky().catch(err => {
      console.warn('[nightsky] assets unavailable, gradient sky remains:', err)
      return null
    })
  }
  groupPromise.then(g => {
    if (!g) return
    sky.add(g)   // reparents on re-attach (Object3D.add removes old parent)
    // test hook: live VLM scripts await this before judging the sky
    ;(window as unknown as Record<string, unknown>).__nightsky = {
      ready: true,
      stars: (g.userData as Record<string, { stars: number }>).nightSky.stars,
    }
  })
}
