// probe: connect like a client, dump match state from server
import { io } from 'socket.io-client'

const sock = io('ws://localhost:3003', { path: '/' })
const t0 = Date.now()

sock.on('connect', () => {
  console.log('[probe] connected, joining room dust2')
  sock.emit('join', { name: 'Probe', room: 'dust2', team: 'CT', botFill: true, botDifficulty: 'normal', winTarget: 4 })
})

sock.on('init', (d: any) => {
  console.log('[probe] init: youId=', d.youId, 'phase=', d.match?.phase, 'started?', 'players=', d.players?.length, 'mapv=', d.mapVersion)
})

sock.on('round', (d: any) => {
  console.log('[probe] round: phase=', d.phase, 'round=', d.round)
})

sock.on('snapshot', (d: any) => {
  if (Date.now() - t0 > 3000 && Date.now() - t0 < 3600) {
    console.log('[probe] snapshot arriving. phase=', d.phase ?? d.match?.phase, 'keys:', Object.keys(d).slice(0, 12).join(','))
  }
})

sock.on('joinError', (d: any) => console.log('[probe] joinError:', d))
sock.on('error', (e: any) => console.log('[probe] error:', e))
sock.on('disconnect', (r: any) => console.log('[probe] disconnect:', r))

setTimeout(() => { console.log('[probe] done'); sock.disconnect(); process.exit(0) }, 6000)
