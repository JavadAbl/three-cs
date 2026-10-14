// server browser flow probe: watch list, verify entry, join it, verify map
import { io } from 'socket.io-client'
const s = io('http://localhost:3003', { path: '/' })
let pass = 0, fail = 0
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('PASS', n) } else { fail++; console.log('FAIL', n) } }

s.on('connect', () => s.emit('watchServers'))
s.on('serverList', (d: { servers: Array<{ id: string; name: string; map: string; players: number; humans: number; phase: string; round: number }> }) => {
  const srv = d.servers?.[0]
  if (srv) {
    ok('server-in-list', !!srv.id && !!srv.name)
    ok('server-map-dust2', srv.map === 'dust2', )
    console.log('  entry:', JSON.stringify(srv))
    // now join it as a second client
    const c = io('http://localhost:3003', { path: '/' })
    c.on('init', (i: { mapId?: string }) => {
      ok('join-gets-dust2', i.mapId === 'dust2')
      console.log('RESULT', pass, 'passed,', fail, 'failed')
      process.exit(fail ? 1 : 0)
    })
    c.on('connect', () => c.emit('join', { name: 'Joiner', room: srv.id, team: 'T', map: 'dust' }))
    setTimeout(() => { console.log('RESULT', pass, 'passed,', fail, 'failed (timeout)'); process.exit(1) }, 8000)
  }
})
setTimeout(() => { console.log('no server in list'); process.exit(1) }, 8000)
