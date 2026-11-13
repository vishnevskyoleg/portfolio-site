/* ==========================================================================
   Cases feed: 62 Dribbble shots in an endless strip.

   Motion:  the strip drifts on its own (one loop in 221 s, as in the mockup).
            Mouse: a quick sweep of the pointer along the strip scrubs it (the strip runs up to
            SCRUB times the pointer's own speed, the covers come to meet the pointer); a slow
            pointer leaves the strip where it is, so a cover can be aimed at. A horizontal
            trackpad swipe scrolls the strip too. Touch: drag with inertia.
   Zoom:    when the pointer rests on a cover, the cover grows ZOOM times over the strip and the
            strip stops; a video shot starts playing (muted, looped). While a cover is open, a
            slow pointer walks from cover to cover and a quick sweep closes it and scrubs again.
            Touch: a tap opens the same view, the next tap or a scroll closes it.
   Only a pointer that has really moved counts: a page scrolled under a still pointer opens nothing.
   Without this file the strip keeps its plain CSS motion (css/style.css, @keyframes feed).
   ========================================================================== */
(function () {
  'use strict';
  /* files of the shots are addressed from this script, not from the page: the page address changes with the language (/ and /ru/) */
  var BASE = (function () { var sc = document.currentScript; try { return new URL('../assets/cases/', sc.src).href; } catch (e) { return 'assets/cases/'; } })();
  var feed = document.querySelector('[data-feed]'); if (!feed) return;
  var track = feed.querySelector('.feed__track'); if (!track) return;
  var items = Array.prototype.slice.call(feed.querySelectorAll('.feed__item'));
  var half = items.length / 2;
  var head = document.querySelector('.cases__h');
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  var ZOOM = 4;            // how many times a cover grows
  var ZOOM_MIN = 3.4;      // it gives up this much to stay clear of the heading of the block (less only where the window is too small)
  var ZOOM_VH = 0.74;      // and never taller than this share of the window
  var SCRUB = 2.8;         // strip travel per pixel of pointer travel, at a full sweep
  var AIM_SPEED = 120;     // px/s of the pointer: below it the strip does not answer at all
  var SWEEP_SPEED = 720;   // px/s of the pointer: from here on the scrub works in full
  var LOOP_S = 221;        // seconds per loop when nobody touches the strip
  var REST_SPEED = 60;     // px/s: below it the pointer counts as resting on a cover
  var REST_TIME = 0.08;    // s of rest before the cover opens
  var STRIP_REST = 180;    // px/s: the strip must have slowed down to this before a cover opens
  var FLEE_SPEED = 480;    // px/s of the pointer: above it an open cover closes and the scrub takes over
  var STEP_SPEED = 480;    // px/s of the pointer: below it an open view moves over to the cover under the pointer
  var STEP_TIME = 0.06;    // s on that cover before it does
  var VIDEO_WAIT = 160;    // ms an opened cover waits before its video is asked for

  var titles = {};
  items.forEach(function (it) { var a = it.dataset.title || it.getAttribute('alt'); if (a && !titles[it.dataset.n]) titles[it.dataset.n] = a; });

  /* ---------- the strip ---------- */
  var period = 0, pos = 0, base = 0, push = 0, hold = 0;
  var lefts = [], widths = [];
  var inside = false, px = -1, py = -1, pt = 0, vx = 0, sp = 0, still = 0, visible = false, raf = 0, prev = 0;
  var stepOn = null, stepT = 0, calmTimer = 0, tapT = 0;
  var drag = null;

  function measure() {
    if (items[half]) period = items[half].offsetLeft - items[0].offsetLeft;
    lefts = items.map(function (it) { return it.offsetLeft; });
    widths = items.map(function (it) { return it.offsetWidth; });
  }
  function auto() { return period > 0 ? period / LOOP_S : 0; }
  function place() {
    if (period > 0) { pos %= period; if (pos < 0) pos += period; }
    track.style.transform = 'translate3d(' + (-pos).toFixed(2) + 'px,0,0)';
  }
  function ramp(a) { var k = Math.max(0, Math.min(1, (a - AIM_SPEED) / (SWEEP_SPEED - AIM_SPEED))); return k * k * (3 - 2 * k); }

  function frame(t) {
    raf = 0; if (!visible || calm.matches) return;
    var dt = Math.min(0.05, (t - (prev || t)) / 1000); prev = t;
    if (!period) measure();
    if (performance.now() - pt > 40) { var q = Math.exp(-dt * 30); vx *= q; sp *= q; }   // no news from the pointer: it has stopped
    if (!drag) {
      hold = Math.max(0, hold - dt);
      var want = (inside || hold > 0 || zoomed) ? 0 : auto();
      base += (want - base) * (1 - Math.exp(-dt * 3.5));          // the drift eases in and out
      if (inside) {
        if (zoomed && !byTap && Math.abs(vx) > FLEE_SPEED) close();
        var aim = zoomed ? 0 : vx * SCRUB * ramp(Math.abs(vx));    // an open cover holds the strip
        if (Math.abs(aim) > Math.abs(push) || aim * push < 0) push += (aim - push) * (1 - Math.exp(-dt * 16));
        else push *= Math.exp(-dt * 11);
        push = Math.max(-5600, Math.min(5600, push));
      } else push *= Math.exp(-dt * 2.6);                          // a swipe glides out
      if (Math.abs(push) < 2) push = 0;
      pos += (base + push) * dt;
      place();
    }
    /* a cover opens under a pointer that has come to rest; an open one follows a slow pointer */
    if (inside && !drag && !byTap) {
      if (sp < REST_SPEED && Math.abs(push) < STRIP_REST) still += dt; else still = 0;
      var it = under(px, py);
      if (!zoomed) { if (still > REST_TIME && it) { push = 0; openOn(it); } }
      else if (it && it !== zoomed && sp < STEP_SPEED) {
        if (stepOn !== it) { stepOn = it; stepT = 0; }
        stepT += dt; if (stepT > STEP_TIME) openOn(it);
      } else stepOn = null;
    }
    raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && visible && !calm.matches) { prev = 0; raf = requestAnimationFrame(frame); } }

  /* the cover at a point of the window; a point in a gap belongs to the nearer cover */
  function under(x, y) {
    var r = feed.getBoundingClientRect();
    if (y < r.top || y > r.bottom || x < r.left || x > r.right) return null;
    if (!lefts.length) measure();
    var tx = x - r.left + (calm.matches ? feed.scrollLeft : pos), best = null, far = 8;
    for (var i = 0; i < items.length; i++) {
      if (!widths[i]) continue;
      var d = tx < lefts[i] ? lefts[i] - tx : tx > lefts[i] + widths[i] ? tx - lefts[i] - widths[i] : 0;
      if (d < far) { far = d; best = items[i]; if (!d) break; }
    }
    return best;
  }

  /* mouse: every real move is read on the window, so a page scrolled under a still pointer is not a move */
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    if (e.clientX === px && e.clientY === py) return;
    var now = performance.now(), on = !!(e.target && e.target.closest && e.target.closest('[data-feed]'));
    if (px >= 0 && now - pt < 120) {
      var dt = Math.max(0.004, (now - pt) / 1000), k = 1 - Math.exp(-dt / 0.045);
      vx += ((e.clientX - px) / dt - vx) * k;
      sp += (Math.sqrt((e.clientX - px) * (e.clientX - px) + (e.clientY - py) * (e.clientY - py)) / dt - sp) * k;
    } else { vx = 0; sp = on && !inside ? 400 : 0; }               // arriving in one jump is not a rest yet
    px = e.clientX; py = e.clientY; pt = now;
    if (on && !inside) { inside = true; still = 0; stepOn = null; wake(); }
    else if (!on && inside) leave();
  }, { passive: true });
  function leave() { inside = false; vx = 0; still = 0; stepOn = null; clearTimeout(calmTimer); if (!byTap) close(); }
  document.documentElement.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { px = py = -1; if (inside) leave(); } });
  /* a click does not wait for the pointer to rest */
  feed.addEventListener('click', function (e) {
    if (calm.matches || byTap || performance.now() - tapT < 700) return;
    var it = under(e.clientX, e.clientY); if (it && it !== zoomed) { push = 0; inside = true; openOn(it); wake(); }
  });

  /* trackpad: a horizontal swipe scrolls the strip */
  feed.addEventListener('wheel', function (e) {
    if (calm.matches || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault(); pos += e.deltaX * (e.deltaMode === 1 ? 16 : 1); hold = 1.2; still = 0; push = 0; if (zoomed) close(); place(); wake();
  }, { passive: false });

  /* touch: drag with inertia, tap opens a cover */
  feed.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' || calm.matches) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, t: performance.now(), t0: performance.now(), v: 0, moved: false };
    push = 0; inside = false;
  });
  feed.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var now = performance.now(), dx = e.clientX - drag.x, dt = Math.max(0.008, (now - drag.t) / 1000);
    if (Math.abs(e.clientX - drag.x0) > 8) { drag.moved = true; if (zoomed) close(); }
    pos -= dx; drag.v += (-dx / dt - drag.v) * 0.5; drag.x = e.clientX; drag.t = now; place();
  });
  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (e.type === 'pointerup' && !d.moved && performance.now() - d.t0 < 400) {
      var it = under(e.clientX, e.clientY); tapT = performance.now();
      if (it && it !== zoomed) { openOn(it, true); hold = 1e6; } else close();
      wake(); return;
    }
    /* a finger that stopped before lifting leaves the strip where it is; so does the page taking the gesture over */
    var fling = e.type === 'pointerup' && d.moved && performance.now() - d.t < 140;
    push = fling ? Math.max(-5000, Math.min(5000, d.v)) : 0; hold = 1.4; base = 0; wake();
  }
  feed.addEventListener('pointerup', release);
  feed.addEventListener('pointercancel', release);

  /* ---------- the open cover: two boxes, so that one can leave while the next one arrives ---------- */
  function make() {
    var el = document.createElement('div'); el.className = 'zoom'; el.setAttribute('aria-hidden', 'true');
    var pic = document.createElement('img'); pic.className = 'zoom__img'; pic.alt = ''; pic.decoding = 'async';
    var vid = document.createElement('video'); vid.className = 'zoom__video'; vid.muted = true; vid.loop = true; vid.playsInline = true;
    vid.setAttribute('muted', ''); vid.setAttribute('playsinline', ''); vid.preload = 'none'; vid.tabIndex = -1;
    var bar = document.createElement('i'); bar.className = 'zoom__bar';
    el.appendChild(pic); el.appendChild(vid); el.appendChild(bar); document.body.appendChild(el);
    var b = { el: el, pic: pic, vid: vid, bar: bar, item: null, geo: null, wait: 0, tidy: 0 };
    pic.addEventListener('load', function () { pic.classList.add('is-ready'); });
    vid.addEventListener('playing', function () { vid.classList.add('is-playing'); });
    vid.addEventListener('timeupdate', function () { if (vid.duration) bar.style.transform = 'scaleX(' + Math.min(1, vid.currentTime / vid.duration).toFixed(3) + ')'; });
    el.addEventListener('click', function () { if (byTap && performance.now() - tapT > 500) close(); });   // a tap on the open cover closes it (not the tap that opened it)
    return b;
  }
  var boxes = [make(), make()], cur = null, zoomed = null, byTap = false;
  var cap = document.createElement('p'); cap.className = 'zoom-cap'; cap.setAttribute('aria-hidden', 'true');
  var capN = document.createElement('span'); capN.className = 'zoom-cap__n'; var capT = document.createElement('span');
  cap.appendChild(capN); cap.appendChild(capT); document.body.appendChild(cap);
  /* a cover opened by a tap is looked at on its own: the page behind it goes dark, any tap closes it */
  var shade = document.createElement('div'); shade.className = 'zoom-shade'; shade.setAttribute('aria-hidden', 'true'); document.body.appendChild(shade);
  shade.addEventListener('click', function () { if (performance.now() - tapT > 500) close(); });

  function stopVideo(b) {
    clearTimeout(b.wait);
    b.vid.classList.remove('is-playing'); b.bar.style.transform = '';
    try { b.vid.pause(); } catch (e) {}
    if (b.vid.getAttribute('src')) { b.vid.removeAttribute('src'); try { b.vid.load(); } catch (e) {} }
  }
  function from(it, g) {                                             // the box drawn exactly over its cover
    var r = it.getBoundingClientRect();
    return 'translate3d(' + (r.left - g[2]).toFixed(1) + 'px,' + (r.top - g[3]).toFixed(1) + 'px,0) scale(' + (r.width / g[0]).toFixed(4) + ',' + (r.height / g[1]).toFixed(4) + ')';
  }
  function openOn(it, tap) {
    var r = it.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var m = vw < 600 ? 0 : 16, mt = 16, mb = 16 + 30;                // the caption sits under the picture
    var k = Math.min(ZOOM, (vw - m * 2) / r.width, (vh - mt - mb) / r.height, vh * ZOOM_VH / r.height);
    /* the picture grows down from the strip and keeps the heading of the block clear while the window lets it */
    var hb = head ? Math.min(r.top, head.getBoundingClientRect().bottom) : -1e6;
    k = Math.max(1, Math.min(k, Math.max(ZOOM_MIN, (vh - mb - hb) / r.height)));
    var w = r.width * k, h = r.height * k;
    var left = Math.max(m, Math.min(vw - m - w, r.left + r.width / 2 - w / 2));
    var top = Math.min(r.top, Math.max(r.top + r.height / 2 - h / 2, hb));
    top = Math.max(mt, Math.min(vh - mb - h, top));
    var n = it.dataset.n, b = cur === boxes[0] ? boxes[1] : boxes[0], el = b.el;
    if (cur) shut(cur);
    clearTimeout(b.tidy); stopVideo(b);
    cur = b; b.item = it; b.geo = [w, h, left, top]; zoomed = it; byTap = !!tap; stepOn = null;
    b.pic.classList.remove('is-ready'); b.pic.removeAttribute('src');
    document.body.insertBefore(el, (b === boxes[0] ? boxes[1] : boxes[0]).el);   // the open box is the first .zoom of the page
    el.style.transition = 'none';
    el.style.zIndex = 7;
    el.style.width = w.toFixed(1) + 'px'; el.style.height = h.toFixed(1) + 'px';
    el.style.left = left.toFixed(1) + 'px'; el.style.top = top.toFixed(1) + 'px';
    el.style.backgroundImage = 'url("' + (it.currentSrc || it.src) + '")';        // the small cover at once, the large one over it
    el.style.transform = from(it, b.geo);
    el.classList.add('is-open'); el.classList.toggle('is-tap', byTap); shade.classList.toggle('is-open', byTap); feed.classList.add('is-zoom');
    void el.offsetWidth;
    el.style.transition = '';
    el.style.transform = 'none';
    b.pic.src = BASE + 'full/' + n + '.jpg';
    if (it.dataset.video) b.wait = setTimeout(function () {             // a pointer just passing by does not start a download
      if (b.item !== it || cur !== b) return;
      b.vid.src = BASE + 'video/' + n + '.mp4';
      var p = b.vid.play(); if (p && p.catch) p.catch(function () {});
    }, VIDEO_WAIT);
    capN.textContent = n; capT.textContent = titles[n] || '';
    cap.style.left = Math.max(16, left).toFixed(1) + 'px'; cap.style.top = (top + h).toFixed(1) + 'px';
    cap.style.maxWidth = (Math.min(vw - 16, left + w) - Math.max(16, left)).toFixed(1) + 'px';
    cap.classList.add('is-open');
  }
  function shut(b) {
    var it = b.item; if (!it) return;
    b.item = null; clearTimeout(b.wait);
    b.el.style.zIndex = ''; b.el.classList.remove('is-open'); b.el.classList.remove('is-tap');
    if (b.geo && it.isConnected) b.el.style.transform = from(it, b.geo);
    clearTimeout(b.tidy);
    b.tidy = setTimeout(function () { stopVideo(b); b.pic.removeAttribute('src'); b.pic.classList.remove('is-ready'); }, 320);
  }
  function close() {
    if (!zoomed) return;
    zoomed = null; byTap = false; still = 0; stepOn = null; if (hold > 10) hold = 0.6;
    if (cur) shut(cur); cur = null;
    feed.classList.remove('is-zoom'); cap.classList.remove('is-open'); shade.classList.remove('is-open');
  }

  /* a scroll takes the strip from under the pointer: nothing opens until the pointer really moves again */
  window.addEventListener('scroll', function () { inside = false; still = 0; clearTimeout(calmTimer); if (zoomed) close(); }, { passive: true });
  feed.addEventListener('scroll', function () { clearTimeout(calmTimer); if (zoomed) close(); }, { passive: true });
  window.addEventListener('blur', function () { inside = false; close(); });
  document.addEventListener('pointerdown', function (e) { if (zoomed && byTap && !e.target.closest('[data-feed], .zoom, .zoom-shade')) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  /* ---------- start ---------- */
  function mode() {
    var on = !calm.matches;
    track.style.animation = on ? 'none' : '';                       // the script moves the strip itself
    if (!on) { track.style.transform = ''; close(); }
    feed.classList.toggle('is-live', on);
    measure(); wake();
  }
  if (calm.addEventListener) calm.addEventListener('change', mode); else if (calm.addListener) calm.addListener(mode);
  window.addEventListener('resize', function () { var k = period; measure(); if (k > 0 && period > 0) pos *= period / k; close(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (!visible) close(); wake(); }, { rootMargin: '200px 0px' }).observe(feed);
  } else visible = true;
  document.addEventListener('visibilitychange', function () { if (document.hidden) close(); else wake(); });
  mode();

  /* with reduced motion the strip is scrolled by hand; a cover still opens under a resting pointer or a click or tap */
  feed.addEventListener('pointermove', function (e) {
    if (!calm.matches || e.pointerType !== 'mouse') return;
    clearTimeout(calmTimer); var x = e.clientX, y = e.clientY;
    calmTimer = setTimeout(function () { var it = under(x, y); if (it && it !== zoomed) openOn(it); }, 160);
  });
  feed.addEventListener('click', function (e) {
    if (!calm.matches) return;
    clearTimeout(calmTimer);
    var it = under(e.clientX, e.clientY); tapT = performance.now() - 450; if (it && it !== zoomed) openOn(it, true); else close();
  });
})();
