/* NeoSpace PWA rescue — chunk-load failures only (avoids wipe loops). */
(function () {
  try {
    var K = 'neospace_sw_rescue'
    function rescue() {
      try {
        if (sessionStorage.getItem(K)) return
        sessionStorage.setItem(K, '1')
        var done = function () {
          location.reload()
        }
        if (!('serviceWorker' in navigator)) {
          done()
          return
        }
        navigator.serviceWorker
          .getRegistrations()
          .then(function (rs) {
            return Promise.all(
              rs.map(function (r) {
                return r.unregister()
              }),
            )
          })
          .then(function () {
            if (!window.caches) return
            return caches.keys().then(function (keys) {
              return Promise.all(
                keys.map(function (k) {
                  return caches.delete(k)
                }),
              )
            })
          })
          .finally(done)
      } catch (e) {
        location.reload()
      }
    }
    function bad(msg) {
      return /Loading chunk|Failed to fetch dynamically|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(
        String(msg || ''),
      )
    }
    window.addEventListener('error', function (e) {
      var msg = (e && e.message) || ''
      if (bad(msg)) rescue()
    })
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason
      bad((r && r.message) || r) && rescue()
    })
    setTimeout(function () {
      var el = document.getElementById('__nuxt')
      if (el && !el.querySelector('.neo-layout') && !sessionStorage.getItem(K)) rescue()
    }, 12000)
  } catch (e) {}
})()
