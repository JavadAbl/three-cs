// Task 81 — persistent asset cache + manifest preloader.
//
// Problem (user report): "game freeze when it want to load contents... should
// preload with a loading bar like other games, and it should cache assets so
// it doesn't download them every game." Every asset — map PBR jpgs, weapon
// GLBs (POST-routed, so browsers NEVER cache them), the 7.6 MB human model,
// 252 .ogg sounds, weapon material jpgs, the Draco wasm — was re-downloaded
// EVERY match and decoded mid-round; upgrades popped in after the fact and
// shader recompiles hitched the first minutes of play.
//
// Fix, two layers:
//  1. CACHE — a versioned Cache API store (cache name carries the version)
//     wrapped around window.fetch. Everything the game loads goes through
//     fetch (three FileLoader, TextureLoader, GLTFLoader, DRACOLoader, our
//     audio/weapons code), so one interception point covers all asset
//     traffic, POST-routed GLBs included (stored under synthetic GET keys).
//     Second game on: every asset is a cache hit — no network at all.
//  2. PRELOAD — a manifest preloader (the exact URLs each loader will ask
//     for, including the assets→staging fallback chains) runs behind a
//     CS2-style loading bar BEFORE the round starts; the engine's own loads
//     then hit the cache instantly, and engine.warmup() settles PBR upgrades
//     + sound decode + shader compilation before the bar lifts.
//
// The wrapper is deliberately conservative: same-origin only, GET/POST only,
// /assets/, /staging/, /draco/ and the GLB API routes only, and request.cache
// === 'no-cache' (the skins manifest's freshness policy) passes through.
import { texChain, pbrMapScope, pbrHasNormal, PBR_SURFACES } from './textures'
import { MAPS } from './mapdata'
import type { MapDef } from './mapdata'
import { WEAPON_GLB_IDS } from './weapongltf'
import { WEAPON_TEX_KEYS } from './weaponmodels'
import { liveWeaponSoundFiles, liveGrenadeSoundFiles, NON_WEAPON_FILES } from '../../shared/weapons-audio'

/**
 * ⚠ BUMP RULE: any committed change to public/assets/**, public/staging/**,
 * public/draco/** or the GLB API routes REQUIRES bumping this string —
 * otherwise users keep getting stale blobs until they clear site data.
 * The string is part of the record key, so a bump also lets the install-time
 * sweep garbage-collect every previous version in one pass. This covers the
 * NEGATIVE entries too (Task 111): a 404 that becomes a real file must bump
 * just like a changed 200.
 */
export const ASSET_CACHE_VERSION = 'v13'   // Task 138: island palm GLBs re-packed byte-exact — the Task-134 batch was double-corrupted (Bun `Buffer.from(Float32Array)` wrote 4x-short zero-filled geometry views, then gltf-transform prune/quantize piled garbage node scales 8.5e37 + mangled buffers on top), so every cached palm render-invisible ~10^38 units away ("no trees on island"). The bump flushes the poisoned GLB cache entries in existing browsers; the re-pack is gated NUMERICALLY now (scripts/island/verify-palm-glbs-t138.ts: transforms, view lengths, vertex samples, y-union — 86/86). (v12 was Task 132's island acceptance; the BUMP RULE + no-cache wrapper from Task 104 is what makes every re-ship reachable.)

const DB_NAME = 'three-cs-assets'
const STORE = 'blobs'
const PREFIXES = ['/assets/', '/staging/', '/draco/']
const ROUTE_RE = /^\/api\/assets\/(weapon|human|rebel|island)\//

export interface CacheStats { hits: number; net: number; stored: number; bypass: number; bytesNet: number; neg: number }
export const cacheStats: CacheStats = { hits: 0, net: 0, stored: 0, bypass: 0, bytesNet: 0, neg: 0 }

// ---------------------------------------------------------------- storage: Cache API
// Layer choice (the debugging story): the first implementation used raw
// IndexedDB — and under the real load pattern (engine's 250-fetch sound
// stampede racing the 8-worker preload, ~300 blob writes in seconds) this
// headless Chromium's IDB version queue wedged MID-RUN: every later
// indexedDB.open() and even live-connection transactions froze forever,
// which froze the fetch wrapper, which froze the loading bar. Raw-IDB stress
// in isolation passed, the dev server stayed 3 ms-fast — the wedge only
// appeared in the combined run. The Cache API is the purpose-built layer for
// "don't re-download assets": native Response storage, no transaction
// semantics, version-in-name GC, and a different Chromium backend.
//
// POST routes (weapon GLBs / human model) can't be cache.put() keys
// directly, so every entry is stored under a SYNTHETIC GET request for the
// same URL — one key scheme for every method we intercept.
//
// Hardening rule (survives the layer swap): every storage hop is
// timeout-guarded and fails soft — a wedged cache must degrade to plain
// network (pre-Task-81 behavior), never freeze the game.
const CACHE_PREFIX = 'three-cs-assets-'
let cacheStoreOnce: Promise<Cache | null> | null = null

// bulk index of what the persistent cache already holds — ONE keys() read
// (fast even where per-entry match() is pathologically slow, as in this
// sandbox's headless Chromium: measured 952 ms PER match) instead of hundreds
// of individual matches. The preloader can then verify warm items with pure
// Set lookups, and the engine only pays a real match once per URL per
// session (memoized into memCache).
let storeKeys: Set<string> | null = null

// session-fast layer: unique-URL → carrier memo. Repeat loads (engine
// re-fetches, replays, next rounds) are microsecond Map hits.
const memCache = new Map<string, { status: number; blob: Blob; type: string }>()

const STORE_TIMEOUT = 10_000
function softTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const t = setTimeout(() => { if (!settled) { settled = true; resolve(fallback) } }, STORE_TIMEOUT)
    p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v) } },
      () => { if (!settled) { settled = true; clearTimeout(t); resolve(fallback) } },
    )
  })
}

function assetStore(): Promise<Cache | null> {
  // THE HARD-WON RULE: cache the TIMEOUT-WRAPPED promise, never the raw one.
  // The first Cache-API port cached the raw promise and soft-wrapped only the
  // first call's result — when caches.open stalled in headless Chromium, every
  // later caller awaited a dead promise forever and the loading bar froze.
  if (cacheStoreOnce) return cacheStoreOnce
  cacheStoreOnce = softTimeout((async () => {
    try {
      if (typeof caches === 'undefined' || !caches.open) return null
      const cur = await caches.open(CACHE_PREFIX + ASSET_CACHE_VERSION)
      // one-time GC: drop caches from previous ASSET_CACHE_VERSIONs (a bump
      // renames the cache, so stale blobs never outlive one launch)
      const keys = await caches.keys()
      for (const k of keys) {
        if (k.startsWith(CACHE_PREFIX) && k !== CACHE_PREFIX + ASSET_CACHE_VERSION) void caches.delete(k)
      }
      // bulk warm-start the key index (one read, serves the whole session)
      try {
        const ks = await cur.keys()
        storeKeys = new Set(ks.map(k => new URL(k.url).pathname))
      } catch { storeKeys = null }
      return cur
    } catch { return null }
  })(), null)
  return cacheStoreOnce
}

/** the cache key: a synthetic GET request for the URL (works for POST routes) */
function cacheKey(url: URL): Request {
  return new Request(url.pathname, { method: 'GET' })
}

// ---------------------------------------------------------------- fetch wrapper
let realFetch: typeof window.fetch | null = null
const inflight = new Map<string, Promise<{ status: number; blob: Blob; type: string }>>()

function cacheable(method: string, url: URL): boolean {
  if (url.origin !== location.origin) return false
  if (method !== 'GET' && method !== 'POST') return false
  return PREFIXES.some(p => url.pathname.startsWith(p)) || ROUTE_RE.test(url.pathname)
}

// ---- request gate: the engine's sound stampede (252 parallel fetches) and
// the 8-worker preload share ~6 browser sockets per origin on the HTTP/1.1
// dev proxy. Ungated, they interleave in arrival bursts and a cold load
// crawls for minutes while the bar plateaus. A tiny FIFO semaphore gives
// every fetch fair, ordered slots and lets the whole cold load stream at
// wire speed. Bypassed fetches (dev/HMR, skins freshness, other origins)
// never touch the gate.
const MAX_NET = 10
let netActive = 0
const netQueue: Array<() => void> = []
function gateAcquire(): Promise<void> {
  if (netActive >= MAX_NET) return new Promise(r => netQueue.push(r))
  netActive++
  return Promise.resolve()
}
function gateRelease() {
  const next = netQueue.shift()
  if (next) next()   // hand the slot straight to the next waiter
  else netActive--
}

const NET_TIMEOUT = 45_000
function netGuard<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const t = setTimeout(() => { if (!settled) { settled = true; reject(new Error('asset fetch timeout')) } }, NET_TIMEOUT)
    p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v) } },
      (e) => { if (!settled) { settled = true; clearTimeout(t); reject(e) } },
    )
  })
}

// Task 111 — ask the browser to make the asset cache PERSISTENT. By default
// Cache Storage is "best-effort": under disk pressure (or LRU pressure from
// other sites) Chrome may evict it entirely, and the next launch silently
// turns back into a cold ~30 MB re-download — exactly the "it downloads
// every time I open it" report. navigator.storage.persist() opts the origin
// into persistent storage (no eviction, counted against quota). Chrome may
// refuse without engagement/gesture — the cache still works either way, it
// just stays best-effort; the verdict is surfaced via __assetCache.persisted().
let persistOnce: Promise<boolean> | null = null
function requestPersistentStorage(): void {
  if (persistOnce) return
  persistOnce = (async () => {
    try {
      const st = navigator.storage
      if (!st?.persist) return false
      if (await st.persisted?.()) return true   // already granted — don't re-ask
      return await st.persist()
    } catch { return false }
  })()
  persistOnce.catch(() => { /* best-effort only */ })
}

/** Idempotent install. Call as early as possible (app mount) so even the lobby
 * warm-ups (character model, weapon GLBs) populate the cache. Every storage
 * hop degrades to plain network on timeout — the cache can slow a load down
 * but can never freeze the game. */
export function installAssetCache(): boolean {
  requestPersistentStorage()   // memoized; runs before the idempotence guard so every mount retries the ask
  if (realFetch || typeof window === 'undefined' || !window.fetch) return false
  realFetch = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rf = realFetch!
    let method = 'GET'
    let url: URL
    try {
      if (typeof input === 'string') url = new URL(input, location.href)
      else if (input instanceof URL) url = new URL(input.href)
      else { url = new URL(input.url, input.url.startsWith('/') ? location.origin : location.href); method = input.method.toUpperCase() }
      const im = init?.method
      if (typeof im === 'string') method = im.toUpperCase()
      const skip = init?.cache === 'no-cache'   // skins.json freshness policy — respect it
      if (skip || !cacheable(method, url)) {
        cacheStats.bypass++
        return rf(input, init)
      }
    } catch {
      cacheStats.bypass++
      return rf(input, init)
    }
    const key = url.pathname
    const store = await assetStore()
    // 1) session memo — repeat loads are microsecond Map hits
    const memo = memCache.get(key)
    if (memo) {
      cacheStats.hits++
      return new Response(memo.blob, {
        status: memo.status,
        headers: memo.status === 200 ? { 'Content-Type': memo.type } : {},
      })
    }
    // 2) persistent-cache hit — Cache.match hands back a FRESH Response per
    // call; memoized so this URL's slow storage read happens once per session
    if (store) {
      const hit = await softTimeout(store.match(cacheKey(url)), null as Response | null)
      if (hit) {
        cacheStats.hits++
        void hit.clone().blob().then(b => {
          memCache.set(key, { status: hit.status, blob: b, type: hit.headers.get('Content-Type') ?? 'application/octet-stream' })
        }).catch(() => { })
        return hit
      }
    }
    // 2) dedupe concurrent identical requests (engine loaders race the
    // preloader constantly). One network fetch; every waiter gets its own
    // blob-backed Response.
    let pending = inflight.get(key)
    if (!pending) {
      cacheStats.net++
      pending = (async () => {
        await gateAcquire()
        try {
          // Task 104 STALE-REFILL FIX: default the net fetch to 'no-cache'
          // (ETag revalidation) when the caller set no cache mode. Without
          // this, a re-shipped /assets/ body (e.g. m4_fire.ogg) NEVER
          // propagates to existing browsers: the ASSET_CACHE_VERSION bump
          // rotates the Cache-Storage key, but the refill fetch itself hits
          // the browser HTTP cache, which holds the OLD body under
          // max-age=86400 — the bump rule was silently a no-op for re-shipped
          // static files (only callers that pass cache:'reload'/'no-cache'
          // themselves, like nightsky.ts, escaped). Revalidation is one cheap
          // conditional request per asset per cold load; unchanged files
          // 304 and the browser transparently returns the cached 200 body,
          // so the status-200 gate below still works.
          const init2: RequestInit = init?.cache
            ? init
            : { ...init, cache: 'no-cache' }
          const r = await netGuard(rf(input, init2))
          const type = r.headers.get('Content-Type') ?? 'application/octet-stream'
          // Task 135 BODY GUARD: a download-manager extension that captures a
          // response can let the fetch RESOLVE (headers served) but never
          // deliver the body stream — an unguarded r.blob() then hangs
          // forever, which wedged this pending promise, leaked its network-gate
          // slot (finally never ran), and froze the whole loading bar with the
          // room stuck in server 'warmup' (the user's IDM report). The same
          // netGuard that bounds the header phase bounds the body phase: on
          // timeout the candidate rejects like any network hiccup, the pool
          // falls through to the next candidate, the gate slot is released,
          // and the bar always lifts.
          const blob = await netGuard(r.blob())
          if (r.status === 200) cacheStats.bytesNet += blob.size   // Task 111: real-download bytes for the loading-bar display
          if (r.status === 200) {
            memCache.set(key, { status: 200, blob, type })
            storeKeys?.add(key)
            if (store) {
              cacheStats.stored++
              // store a FRESH Response (blob stays usable for callers)
              void softTimeout(store.put(cacheKey(url), new Response(blob, { headers: { 'Content-Type': type } })), undefined)
            }
          } else if (r.status === 404) {
            // Task 111 NEGATIVE CACHE. Warm-run netlog diagnosis: every launch
            // re-probed ~70-100 URLs that 404 — unbaked weapon GLB ids (only 6
            // ids have baked GLBs; the rest 404 to procedural fallback) and
            // scoped map-texture paths that only ship _normal variants. 0 real
            // bytes, but one network round-trip EACH, every session — over a
            // real network that's seconds of "it downloads every time".
            // Fix: persist the 404 like any asset. Cache-hit path then serves
            // it instantly; the loaders' chain fallback (staging -> procedural)
            // is unchanged, just offline. A 404 that later becomes a real file
            // is handled by the version-bump sweep, same as changed assets.
            cacheStats.neg++
            memCache.set(key, { status: 404, blob, type })
            storeKeys?.add(key)
            if (store) {
              void softTimeout(store.put(cacheKey(url), new Response(blob, { headers: { 'Content-Type': type } })), undefined)
            }
          }
          return { status: r.status, blob, type }
        } finally {
          gateRelease()
        }
      })()
      pending.catch(() => { /* waiters rethrow via their own await */ })
        .finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    const c = await pending
    return new Response(c.blob, {
      status: c.status,
      headers: c.status === 200 ? { 'Content-Type': c.type } : {},
    })
  }) as typeof window.fetch
  // verification hook + dev surface (mirrors __pbrState's role)
  ;(window as unknown as { __assetCache?: unknown }).__assetCache = {
    version: ASSET_CACHE_VERSION, stats: cacheStats, store: () => assetStore(),
    gate: () => ({ active: netActive, queued: netQueue.length }),
    storeKeys: () => ({ ready: storeKeys !== null, size: storeKeys?.size ?? 0 }),
    mem: () => memCache.size,
    persisted: () => persistOnce ?? Promise.resolve(false),
    estimate: () => navigator.storage?.estimate?.() ?? Promise.resolve(null as unknown as StorageEstimate),
  }
  return true
}

// ---------------------------------------------------------------- manifest
interface Candidate { url: string; init?: RequestInit }
interface Item { chain: Candidate[] }   // try in order; first 200 wins (mirrors every loader's fallback chain)

/** 10 weapon material sets × albedo/normal/roughness (weaponmodels getTex).
 * Chain /assets → /staging (policy v3 — generic path for staged families;
 * the Task-124 trio was accepted into /assets in Task 125). */
function weaponTextureItems(): Item[] {
  const items: Item[] = []
  for (const k of WEAPON_TEX_KEYS) {
    for (const suf of ['', '_n', '_r']) {
      items.push({
        chain: [
          { url: `/assets/textures/weapons/${k}${suf}.jpg` },
          { url: `/staging/textures/weapons/${k}${suf}.jpg` },
        ],
      })
    }
  }
  return items
}

/** Map PBR surfaces × albedo+bump(+normal) × the loadTexFirst URL chain,
 * scoped the same way mapview scopes them (pbrMapScope). Task 88: surfaces
 * whose spec declares normal: (scoped identity sets) also warm their
 * _normal.jpg — unscoped maps ship none, so nothing is probed for them. */
function mapTextureItems(mapId: string | undefined): Item[] {
  const scope = pbrMapScope(mapId)
  const items: Item[] = []
  for (const s of PBR_SURFACES) {
    const bases = [`${s}.jpg`, `${s}_bump.jpg`]
    if (pbrHasNormal(s, scope)) bases.push(`${s}_normal.jpg`)
    for (const base of bases) {
      items.push({ chain: texChain(base, scope).map(url => ({ url })) })
    }
  }
  return items
}

/** Weapon GLBs + the character model + the Draco decoder. */
function modelItems(): Item[] {
  const items: Item[] = []
  for (const id of WEAPON_GLB_IDS) {
    items.push({ chain: [{ url: `/api/assets/weapon/${id}`, init: { method: 'POST' } }] })
  }
  items.push({ chain: [{ url: '/api/assets/human', init: { method: 'POST' } }] })
  // Task 117: the CT soldier is ACCEPTED — committed at
  // public/assets/models/human.glb + ASSET_CACHE_VERSION v7→v8.
  // Task 115: the T-side rebel model (CT = soldier above). Missing file → 404
  // → negative-cached like unbaked weapons; usermodel falls T back to the
  // soldier. ACCEPTED (Task 115 acceptance): committed at
  // public/assets/models/rebel.glb + ASSET_CACHE_VERSION v6→v7.
  items.push({ chain: [{ url: '/api/assets/rebel', init: { method: 'POST' } }] })
  for (const f of ['draco_wasm_wrapper.js', 'draco_decoder.js', 'draco_decoder.wasm']) {
    items.push({ chain: [{ url: `/draco/gltf/${f}` }] })
  }
  return items
}

/** Task 134: per-map model payloads — the exact geom URL the map wrapper
 *  fetches (read from the map def itself, so staging-preview vs accepted
 *  /assets URLs are always warmed correctly), island sky.jpg, and the 4
 *  packed palm models (chain /assets → /staging, policy v3). */
function mapModelItems(mapId: string | undefined): Item[] {
  const items: Item[] = []
  const map = mapId ? (MAPS as Record<string, MapDef | undefined>)[mapId] : undefined
  if (map?.bsp) items.push({ chain: [{ url: map.bsp.geomUrl }] })
  if (mapId === 'island') {
    items.push({ chain: [{ url: '/assets/maps/island/sky.jpg' }, { url: '/staging/maps/island/sky.jpg' }] })
    // Task 135: the 4 packed palm models go through the extensionless POST
    // route /api/assets/island/<m> (staging-wins inside the route), like every
    // other GLB — the direct /assets|/staging .glb GETs below were captured by
    // the user's IDM extension and wedged the bar in 'warmup' forever. The
    // route 404s on a fresh clone -> negative-cached -> map renders bare.
    for (const m of ['palm-hd', 'palm-low', 'palm-burned', 'palm-series']) {
      items.push({ chain: [{ url: `/api/assets/island/${m}`, init: { method: 'POST' } }] })
    }
  }
  return items
}

/** The sound pack — mirrors audio.ts's FILES derivation exactly (same three
 * shared/weapons-audio sources), each with its assets→staging chain. */
function soundItems(): Item[] {
  const names = [...new Set([...liveWeaponSoundFiles(), ...liveGrenadeSoundFiles(), ...NON_WEAPON_FILES])]
  return names.map(n => ({
    chain: [
      { url: `/assets/sounds/${n}.ogg` },
      { url: `/staging/sounds/${n}.ogg` },
    ],
  }))
}

// ---------------------------------------------------------------- preloader
export interface LoadProgress { stage: string; done: number; total: number; pct: number; net: number; bytes: number }

const STAGE_LABEL: Record<string, string> = {
  textures: 'LOADING TEXTURES',
  models: 'LOADING MODELS',
  sounds: 'LOADING SOUNDS',
}

/**
 * Warm the cache for EVERYTHING the selected map's match will touch. First
 * launch: downloads ~30 MB with a real progress bar. Later launches: near-
 * instant (cache hits) — the bar sweeps to 100 % in ~a second, which is the
 * user-visible proof that assets are no longer re-downloaded per game.
 * HARD CAP: whatever happens (wedged cache, dead server), this resolves and
 * the bar lifts — remaining assets fall back to the old lazy behavior.
 */
export async function preloadGameAssets(mapId: string | undefined, onProgress?: (p: LoadProgress) => void): Promise<void> {
  installAssetCache()
  prewarmFromCache()   // wake the storage backend + fill the session memo behind the bar
  const t0 = performance.now()
  // Task 111: delta of real network fetches/bytes — drives the live
  // "CACHED — NO DOWNLOAD vs DOWNLOADING · X MB" label on the bar. Warm
  // short-circuits via storeKeys never touch fetch(), so the deltas stay 0.
  const net0 = cacheStats.net, bytes0 = cacheStats.bytesNet
  const HARD_CAP_MS = 120_000
  const stages: Array<{ stage: string; items: Item[] }> = [
    { stage: 'textures', items: [...mapTextureItems(mapId), ...weaponTextureItems()] },
    { stage: 'models', items: [...modelItems(), ...mapModelItems(mapId)] },
    { stage: 'sounds', items: soundItems() },
  ]
  const total = stages.reduce((a, s) => a + s.items.length, 0)
  let done = 0
  const tick = (stage: string) => {
    done++
    onProgress?.({ stage, done, total, pct: Math.min(0.97, done / total), net: cacheStats.net - net0, bytes: cacheStats.bytesNet - bytes0 })
  }
  for (const s of stages) {
    await pool(s.items, 8, async (item) => {
      if (performance.now() - t0 > HARD_CAP_MS) { tick(s.stage); return }   // bail: lift the bar
      for (const cand of item.chain) {
        // warm shortcut: the bulk key index knows the entry is persisted —
        // skip fetch()/match() entirely (slow storage would otherwise cost
        // ~1 s per item even when fully cached; the Set lookup is ~0)
        const path = cand.url.split('?')[0]
        if (storeKeys && storeKeys.has(path)) { tick(s.stage); return }
        try {
          const r = await fetch(cand.url, cand.init)
          if (r.ok) { tick(s.stage); return }   // cached or downloaded — either way it's warm now
          // 404 = this candidate doesn't exist; the loaders treat that as
          // "fall through to the next directory" — mirror it
        } catch { /* network hiccup — try the next candidate like the loaders do */ }
      }
      tick(s.stage)   // exhausted: the loader's own fallback (procedural/synth) owns this
    })
  }
  onProgress?.({ stage: 'done', done: total, total, pct: 1, net: cacheStats.net - net0, bytes: cacheStats.bytesNet - bytes0 })
}

async function pool(items: Item[], n: number, fn: (it: Item) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const idx = i++
      if (idx >= items.length) return
      try { await fn(items[idx]) } catch { /* item-level failure never aborts the preload */ }
    }
  })
  await Promise.all(workers)
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage.toUpperCase()
}

/**
 * Behind-the-bar background task: stream persisted entries into the session
 * memo with bounded concurrency. Rationale (measured in this sandbox's
 * headless Chromium): the storage backend's FIRST match() per launch is
 * ~1 s per entry (it wakes the backend; later reads are ~4 ms). Paying that
 * first-touch per-entry HERE — while the loading bar still covers the screen
 * — turns every later engine load into a microsecond memo hit instead of a
 * slow match or a timeout-miss. Fire-and-forget, deadline-capped.
 */
export function prewarmFromCache(deadlineMs = 30_000): void {
  void (async () => {
    const t0 = performance.now()
    const c = await assetStore()
    if (!c || !storeKeys) return
    const keysArr = [...storeKeys]
    let i = 0
    const worker = async () => {
      for (;;) {
        if (performance.now() - t0 > deadlineMs) return
        const k = keysArr[i++]
        if (k === undefined) return
        if (memCache.has(k)) continue
        try {
          const r = await c.match(new Request(k, { method: 'GET' }))
          if (r) {
            const b = await r.blob()
            memCache.set(k, { status: r.status, blob: b, type: r.headers.get('Content-Type') ?? 'application/octet-stream' })
          }
        } catch { /* next key — prewarm is best-effort */ }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  })()
}
