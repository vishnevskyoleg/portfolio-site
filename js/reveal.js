/* ==========================================================================
   Scroll reveals — type is "printed" from under a mask and then stands still.
   No opacity fades. Works without libraries; if this file fails, the inline
   guard in the page shows everything after 3 s (html.rv-all).
   ========================================================================== */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!root.classList.contains('rv')) return;
  var EASE_DESKTOP = window.matchMedia('(min-width: 1080px)');

  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  /* ---- display headings: one mask per letter ---- */
  function splitChars(node) {
    var text = node.textContent; node.setAttribute('aria-label', text.trim()); node.textContent = '';
    var i = 0;
    text.split(' ').forEach(function (word, wi, arr) {
      var w = el('span', 'wd'); w.setAttribute('aria-hidden', 'true');
      word.split('').forEach(function (ch) {
        var m = el('span', 'ch'), inner = el('span'); inner.textContent = ch; inner.style.setProperty('--i', i++);
        m.appendChild(inner); w.appendChild(m);
      });
      node.appendChild(w);
      if (wi < arr.length - 1) node.appendChild(document.createTextNode(' '));
    });
  }

  /* ---- paragraphs: one mask per rendered line (re-measured on resize) ---- */
  function splitLines(node) {
    if (node.__src == null) node.__src = node.innerHTML;
    node.innerHTML = node.__src;
    var tokens = [];
    (function walk(n) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) c.textContent.split(/(\s+)/).forEach(function (t) { if (t.trim()) tokens.push(t); });
        else if (c.nodeName === 'BR') tokens.push('\n');
        else walk(c);
      });
    })(node);
    node.textContent = '';
    var spans = tokens.map(function (t) {
      if (t === '\n') { node.appendChild(document.createElement('br')); return null; }
      var s = el('span', 'w'); s.textContent = t; node.appendChild(s); node.appendChild(document.createTextNode(' ')); return s;
    });
    var lines = [], top = null, cur = null;
    spans.forEach(function (s) {
      if (!s) { top = null; return; }
      var y = s.offsetTop;
      if (top === null || Math.abs(y - top) > 2) { cur = []; lines.push(cur); top = y; }
      cur.push(s.textContent);
    });
    node.textContent = '';
    lines.forEach(function (words, i) {
      var ln = el('span', 'ln ln--fixed'), inner = el('span'); inner.textContent = words.join(' '); inner.style.setProperty('--i', i);
      ln.appendChild(inner); node.appendChild(ln);
    });
  }

  /* ---- list rows: each row is its own mask ---- */
  function wrapRow(node, i) {
    var ln = el('span', 'ln'), inner = el('span'); inner.style.setProperty('--i', i);
    while (node.firstChild) inner.appendChild(node.firstChild);
    ln.appendChild(inner); node.appendChild(ln);
  }

  /* ---- photos: frame wipes open, the picture settles inside ---- */
  function framePhoto(img) {
    var frame = el('div', img.className + ' ph'); img.className = 'ph__img';
    img.parentNode.insertBefore(frame, img); frame.appendChild(img);
    return frame;
  }

  var groups = [], lineNodes = [];
  document.querySelectorAll('.display').forEach(function (h) {
    splitChars(h.querySelector('[data-fit]') || h); groups.push(h);
  });
  document.querySelectorAll('.lead, .statement p, .note, .hello, .credits__clients p').forEach(function (p) {
    lineNodes.push(p); splitLines(p); groups.push(p);
  });
  document.querySelectorAll('.list, .block ul').forEach(function (ul) {
    Array.prototype.forEach.call(ul.children, wrapRow); groups.push(ul);
  });
  document.querySelectorAll('.block__title').forEach(function (t) { wrapRow(t, 0); groups.push(t); });
  var frames = Array.prototype.map.call(document.querySelectorAll('img.photo'), framePhoto);
  frames.forEach(function (f) { groups.push(f); });
  var badge = document.querySelector('.badge'); if (badge) groups.push(badge);
  groups.forEach(function (g) { g.classList.add('rv-item'); });
  window.dispatchEvent(new Event('resize')); // the title is re-fitted after the split

  /* ---- trigger: every time the element comes into the screen (it hides again once it is fully out) ---- */
  function show(g) { g.classList.add('in'); clearTimeout(g.__t); g.__t = setTimeout(function () { g.classList.add('settled'); }, 1300); }
  function hide(g) { clearTimeout(g.__t); g.classList.remove('in', 'settled'); }
  if ('IntersectionObserver' in window) {
    var enter = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) show(e.target); });
    }, { threshold: 0.12, rootMargin: '0px 0px -12% 0px' });
    var leave = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (!e.isIntersecting) hide(e.target); });
    }, { threshold: 0, rootMargin: '12% 0px 12% 0px' });
    var start = function () { groups.forEach(function (g) { enter.observe(g); leave.observe(g); }); root.classList.add('rv-ready'); };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(start, 120); });
  } else { groups.forEach(show); root.classList.add('rv-ready'); }

  /* ---- lines are re-measured when the width changes ---- */
  var lastW = window.innerWidth, timer = 0;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return; lastW = window.innerWidth;
    clearTimeout(timer); timer = setTimeout(function () { lineNodes.forEach(splitLines); }, 180);
  });

  /* ---- the layer never stands still: every block has its own depth.
          Scroll moves near blocks faster than far ones, the cursor shifts them the other way,
          fast scroll stretches the big headings; photos also drift inside their frames. ---- */
  var layers = [];
  function layer(sel, depth) { document.querySelectorAll(sel).forEach(function (n) { layers.push({ n: n, d: depth, y: 0 }); }); }
  layer('.hello', 0.05); layer('.roles', -0.03); layer('.lead', 0.025); layer('.note--1', -0.02); layer('.note--2', 0.035);
  layer('.focus__a', 0.04); layer('.focus__b', -0.035); layer('.focus__c', 0.03); layer('.focus__d', -0.025); layer('.focus__e', 0.05);
  layer('.credits__awards', -0.03); layer('.credits__clients', 0.045); layer('.credits__tools', -0.025); layer('.statement p', 0.02);
  layer('.photo--a', -0.07); layer('.photo--b', 0.06); layer('.photo--c', -0.09); layer('.photo--d', 0.075); layer('.photo--e', -0.06);
  layer('.badge', 0.1);
  var heads = Array.prototype.slice.call(document.querySelectorAll('.display'));
  var speeds = [0.07, -0.05, 0.09, -0.06, 0.08];
  var h1 = document.querySelector('.focus__h1'), h2 = document.querySelector('.focus__h2');
  var mx = 0, my = 0, tx = 0, ty = 0, lastY = window.scrollY, vel = 0, prevT = 0;
  window.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') { tx = e.clientX / window.innerWidth - 0.5; ty = e.clientY / window.innerHeight - 0.5; } });
  function scrub(now) {
    var vh = window.innerHeight, dt = Math.min(0.05, (now - prevT) / 1000 || 0.016); prevT = now;
    var k = EASE_DESKTOP.matches ? 1 : 0.45;
    mx += (tx - mx) * Math.min(1, dt * 4); my += (ty - my) * Math.min(1, dt * 4);
    var sy = window.scrollY, v = (sy - lastY) / dt; lastY = sy; vel += (v - vel) * Math.min(1, dt * 8);
    layers.forEach(function (L) {
      var r = L.n.getBoundingClientRect(); if (r.bottom < -200 || r.top > vh + 200) return;
      var c = r.top - L.y + r.height / 2;                       // centre without our own shift
      L.y = (c - vh / 2) * L.d * k;
      L.n.style.translate = (-mx * L.d * 420 * k).toFixed(1) + 'px ' + (L.y - my * L.d * 200 * k).toFixed(1) + 'px';
    });
    var stretch = Math.min(0.14, Math.abs(vel) / 22000);
    heads.forEach(function (h) { h.style.scale = '1 ' + (1 + stretch).toFixed(3); });
    frames.forEach(function (f, i) {
      var r = f.getBoundingClientRect(); if (r.bottom < -100 || r.top > vh + 100) return;
      f.firstChild.style.setProperty('--py', ((r.top + r.height / 2 - vh / 2) * speeds[i % speeds.length]).toFixed(1) + 'px');
    });
    if (badge) badge.style.setProperty('--rot', (sy * 0.12).toFixed(1) + 'deg');
    if (h1 && h2 && EASE_DESKTOP.matches) {
      var r1 = h1.getBoundingClientRect(), p = Math.min(1, Math.max(0, (vh - r1.top) / (vh * 0.75)));
      var x = (1 - p) * 60;
      h1.style.setProperty('--sx', x.toFixed(1) + 'px'); h2.style.setProperty('--sx', (-x).toFixed(1) + 'px');
    }
    requestAnimationFrame(scrub);
  }
  requestAnimationFrame(scrub);
})();
