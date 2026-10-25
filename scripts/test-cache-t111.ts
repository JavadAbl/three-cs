// Task 111 cache test — persistent-storage ask + live "cached vs downloading"
// loading-bar surfacing. User report: "seems every time I open app it
// downloads data" — the cache (Task 81) existed but (a) Cache Storage is
// best-effort and can be evicted between sessions, and (b) the loading bar
// looked identical warm and cold, so warm loads READ as downloads.
//
// 1. preloader wiring: navigator.storage.persist() requested at install
//    (memoized, guarded, before the idempotence guard), persisted()/estimate()
//    surfaced on __assetCache.
// 2. bytesNet accounting: real 200 downloads add blob.size; warm short-circuit
//    (storeKeys.has) and cache hits never touch it.
// 3. LoadProgress carries net/bytes deltas; page.tsx renders
//    'CACHED — NO DOWNLOAD' vs 'DOWNLOADING · X MB' live during the preload,
//    source-neutral before the first tick, console verdict line extended.
import { readFileSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const pre = readFileSync('src/game/preloader.ts', 'utf8')
const page = readFileSync('src/app/page.tsx', 'utf8')

// --- 1. persistent-storage ask ----------------------------------------------
const fnAt = pre.indexOf('function requestPersistentStorage')
check('requestPersistentStorage exists in preloader.ts', fnAt >= 0)
check('asks navigator.storage.persist() (guarded, persisted()-short-circuit)',
  /if \(!st\?\.persist\) return false/.test(pre) && /await st\.persisted\?\.\(\)/.test(pre) && /return await st\.persist\(\)/.test(pre))
check('memoized once per session (persistOnce guard)',
  /let persistOnce: Promise<boolean> \| null = null/.test(pre) && /if \(persistOnce\) return/.test(pre))
check('fails soft — the ask can never reject outwardly',
  /persistOnce\.catch\(\(\) => \{ \/\* best-effort only \*\/ \}\)/.test(pre))
check('called from installAssetCache BEFORE the idempotence guard',
  (() => {
    const i = pre.indexOf('export function installAssetCache')
    const call = pre.indexOf('requestPersistentStorage()', i)
    const guard = pre.indexOf('if (realFetch ||', i)
    return i >= 0 && call > i && call < guard
  })())
check('__assetCache exposes persisted() + estimate()',
  /persisted: \(\) => persistOnce/.test(pre) && /estimate: \(\) => navigator\.storage\?\.estimate\?\.(\(\))?/.test(pre))

// --- 2. bytesNet accounting ---------------------------------------------------
check('CacheStats carries bytesNet + neg, both initialized 0',
  /export interface CacheStats \{ hits: number; net: number; stored: number; bypass: number; bytesNet: number; neg: number \}/.test(pre)
  && /export const cacheStats: CacheStats = \{ hits: 0, net: 0, stored: 0, bypass: 0, bytesNet: 0, neg: 0 \}/.test(pre))
check('only real 200 downloads add blob.size',
  /if \(r\.status === 200\) cacheStats\.bytesNet \+= blob\.size/.test(pre))

// --- 2b. NEGATIVE cache (warm-run netlog: ~70-100 404 probes per launch) ----
check('404 responses are negative-cached (else-if branch on the net path)',
  /else if \(r\.status === 404\) \{/.test(pre))
check('negative entries count in cacheStats.neg',
  /cacheStats\.neg\+\+/.test(pre))
check('negative entries memo into memCache + storeKeys (status 404 carried)',
  /memCache\.set\(key, \{ status: 404, blob, type \}\)/.test(pre)
  && pre.indexOf('memCache.set(key, { status: 404') > pre.indexOf('cacheStats.neg++'))
check('negative entries persist via store.put (fire-and-forget, soft-timeout)',
  (() => {
    const neg = pre.indexOf('else if (r.status === 404)')
    const ret = pre.indexOf('return { status: r.status', neg)
    return pre.slice(neg, ret).includes('void softTimeout(store.put(cacheKey(url)')
  })())
check('bump-rule comment covers 404-becomes-file re-ships',
  /NEGATIVE entries too \(Task 111\)/.test(pre))
check('memo-hit path passes non-200 status through (loader chain fallback intact)',
  /headers: memo\.status === 200 \? \{ 'Content-Type': memo\.type \} : \{\}/.test(pre))
check('accounting sits on the net-fetch path (inside the inflight miss branch)',
  (() => {
    const miss = pre.indexOf('cacheStats.net++')
    const add = pre.indexOf('cacheStats.bytesNet += blob.size')
    const fin = pre.indexOf('gateRelease()', miss)   // the miss branch's finally
    return miss > 0 && add > miss && fin > add
  })())

// --- 3. LoadProgress net/bytes plumbing --------------------------------------
check('LoadProgress interface carries net + bytes',
  /export interface LoadProgress \{ stage: string; done: number; total: number; pct: number; net: number; bytes: number \}/.test(pre))
check('preload deltas captured at start (net0/bytes0)',
  /const net0 = cacheStats\.net, bytes0 = cacheStats\.bytesNet/.test(pre))
check('every tick reports live deltas',
  /net: cacheStats\.net - net0, bytes: cacheStats\.bytesNet - bytes0/.test(pre))
check("'done' progress also carries the final deltas",
  (() => {
    const done = pre.indexOf("{ stage: 'done', done: total, total, pct: 1,")
    return done > 0 && pre.slice(done, done + 130).includes('net: cacheStats.net - net0')
  })())

// --- 4. page.tsx loading-bar surfacing ---------------------------------------
check('LoadPhase carries net + bytes fields',
  /net: number\s+\/\/ Task 111/.test(page) && /bytes: number\s+\/\/ Task 111/.test(page))
check("cold label: 'DOWNLOADING · X MB' when net > 0",
  page.includes('`DOWNLOADING · ${(phase.bytes / 1048576).toFixed(1)} MB`'))
check("warm label: 'CACHED — NO DOWNLOAD' when net === 0",
  page.includes("'CACHED — NO DOWNLOAD'"))
check('label is source-neutral before the first tick (done === 0)',
  /phase\.done === 0\s+\? stageLabel\(phase\.stage\)/.test(page))
check('live label composes src · stage · done/total',
  page.includes('`${src} · ${stageLabel(phase.stage)} · ${phase.done}/${phase.total}`'))
check('onProgress plumbs p.net/p.bytes into the phase',
  /net: p\.net, bytes: p\.bytes/.test(page))
check('initial phase starts at net 0, bytes 0',
  /setLoadPhase\(\{ stage: 'textures', done: 0, total: 1, pct: 0, cached: false, net: 0, bytes: 0 \}\)/.test(page))
check("console verdict line now reports download count + MB ('downloads N (X MB)')",
  /downloads \$\{netN\} \(\$\{\(netB \/ 1048576\)\.toFixed\(1\)\} MB\)/.test(page))
check('READY — SERVED FROM CACHE end-state preserved from Task 81',
  page.includes("'READY — SERVED FROM CACHE'"))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
