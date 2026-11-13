/* Starts the 3D figure only where it can run.
   The guard in the page head has already checked WebGL2 (a real context), DecompressionStream and the network, put the list of files
   into window.__LF3D (js/figure-data.js, js/wall-data.js unless the line is slow, js/figure.js) and begun to preload them.
   Here they are run in that order. The files themselves are untouched.
   Without the guard's yes none of them is requested and the cut-out image of the figure stays in the page. */
(function () {
  var list = window.__LF3D;
  if (!list || !list.length) return;
  var root = document.documentElement;
  function off() { if (!root.classList.contains('is-3d')) root.classList.remove('wants-3d'); }   // the figure did not start: the cut-out image instead of the soft still
  list.forEach(function (u) {
    var s = document.createElement('script');
    s.src = u; s.async = false;                                               // parallel download, execution in the order of the list
    if (!/wall-data/.test(u)) s.onerror = off;                                // without the wall the figure still runs
    if (/figure\.js/.test(u)) s.onload = function () { setTimeout(off, 15000); };   // a figure that never comes up does not keep the soft still for ever
    document.head.appendChild(s);
  });
})();
