// Task 152 gate: office map fully removed — server + client registries must
// not know it, a room requested as 'office' falls back to dust, and the
// office asset URLs are gone from /assets (404).
// Usage: bun scripts/t152-office-gone.ts   (exit 0 = pass)
import { io } from 'socket.io-client'

const URL = process.env.GAME_URL ?? 'http://localhost:3003'
let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` · ${detail}` : ''}`)
  ok ? pass++ : fail++
}

// 1) static registries: no 'office' in either mapdata registry source
const { readFileSync } = await import('fs')
const cli = readFileSync('src/game/mapdata.ts', 'utf8')
const srv = readFileSync('mini-services/game-server/mapdata.ts', 'utf8')
check('client mapdata: no office MapId/registry entry', !/'office'/.test(cli) && !/map-office/.test(cli))
check('server mapdata: no office MapId/registry entry', !/'office'/.test(srv) && !/map-office/.test(srv))
check('client map-office.ts deleted', !exists('src/game/map-office.ts'))
check('server map-office.ts deleted', !exists('mini-services/game-server/map-office.ts'))
check('/assets/maps/office deleted', !exists('public/assets/maps/office/geom.json'))
check('/assets/textures/maps/office deleted', !exists('public/assets/textures/maps/office/carpet.jpg'))
function exists(p: string) {
  try { readFileSync(p); return true } catch { return false }
}

// 2) live: join a room asking for map=office -> VALID_MAPS rejects it and
// the server serves its default (dust2)
const socket = io(URL, { transports: ['websocket'] })
const result = await new Promise<{ mapId?: string; ok?: boolean }>(resolve => {
  const t = setTimeout(() => resolve({}), 8000)
  socket.on('init', (d: { mapId?: string }) => { clearTimeout(t); resolve({ mapId: d.mapId, ok: true }); socket.close() })
  socket.emit('join', { name: 't152', room: 't152-office-gone', map: 'office', botFill: false })
  socket.on('error', (e: unknown) => { clearTimeout(t); resolve({}); console.error('socket error', e) })
})
check('live: join map=office falls back to a valid map', result.ok === true && result.mapId !== 'office', `served mapId=${result.mapId}`)
check('live: fallback map is dust2 (join default)', result.mapId === 'dust2', `mapId=${result.mapId}`)
try { socket.close() } catch { /* already closed */ }

// 3) HTTP: office geom + texture URLs now 404 on the web server
async function code(u: string) { try { const r = await fetch(u); return r.status } catch { return -1 } }
const web = process.env.WEB_URL ?? 'http://localhost:3000'
check('GET /assets/maps/office/geom.json -> 404', await code(`${web}/assets/maps/office/geom.json`) === 404)
check('GET /assets/textures/maps/office/carpet.jpg -> 404', await code(`${web}/assets/textures/maps/office/carpet.jpg`) === 404)

console.log(fail === 0 ? `\n${pass} passed, 0 failed` : `\n${pass} passed, ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
