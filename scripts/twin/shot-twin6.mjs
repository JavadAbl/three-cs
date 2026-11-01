// Task 153 (run 5) — window duel shots WITHOUT the serverDown dialog.
// No server connection (local browser can't reach :3003); the map render
// is fully client-side. A DOM cleaner removes the red overlay so the
// through-window views are unobstructed. Camera = FEET positions.
import { chromium } from 'playwright'
const E = Math.PI / 2
const SHOTS = 'scripts/twin/shots'
const SPOTS = [
  ['r7-l1-window-duel', -10.5, 3.4, 0, -E],
  ['r7-l2-window-duel', -10.5, 6.8, 0, -E],
  ['r7-l0-window-room', -13, 0, -12, -E],
]
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 150)))
await p.addInitScript(() => {
  setInterval(() => {
    for (const d of document.querySelectorAll('div')) {
      const t = d.children[0]?.textContent ?? ''
      if (t.includes('GAME SERVER UNREACHABLE') && d.children.length === 3 && d.getBoundingClientRect().height < 220) d.style.display = 'none'
    }
  }, 400)
})
await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByRole('button', { name: 'Twin Villas', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()
await p.waitForFunction(() => { const e = window.__eng; return e && e.state().map === 'twin' && e.state().tick > 60 }, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(2500)
console.log('in game, dialog cleaner armed')
for (const [name, x, y, z, yaw] of SPOTS) {
  try {
    await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [x, y, z, yaw])
    await p.waitForTimeout(600)
    await p.screenshot({ path: `${SHOTS}/t153-${name}.png` })
    console.log('shot', name)
  } catch (e) { console.log('shot', name, 'FAILED'); break }
}
await b.close()
console.log('done')
