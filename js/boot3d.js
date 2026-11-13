/* Starts the 3D figure only where it can run.
   The guard in the page head has already checked WebGL2 and DecompressionStream, set window.__LF3D and begun to preload the three files
   named in data-3d (js/figure-data.js, js/wall-data.js, js/figure.js). Here they are run in that order. The files themselves are untouched.
   Without WebGL2 none of them is requested and the cut-out image of the figure stays in the page. */
(function () {
  if (!window.__LF3D) return;
  var me = document.currentScript;
  var list = ((me && me.getAttribute('data-3d')) || '').split(' ');
  function off() { document.documentElement.classList.remove('wants-3d'); }   // the figure cannot start: show the cut-out image instead of the soft still
  list.forEach(function (u) {
    if (!u) return;
    var s = document.createElement('script');
    s.src = u; s.async = false;                                               // parallel download, execution in the order of the list
    if (!/wall-data/.test(u)) s.onerror = off;                                // without the wall the figure still runs
    document.head.appendChild(s);
  });
})();
