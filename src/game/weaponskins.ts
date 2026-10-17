// ============================================================
// External weapon texture (skin) system.
// Drop PNG files into public/assets/textures/weapons/:
//   {weaponId}.png       — albedo / color skin (replaces the procedural map)
//   {weaponId}_bump.png  — optional grayscale bump map
//   skins.json           — optional manifest { "ak47": 1, ... } (skips 404 probing)
// Applies to viewmodels, remote-player guns and the planted bomb.
// Only drop in artwork you have the rights to use.
// ============================================================
import * as THREE from 'three'
import type { WeaponId } from './weapons'

const SKIN_DIR = '/assets/textures/weapons/'
const WEAPON_IDS: WeaponId[] = ['knife', 'glock', 'usp', 'deagle', 'mp5', 'ak47', 'm4', 'awp', 'c4']

export interface WeaponSkin {
  map: THREE.Texture
  bump?: THREE.Texture
  /** per-repeat cloned textures (≤3 buckets each) — shared by every build, never disposed */
  mapBuckets: Map<number, THREE.Texture>
  bumpBuckets: Map<number, THREE.Texture>
}

const skins = new Map<WeaponId, WeaponSkin>()
/** shared memoized promise — every engine instance (React double-mount safe)
 *  observes the same completion event with the same skin count */
let loadPromise: Promise<number> | null = null

const texLoader = new THREE.TextureLoader()
texLoader.setCrossOrigin('anonymous')

function loadTex(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    texLoader.load(url, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = 8
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      resolve(t)
    }, undefined, () => reject(new Error(`missing: ${url}`)))
  })
}

async function probe(url: string, srgb: boolean): Promise<THREE.Texture | null> {
  try { return await loadTex(url, srgb) } catch { return null }
}

/**
 * Load every weapon skin found in /assets/textures/weapons/.
 * Memoized: concurrent/later callers await the same load and get the same result.
 */
export function loadWeaponSkins(): Promise<number> {
  if (!loadPromise) loadPromise = doLoad()
  return loadPromise
}

async function doLoad(): Promise<number> {
  let list: WeaponId[] = WEAPON_IDS
  try {
    const res = await fetch(SKIN_DIR + 'skins.json', { cache: 'no-cache' })
    if (res.ok) {
      const j = (await res.json()) as Record<string, unknown>
      const listed = WEAPON_IDS.filter(id => !!j[id])
      if (listed.length) list = listed
    }
  } catch { /* no manifest — fall back to probing all weapon ids */ }
  await Promise.all(list.map(async id => {
    const map = await probe(`${SKIN_DIR}${id}.png`, true)
    if (!map) return
    const bump = await probe(`${SKIN_DIR}${id}_bump.png`, false)
    skins.set(id, { map, bump: bump ?? undefined, mapBuckets: new Map(), bumpBuckets: new Map() })
  }))
  console.log('[skins] loaded', skins.size, 'weapon skin(s) from', SKIN_DIR)
  return skins.size
}

export function getSkin(id: WeaponId): WeaponSkin | null {
  return skins.get(id) ?? null
}

/** clone-once-per-repeat shared texture (bounds GPU uploads to ≤3 per map) */
function bucketTex(skin: WeaponSkin, buckets: Map<number, THREE.Texture>,
  base: THREE.Texture, rep: number): THREE.Texture {
  let t = buckets.get(rep)
  if (!t) {
    t = base.clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    t.repeat.set(rep, rep)
    t.needsUpdate = true
    buckets.set(rep, t)
  }
  return t
}

/** pattern density: about one tile per 22cm of part size, clamped to 1..3 */
function textureRepeat(o: THREE.Mesh): number {
  const geo = o.geometry
  if (!geo.boundingBox) geo.computeBoundingBox()
  const s = new THREE.Vector3()
  geo.boundingBox!.getSize(s)
  const maxD = Math.max(s.x, s.y, s.z)
  return Math.max(1, Math.min(3, Math.round(maxD / 0.22)))
}

/**
 * Apply the external skin for `id` to every skinnable mesh under `root`.
 * Clones materials per mesh (shared procedural materials stay untouched),
 * so hands / sights / lenses keep their look. No-op when no skin is loaded.
 */
export function applySkin(root: THREE.Object3D, id: WeaponId): void {
  const skin = skins.get(id)
  if (!skin) return
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    const mat = o.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
    const m = Array.isArray(mat) ? mat[0] : mat
    if (!m || (m as THREE.MeshStandardMaterial).userData?.skinnable !== true) return
    if ((m as THREE.MeshStandardMaterial).userData?.__skinnedFor === id) return
    const c = (m as THREE.MeshStandardMaterial).clone()
    c.userData = { ...(m as THREE.MeshStandardMaterial).userData, __skinnedFor: id }
    c.color.set(0xffffff) // skin provides the full albedo
    const rep = textureRepeat(o)
    c.map = bucketTex(skin, skin.mapBuckets, skin.map, rep)
    if (skin.bump) {
      c.bumpMap = bucketTex(skin, skin.bumpBuckets, skin.bump, rep)
      c.bumpScale = 0.8
    }
    c.needsUpdate = true
    o.material = Array.isArray(mat) ? [c] : c
  })
}
