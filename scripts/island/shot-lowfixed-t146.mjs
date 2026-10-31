// close-up of the former teal-band palm-low spot (48.30, -15.66) — now palm-series
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
// the exact former teal-band view: 4m south, eye 1.7 above base
const yaw = Math.atan2(-(48.30 - 48.30), -(-15.66 - -11.66))
await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [48.30, 4.12 + 1.7, -11.66, yaw])
await p.waitForTimeout(800)
await p.screenshot({ path: 'scripts/island/shots/t146-lowfixed.png' })
console.log('shot saved')
await b.close()
