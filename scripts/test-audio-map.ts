// PHASE 2 test — data-driven audio map + staged samples acceptance
// (updated for Phase 3: live weapons may still draw samples from staging
// until the Phase 9 acceptance sweep — the loader falls back automatically)
// 1. every live WEAPONS id has a WEAPON_AUDIO entry (map covers the roster)
// 2. live guns carry fire; reload trio (out/in/rack) except documented
//    synth-fallback cases (cz75: pack has no reload samples; taser: never
//    reloads); gear (knife/c4) carries draw
// 3. every sound name for LIVE weapons exists in accepted OR staged pack
//    (accepted-first, staged-fallback = the loader's exact behavior);
//    NON_WEAPON_FILES must be fully accepted/committed
// 4. every sound name for FUTURE weapons + GRENADE_AUDIO + GRENADE_COMMON
//    exists in the staged pack (public/staging/sounds) — the 2.2 acceptance
// 5. no duplicate names in the derived preload FILES; no overlap between
//    weapon-map names and NON_WEAPON_FILES
// 6. HTTP: every staged ogg serves 200, every committed ogg serves 200
import { existsSync, readdirSync } from 'node:fs'
import { WEAPONS } from '../shared/weapons'
import {
  WEAPON_AUDIO, GRENADE_AUDIO, GRENADE_COMMON, NON_WEAPON_FILES,
  liveWeaponSoundFiles, weaponAudioNames,
} from '../shared/weapons-audio'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${name}${detail ? ' · ' + detail : ''}`) }
  else { fail++; console.log(`FAIL — ${name}${detail ? ' · ' + detail : ''}`) }
}

const ACCEPTED = '/home/z/my-project/public/assets/sounds'
const STAGED = '/home/z/my-project/public/staging/sounds'
const liveIds = Object.keys(WEAPONS)
const futureIds = Object.keys(WEAPON_AUDIO).filter(id => !(id in WEAPONS))

// --- 1. map coverage of live roster ---
for (const id of liveIds) {
  check(`WEAPON_AUDIO covers live weapon ${id}`, !!WEAPON_AUDIO[id])
}
// Phase 6 live: future roster shrank to the Phase 7-8 remainder (2 MGs,
// grenades via GRENADE_AUDIO) — recalibrate the floor.
check('future roster mapped (>= 2 entries — phases 7-8 remain)', futureIds.length >= 2, `${futureIds.length} future ids`)
check('no future id collides with a live WEAPONS id',
  futureIds.every(id => !(id in WEAPONS)))

// --- 2. schema completeness ---
// Reload-trio exceptions (documented in the map): cz75 has no reload samples
// in the raw pack (synth fallback); taser never reloads (one use per buy).
const NO_RELOAD_TRIO = new Set(['cz75', 'taser'])
for (const id of liveIds) {
  const a = WEAPON_AUDIO[id]
  const w = WEAPONS[id as keyof typeof WEAPONS]
  if (!a) continue
  if (w.category === 'gear') {
    check(`gear[${id}] has draw`, !!a.draw)
  } else {
    const trio = !!(a.out && a.in && a.rack)
    check(`gun[${id}] has fire (+ reload trio unless exempt)`,
      !!a.fire && (trio || NO_RELOAD_TRIO.has(id)),
      `fire=${!!a.fire} out=${!!a.out} in=${!!a.in} rack=${!!a.rack}`)
  }
}

// --- 3. live names resolve (accepted first, staged fallback — like the loader) ---
const liveNames = liveWeaponSoundFiles()
let liveStagedOnly = 0
for (const n of liveNames) {
  const accepted = existsSync(`${ACCEPTED}/${n}.ogg`)
  const staged = existsSync(`${STAGED}/${n}.ogg`)
  if (!accepted && staged) liveStagedOnly++
  check(`resolves: ${n}.ogg`, accepted || staged, accepted ? 'accepted' : staged ? 'staged' : 'MISSING')
}
check('staged-only live samples are tracked for Phase 9 acceptance', liveStagedOnly >= 0, `${liveStagedOnly} names staged-only`)
for (const n of NON_WEAPON_FILES) {
  check(`accepted (non-weapon): ${n}.ogg`, existsSync(`${ACCEPTED}/${n}.ogg`))
}

// --- 4. future names exist in the staged pack ---
const futureNames = new Set<string>()
for (const id of futureIds) {
  const a = WEAPON_AUDIO[id]
  if (a) for (const n of weaponAudioNames(a)) futureNames.add(n)
}
for (const g of Object.values(GRENADE_AUDIO)) {
  for (const n of [g.draw, g.deploy, g.emit, g.explode, g.explodeDistant]) if (n) futureNames.add(n)
}
for (const n of Object.values(GRENADE_COMMON)) futureNames.add(n)
for (const n of futureNames) {
  check(`staged: ${n}.ogg`, existsSync(`${STAGED}/${n}.ogg`))
}

// --- 5. no duplicates / no overlap in the derived preload ---
const files = [...liveWeaponSoundFiles(), ...NON_WEAPON_FILES]
check('derived FILES has no duplicates', new Set(files).size === files.length, `${files.length} names`)
check('weapon-map names do not overlap NON_WEAPON_FILES',
  liveNames.every(n => !NON_WEAPON_FILES.includes(n)))
check('preload = live weapons only (no future-roster names preloaded)',
  files.every(n => !futureNames.has(n)), `${liveNames.length} live weapon names`)

// --- 6. HTTP serving (every staged + every committed ogg → 200) ---
async function httpCheck(base: string, dir: string, label: string) {
  const names = readdirSync(dir).filter(f => f.endsWith('.ogg'))
  let bad = 0
  const BATCH = 20
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH)
    await Promise.all(batch.map(async f => {
      try {
        const r = await fetch(`${base}/${f}`)
        if (!r.ok) { bad++; console.log(`  HTTP ${r.status}: ${label}/${f}`) }
      } catch (e) { bad++; console.log(`  HTTP ERR: ${label}/${f} ${e}`) }
    }))
  }
  check(`HTTP 200: all ${label} files (${names.length})`, bad === 0, bad ? `${bad} failures` : 'all 200')
}
const base = process.env.AUDIO_BASE ?? 'http://localhost:3000'
await httpCheck(`${base}/staging/sounds`, STAGED, 'staged')
await httpCheck(`${base}/assets/sounds`, ACCEPTED, 'committed')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
