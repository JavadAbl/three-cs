// circle the palm-low at (48.30, 4.12, -15.66) from 4 cardinal directions
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByRole('button', { name: 'Island', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()
await p.waitForFunction(() => { const e = window.__eng; return e && e.state().map === 'island' && e.state().tick > 60 }, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(3000)
const PX = 48.30, PZ = -15.66, PY = 4.12, H = 8.81
const dirs = [['N', 0, -8], ['E', 8, 0], ['S', 0, 8], ['W', -8, 0]]
for (const [name, dx, dz] of dirs) {
  const cx = PX + dx, cz = PZ + dz, cy = PY + 1.7
  const yaw = Math.atan2(-(PX - cx), -(PZ - cz))
  await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [cx, cy, cz, yaw])
  await p.waitForTimeout(700)
  await p.screenshot({ path: `scripts/island/shots/t146-circle-${name}.png` })
  console.log('shot from', name)
}
await b.close()
