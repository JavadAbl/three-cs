(() => {
  if (window.__buyPoll) clearInterval(window.__buyPoll)
  window.__buyLog = []
  window.__bstep = 0
  window.__bwait = 0
  const log = (m) => window.__buyLog.push(String(m))
  const STEPS = [
    () => { if (__eng.state().phase === 'freeze') { log('FIRE'); window.__bstep = 1 } },
    () => {
      const el = document.querySelector('img[src*="/deagle.png"]')
      if (el) { el.click(); log('clicked'); window.__bstep = 2 } else log('noimg')
    },
    () => {
      if (Object.keys(__eng.ammo().all).includes('deagle')) { log('OWNED w=' + __eng.state().weapon); window.__bstep = 3 }
      else if (window.__bwait++ > 15) { log('never owned'); window.__bstep = 3 }
    },
    () => {
      log('final own=' + Object.keys(__eng.ammo().all).join(',') + ' menu=' + __eng.state().menu)
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'KeyB' }))
      window.__bstep = 4
    },
  ]
  window.__buyPoll = setInterval(() => {
    try { if (window.__bstep < STEPS.length) STEPS[window.__bstep]() }
    catch (e) { log('ERR ' + e.message); window.__bstep = 99 }
  }, 120)
  return 'v7 armed'
})()
