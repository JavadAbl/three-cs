// Verify server startMoney=16000 after the economy restore (hot reload check).
import { io } from 'socket.io-client'

const sock = io('http://localhost:3003', { path: '/' })
let done = false
sock.on('connect', () => {
  sock.emit('join', { name: 'MoneyProbe', room: 'moneytest', team: 'CT', botFill: true, botDifficulty: 'easy', winTarget: 4 })
})
sock.on('init', (d: any) => {
  console.log('[probe] init money =', d.money, '| phase =', d.match?.phase)
  const ok = d.money === 16000
  console.log(ok ? 'PASS startMoney=16000' : `FAIL startMoney=${d.money}`)
  done = true
  sock.disconnect()
  process.exit(ok ? 0 : 1)
})
sock.on('joinError', (d: any) => { console.log('joinError', d); process.exit(1) })
setTimeout(() => { if (!done) { console.log('FAIL: no init within 5s'); process.exit(1) } }, 5000)
