/* Starts the 3D figure only where it can run.
   The guard in the page head has already checked WebGL2 (a real context), DecompressionStream and the network, put the list of files
   into window.__LF3D (js/figure-data.js, js/wall-data.js unless the line is slow, js/figure.js) and begun to preload them.
   Here they are run in that order. The files themselves are untouched.
   Without the guard's yes none of them is requested and the cut-out image is shown by CSS.
   On the 3D path the slot stays empty until the particles assemble. */
(function () {
  var list = window.__LF3D;
  if (!list || !list.length) return;
  var root = document.documentElement;
  function off() { if (!root.classList.contains('is-3d')) root.classList.remove('wants-3d'); }
  // If a running WebGL context is lost, show the cut-out until the figure returns.
  var was = false;
  if (window.MutationObserver) new MutationObserver(function () {
    var on = root.classList.contains('is-3d');
    if (was && !on) root.classList.remove('wants-3d');
    was = on;
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  list.forEach(function (u) {
    var s = document.createElement('script');
    s.src = u; s.async = false;                                               // parallel download, execution in the order of the list
    if (!/wall-data/.test(u)) s.onerror = off;                                // without the wall the figure still runs
    if (/figure\.js/.test(u)) s.onload = function () { setTimeout(off, 15000); };   // a figure that never comes up does not leave the slot empty for ever
    document.head.appendChild(s);
  });
})();
