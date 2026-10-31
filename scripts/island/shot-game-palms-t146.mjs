// Task 146 — in-game palm screenshots on island, via the __eng.teleport hook.
// Shots: the 4 palm-burned spots + 2 beach clusters + the palm-hd hero, so we
// can see exactly what the user means by "broken tree models".
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const SHOTS = 'scripts/island/shots'
mkdirSync(SHOTS, { recursive: true })

// [name, px, pz, py] — camera stands ~9m from the palm, eye 1.7 above ground
const SPOTS = [
  ['burn1', 4.74, 48.58, 8.05],
  ['burn2', -12.08, 49.41, 5.58],
  ['burn3', -5.15, -6.06, 6.31],
  ['burn4', -3.55, 7.02, 9.03],
  ['beachW', -56.27, 25.58, 3.01],   // palm-series cluster west
  ['beachE', 44.57, -25.74, 3.39],   // palm-series east
  ['hd', 46.05, 26.20, 7.00],        // palm-hd hero by village
  ['center', -0.59, -0.75, 7.66],    // palm-series on the hill top
]

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('console', m => { const t = m.text(); if (t.includes('island-prop') || t.includes('FAILED')) console.log('[page]', t.slice(0, 160)) })

await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)

// pick island then PLAY
await p.getByRole('button', { name: 'Island', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()

// wait for the engine + island map + props placed
await p.waitForFunction(() => {
  const e = window.__eng
  if (!e) return false
  const s = e.state()
  return s.map === 'island' && s.tick > 60
}, undefined, { timeout: 90000 })
// wait for the loading overlay to be GONE (preload gate + join released)
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(4000) // let props settle
console.log('in game on island, overlay gone')

for (const [name, px, pz, py] of SPOTS) {
  // stand 9m south of the palm (z - 9), eye = ground + 1.7, face north toward it
  const cx = px, cz = pz - 9, cy = py + 1.7
  const dx = px - cx, dz = pz - cz
  const yaw = Math.atan2(-dx, -dz)
  await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [cx, cy, cz, yaw])
  await p.waitForTimeout(700)
  await p.screenshot({ path: `${SHOTS}/t146-game-${name}.png` })
  console.log('shot', name)
}
await b.close()
console.log('done')
