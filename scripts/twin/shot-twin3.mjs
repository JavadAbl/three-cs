// Task 153 (run 3) — Twin Villas shots with CORRECT teleport semantics:
// teleport(x, y, z, yaw) sets the FEET position (engine adds eye height).
// Run 1/2 passed floor+1.62 as feet -> every camera floated one eye too high.
// NOTE: local browser cannot reach :3003 (XTransformPort is a deployed-
// platform proxy), so the red GAME SERVER UNREACHABLE dialog is expected
// local-only noise — the map render itself is fully client-side and valid.
import { chromium } from 'playwright'

const SHOTS = 'scripts/twin/shots'
const E = Math.PI / 2
// [name, feetX, feetY, feetZ, yaw]
const SPOTS = [
  ['r3-street-facade', -5, 0, 0, -E],            // on the street: full east facade, 3 window rows + door
  ['r3-l1-window-duel', -10.5, 3.4, 0, -E],      // eye 5.02 centered in the L1 window (4.4..6.0)
  ['r3-l2-window-duel', -10.5, 6.8, 0, -E],      // eye 8.42 centered in the L2 window (7.8..9.4)
  ['r3-l0-window-room', -13, 0, -12, -E],        // eye 1.62 centered in the L0 window (1.0..2.6)
  ['r3-hall-staircore', -11, 0, 0, E],           // entry hall looking west at the stair core
  ['r3-flight-a', -25.1, 1.46, 0.86, 0],         // feet on a mid-flight step, looking north/up
  ['r3-basement', -18, -3.2, 0, -E],             // basement looking east at the tunnel mouth
  ['r3-tunnel', -6, -3.2, 0, -E],                // inside the tunnel
]

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))

await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByRole('button', { name: 'Twin Villas', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()
await p.waitForFunction(() => { const e = window.__eng; return e && e.state().map === 'twin' && e.state().tick > 60 }, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(2500)
console.log('in game on twin')

for (const [name, x, y, z, yaw] of SPOTS) {
  try {
    await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [x, y, z, yaw])
    await p.waitForTimeout(600)
    await p.screenshot({ path: `${SHOTS}/t153-${name}.png` })
    console.log('shot', name)
  } catch (e) {
    console.log('shot', name, 'FAILED:', String(e).slice(0, 100))
    break
  }
}
await b.close()
console.log('done')
