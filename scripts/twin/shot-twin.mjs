// Task 153 — in-game render check for Twin Villas, via the __eng.teleport hook.
// Shots: street view of the facing facade, L1 window duel lane (looking
// THROUGH the window at the enemy villa), entry hall + stair core, flight A
// climb, the basement, and the tunnel lane.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const SHOTS = 'scripts/twin/shots'
mkdirSync(SHOTS, { recursive: true })

// [name, x, y, z, yaw] — eye = floor + 1.62; yaw: 0=north, -PI/2=east, PI/2=west
const SPOTS = [
  ['street-facades', -14, 1.62, 0, -Math.PI / 2],          // CT spawn hall door, facing east villa
  ['l1-window-duel', -10.5, 3.4 + 1.62, 0, -Math.PI / 2],  // AT the L1 mid window, looking through it
  ['l0-window-room', -13, 1.62, -12, -Math.PI / 2],        // ground window room (street control)
  ['hall-staircore', -11, 1.62, 0, Math.PI / 2],           // entry hall looking west at the stair core
  ['flight-a', -25.1, 1.46 + 1.62, 0.86, 0],               // mid flight A looking north/up
  ['basement', -18, -3.2 + 1.62, 0, -Math.PI / 2],         // west basement looking east at tunnel mouth
  ['tunnel', -6, -3.2 + 1.62, 0, -Math.PI / 2],            // inside the tunnel
]

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('console', m => { const t = m.text(); if (/FAILED|Error|error/i.test(t)) console.log('[page]', t.slice(0, 200)) })
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))

await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)

await p.getByRole('button', { name: 'Twin Villas', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()

await p.waitForFunction(() => {
  const e = window.__eng
  if (!e) return false
  const s = e.state()
  return s.map === 'twin' && s.tick > 60
}, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(3000)
console.log('in game on twin, overlay gone')

for (const [name, x, y, z, yaw] of SPOTS) {
  await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [x, y, z, yaw])
  await p.waitForTimeout(700)
  await p.screenshot({ path: `${SHOTS}/t153-${name}.png` })
  console.log('shot', name)
}
await b.close()
console.log('done')
