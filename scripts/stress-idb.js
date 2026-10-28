// Minimal IDB stress repro (Task 81 debugging artifact) — run via:
//   agent-browser eval "$(cat scripts/stress-idb.js)"
// Patterns tested, in order of suspicion for the origin-wide wedge:
//   A. 400 sequential blob puts (the preloader's store pattern)
//   B. 400 sequential reads on the same connection
//   C. a fresh indexedDB.open AFTER the flood (does a new connection still open?)
(function () {
  return new Promise(function (res) {
    var rq = indexedDB.open('idb-stress', 1)
    rq.onupgradeneeded = function () { rq.result.createObjectStore('b') }
    rq.onerror = function () { res('open err') }
    rq.onblocked = function () { res('open BLOCKED') }
    setTimeout(function () { res('OPEN HANGS immediately') }, 3000)
    rq.onsuccess = function () {
      var d = rq.result
      var t0 = Date.now()
      var N = 400, i = 0
      function step() {
        if (i >= N) {
          // B: reads
          var j = 0, t1 = Date.now()
          function rd() {
            if (j >= N) {
              // C: fresh open after the flood
              var rq2 = indexedDB.open('idb-stress')
              setTimeout(function () { res('freshOpen HANGS after flood') }, 3000)
              rq2.onsuccess = function () {
                res('stress done: ' + N + ' puts in ' + (Date.now() - t0) + 'ms, ' + N + ' gets in ' + (Date.now() - t1) + 'ms, fresh open ok')
              }
              rq2.onerror = function () { res('freshOpen err') }
              return
            }
            try {
              var tx = d.transaction('b', 'readonly')
              var g = tx.objectStore('b').get('k' + (j++))
              g.onsuccess = rd
              g.onerror = function () { res('get err at ' + (j - 1)) }
            } catch (e) { res('get throw: ' + String(e)) }
          }
          rd()
          return
        }
        try {
          var tx = d.transaction('b', 'readwrite')
          var buf = new Uint8Array(2048)
          crypto.getRandomValues(buf)
          tx.objectStore('b').put({ ver: 'v1', blob: new Blob([buf]) }, 'k' + (i++))
          tx.oncomplete = step
          tx.onerror = function () { res('tx err at ' + (i - 1)) }
          tx.onabort = function () { res('tx ABORT at ' + (i - 1)) }
        } catch (e) { res('tx throw at ' + (i - 1) + ': ' + String(e)) }
      }
      step()
    }
  })
})().then(function (r) { return JSON.stringify(r) })
