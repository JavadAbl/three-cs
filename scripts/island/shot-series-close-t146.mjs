// close-ups: the hilltop palm-series from image 8 + a beach palm-series + palm-low crown
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('console', m => { const t = m.text(); if (t.includes('island-prop')) console.log('[page]', t.slice(0, 120)) })
await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByRole('button', { name: 'Island', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()
await p.waitForFunction(() => { const e = window.__eng; return e && e.state().map === 'island' && e.state().tick > 60 }, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(3000)

// [name, camX, camY, camZ, targetX, targetY, targetZ]
const SPOTS = [
  ['series-hilltop', -0.59, 8.36, -4.75, -0.59, 10.0, -0.75],   // 4m south of the image-8 tree, looking up at crown
  ['series-beach', -56.27, 4.71, 29.58, -56.27, 6.5, 25.58],    // 4m south of beach palm-series
  ['low-beach', 48.30, 5.82, -11.66, 48.30, 8.0, -15.66],       // 4m south of a palm-low
]
for (const [name, cx, cy, cz, tx, ty, tz] of SPOTS) {
  const dx = tx - cx, dz = tz - cz
  const yaw = Math.atan2(-dx, -dz)
  await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [cx, cy, cz, yaw])
  await p.waitForTimeout(700)
  await p.screenshot({ path: `scripts/island/shots/t146-close-${name}.png` })
  console.log('shot', name)
}
await b.close()
console.log('done')
