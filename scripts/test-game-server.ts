// Quick smoke test for the game server
import { io } from 'socket.io-client'

const sock = io('http://localhost:3003', { path: '/' })

let gotSnapshot = 0
let gotRound = 0

sock.on('connect', () => {
  console.log('connected', sock.id)
  sock.emit('join', { name: 'Tester', room: 'test-room', team: 'T', botFill: true, botDifficulty: 'normal' })
})

sock.on('init', (d) => {
  console.log('init: youId=', d.youId, 'team=', d.team, 'players=', d.players.length, 'phase=', d.match.phase, 'round=', d.match.round)
  console.log('bots:', d.players.filter((p: any) => p.bot).map((p: any) => `${p.name}(${p.team})`).join(', '))
})

sock.on('round', (d) => {
  gotRound++
  if (gotRound <= 12) console.log(`round event: phase=${d.phase} round=${d.round} endsIn=${Math.round(d.endsIn / 1000)}s scores=CT:${d.scores.CT} T:${d.scores.T}`)
})

sock.on('snapshot', (d) => {
  gotSnapshot++
  if (gotSnapshot === 40) {
    const t = d.ps.find((p: any[]) => p[0] === sock.id)
    if (t) console.log('my player in snapshot:', { x: t[1], z: t[3], alive: t[12], weapon: t[14] })
    // simulate shooting a bot
    const bot = d.ps.find((p: any[]) => p[17] === 1 && p[16] === 'CT')
    if (bot) {
      console.log('shooting bot', bot[15], 'at', bot[1], bot[3])
      for (let i = 0; i < 6; i++) {
        sock.emit('shoot', { weapon: 'glock', origin: [t[1], 1.6, t[3]], dir: [1, 0, 0] })
        sock.emit('hit', { target: bot[0], part: i === 5 ? 'head' : 'body', dist: 10, weapon: 'glock' })
      }
    }
  }
})

sock.on('hitConfirm', (d) => console.log('hitConfirm:', JSON.stringify(d)))
sock.on('kill', (d) => console.log('KILL:', d.killerName, '->', d.victimName, d.headshot ? '(HEADSHOT)' : '', d.weapon))
sock.on('toast', (d) => console.log('toast:', d.msg))
sock.on('bomb', (d) => console.log('bomb event:', JSON.stringify(d)))
sock.on('plantProgress', (d) => console.log('plantProgress:', Math.round(d.progress * 100) + '%'))

setTimeout(() => {
  console.log(`\n--- stats: snapshots=${gotSnapshot} rounds=${gotRound} ---`)
  process.exit(0)
}, 9000)
