/* ==========================================================================
   Top layer of the page: two languages, the language switch, reveals, the cases feed.

   Languages: js/i18n.js → window.LF_I18N. English is the default; "#ru" in the
              address opens the Russian version. Elements carry data-i18n="key".
   Reveals:   text is "printed" from under a mask once, when it first comes into the
              screen, and then stands still. Nothing is moved on scroll, so photos
              cannot jitter; a photo opens only after it has been loaded and decoded.
   Fonts:     a text is measured (letters, lines, the title) only with the faces it is
              shown in; faces that arrive later make the measuring run again.
   Without this file the inline guard in the page shows everything after 3 s.
   ========================================================================== */
(function () {
  'use strict';
  var root = document.documentElement;
  var DICT = window.LF_I18N || {};
  var rv = root.classList.contains('rv');           // false with reduced motion: no masks at all
  var desktop = window.matchMedia('(min-width: 1080px)');
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  var TITLE_W = 1422.73 / 1440;                        // width of "LOVELY&FRIENDLY" in the 1440 frame (Figma)
  var served = root.lang === 'ru' ? 'ru' : 'en';        // language of the page as it was served (/ or /ru/)
  var lang = served;                                  // language of the texts on the page
  var want = served;                                  // language chosen in the switch (the texts follow 0.3 s later)
  var listeners = [];

  function make(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function all(sel, from) { return Array.prototype.slice.call((from || document).querySelectorAll(sel)); }
  function noop() {}
  /* a promise that is not waited for longer than `ms` */
  function within(promise, ms) {
    return new Promise(function (done) { var t = setTimeout(done, ms), end = function () { clearTimeout(t); done(); }; promise.then(end, end); });
  }

  /* ---------- dictionary ---------- */
  function text(key, lg) { var e = DICT[key]; return e ? e[lg || lang] : ''; }
  function source(key, lg) {
    var e = DICT[key]; if (!e) return null;
    var v = e[lg];
    return e.kind === 'rows' ? v.map(function (x) { return '<li>' + x + '</li>'; }).join('') : v;
  }

  /* ---------- fonts ---------- */

  /* The faces a language needs (Cyrillic ones are separate files that the browser fetches only
     when it meets the first Cyrillic letter). Asked for before the texts are put in, so that
     nothing is measured with a fallback face. */
  var asked = {};
  function faces(lg) {
    if (asked[lg]) return asked[lg];
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var need = {};
    all('[data-i18n]').forEach(function (n) {
      var src = source(n.dataset.i18n, lg); if (src == null) return;
      var cs = getComputedStyle(n), txt = src.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
      var font = cs.fontStyle + ' ' + cs.fontWeight + ' 16px ' + cs.fontFamily.split(',')[0];
      need[font] = (need[font] || '') + txt + txt.toUpperCase();
    });
    return (asked[lg] = Promise.all(Object.keys(need).map(function (f) { return document.fonts.load(f, need[f]); })).then(noop, noop));
  }

  /* ---------- splitting ---------- */

  /* Display headings: one mask per letter. Letters become inline blocks, which drops the kerning
     of the face; kern() gives it back. */
  function splitChars(node) {
    var holder = make('span'), tmp = make('span'), label = [], idx = 0;
    holder.setAttribute('aria-hidden', 'true');
    var lines = node.__src.split(/<br\s*\/?>/i);
    lines.forEach(function (lineHtml, li) {
      tmp.innerHTML = lineHtml;
      var words = tmp.textContent.replace(/\s+/g, ' ').trim();
      label.push(words);
      words.split(' ').forEach(function (word, wi) {
        if (!word) return;
        if (wi) holder.appendChild(document.createTextNode(' '));
        var w = make('span', 'wd');
        word.split('').forEach(function (ch) {
          var m = make('span', 'ch'), inner = make('span'); inner.textContent = ch; inner.style.setProperty('--i', idx++);
          m.__line = li; m.appendChild(inner); w.appendChild(m);
        });
        holder.appendChild(w);
      });
      if (li < lines.length - 1) holder.appendChild(make('br'));
    });
    /* The letters are hidden from screen readers, so the text is given once more as a name: on the heading or
       link itself (aria-label), so that the text stays in the page once, not twice, for search engines too. */
    var host = node.closest('h1,h2,h3,a,button');
    node.textContent = '';
    if (host) host.setAttribute('aria-label', label.join(' ').replace(/\u00a9/g, 'o'));   // "Hell©" is read as "Hello", not as a copyright sign
    else { var sr = make('span', 'sr'); sr.textContent = label.join(' '); node.appendChild(sr); }
    node.appendChild(holder);
    kern(node);
  }

  /* The natural place of every letter is measured on a hidden copy of the plain text and given
     back as a margin in em: the heading keeps exactly the width it has in the mockup. The letter
     boxes are not rebuilt, so this can run again at any time (a late font) without touching a
     running reveal. */
  function kern(node) {
    var cells = all('.ch', node); if (!cells.length || node.__src == null) return;
    var fs = parseFloat(getComputedStyle(node).fontSize) || 1;
    var probe = make('span'); probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;pointer-events:none';
    probe.innerHTML = node.__src; node.appendChild(probe);
    var natural = [], range = document.createRange();
    (function walk(n) {
      Array.prototype.forEach.call(n.childNodes, function (c) {
        if (c.nodeType === 3) {
          for (var i = 0; i < c.length; i++) {
            if (/\s/.test(c.data[i])) continue;
            range.setStart(c, i); range.setEnd(c, i + 1);
            natural.push(range.getBoundingClientRect().left);
          }
        } else if (c.nodeName !== 'BR') walk(c);
      });
    })(probe);
    cells.forEach(function (c) { if (c.style.marginLeft) c.style.marginLeft = ''; });
    if (natural.length === cells.length) {              // otherwise unexpected markup: the plain split stays
      var actual = cells.map(function (c) { return c.getBoundingClientRect().left; });
      for (var i = 1; i < cells.length; i++) {
        if (cells[i].__line !== cells[i - 1].__line) continue;
        var d = (natural[i] - natural[i - 1]) - (actual[i] - actual[i - 1]);
        if (Math.abs(d) > 0.04) cells[i].style.marginLeft = (d / fs).toFixed(4) + 'em';
      }
    }
    node.removeChild(probe);
  }

  /* Paragraphs: one mask per rendered line. The lines are fixed only for the time of the reveal;
     after it the paragraph is plain text again (see settle), so it wraps by itself at any width. */
  function splitLines(node) {
    node.innerHTML = node.__src;
    var parts = [];                                     // { t: text, glue: no space after it } or null for a <br>
    (function walk(n) {
      Array.prototype.forEach.call(n.childNodes, function (c) {
        if (c.nodeType === 3) c.textContent.split(/\s+/).forEach(function (word) {
          if (!word) return;
          var bits = word.match(/[^-]+-*|-+/g) || [word];     // a line may also break after a hyphen: "digital-" / "продукты"
          bits.forEach(function (b, i) { parts.push({ t: b, glue: i < bits.length - 1 }); });
        });
        else if (c.nodeName === 'BR') parts.push(null);
        else walk(c);
      });
    })(node);
    node.textContent = '';
    var spans = parts.map(function (p) {
      if (!p) { node.appendChild(make('br')); return null; }
      var s = make('span'); s.textContent = p.t; node.appendChild(s);
      if (!p.glue) node.appendChild(document.createTextNode(' '));
      return s;
    });
    var lines = [], top = null;
    spans.forEach(function (s, i) {
      if (!s) { top = null; return; }
      var y = s.offsetTop;
      if (top === null || Math.abs(y - top) > 2) { lines.push(''); top = y; }
      lines[lines.length - 1] += parts[i].t + (parts[i].glue ? '' : ' ');
    });
    node.textContent = '';
    lines.forEach(function (words, i) {
      var ln = make('span', 'ln ln--fixed'), inner = make('span'); inner.textContent = words.trim(); inner.style.setProperty('--i', i);
      ln.appendChild(inner); node.appendChild(ln);
    });
  }

  /* Rows: every list row (or a single line such as a link) is its own mask. */
  function wrapRow(node, i) {
    if (node.firstElementChild && node.firstElementChild.classList.contains('ln')) return;
    var ln = make('span', 'ln'), inner = make('span'); inner.style.setProperty('--i', i);
    while (node.firstChild) inner.appendChild(node.firstChild);
    ln.appendChild(inner); node.appendChild(ln);
  }

  function build(node) {
    var kind = node.dataset.rv;
    if (kind === 'chars') splitChars(node);
    else if (kind === 'lines') splitLines(node);
    else if (kind === 'rows') { if (node.dataset.i18n) node.innerHTML = node.__src; Array.prototype.forEach.call(node.children, wrapRow); }
    else if (kind === 'row') wrapRow(node, 0);
    node.classList.add('rv-item');
  }

  /* Faces that arrived after a text was measured (a slow network, the 1.8 s limit below): the
     title is fitted again, the letters are kerned again, paragraphs not shown yet are split again. */
  function refit() {
    if (rv) {
      all('[data-rv="chars"].rv-item').forEach(kern);
      all('[data-rv="lines"].rv-item:not(.in)').forEach(splitLines);
    }
    fitTitle();
  }

  /* ---------- language ---------- */
  function fill(node, lg) {
    var key = node.dataset.i18n, kind = node.dataset.rv, src = source(key, lg);
    if (src == null || node.__lang === lg) return;
    var same = node.__lang && source(key, node.__lang) === src;     // e.g. the title: one text for both languages
    node.__lang = lg;
    if (same) return;
    if (kind === 'chars' || kind === 'lines' || kind === 'rows') {
      node.__src = src;
      var plain = !rv || !node.classList.contains('rv-item') || (kind === 'lines' && node.classList.contains('settled'));
      if (plain) node.innerHTML = src; else build(node);
    } else {
      var inner = node.querySelector('.ln > span');   // a plain label inside a row mask
      (inner || node).innerHTML = src;
    }
  }
  function applyLang(lg) {
    lang = lg; root.lang = lg;
    all('[data-i18n]').forEach(function (n) { fill(n, lg); });
    all('[data-i18n-attr]').forEach(function (n) {
      n.dataset.i18nAttr.split(',').forEach(function (pair) { var p = pair.split(':'); n.setAttribute(p[0].trim(), text(p[1].trim(), lg)); });
    });
    if (DICT.meta_title) document.title = text('meta_title', lg);
    if (pages && pages[lg]) all('link[rel="canonical"], meta[property="og:url"]').forEach(function (n) { n.setAttribute(n.tagName === 'LINK' ? 'href' : 'content', pages[lg]); });
    fitTitle();
    listeners.forEach(function (fn) { fn(lg); });
  }
  function changes(n, lg) { return source(n.dataset.i18n, lang) !== source(n.dataset.i18n, lg); }
  function inView(n) { var r = n.getBoundingClientRect(); return r.bottom > -40 && r.top < window.innerHeight + 40; }
  /* blocks the stylesheet places differently in the other language (the same text on other coordinates) */
  function movers(items, lg) {
    if (!desktop.matches || !items.length) return [];
    var at = function (n) { var r = n.getBoundingClientRect(); return [r.left, r.top]; };
    var a = items.map(at); root.lang = lg;
    var b = items.map(at); root.lang = lang;
    return items.filter(function (n, i) { return Math.abs(a[i][0] - b[i][0]) > 0.5 || Math.abs(a[i][1] - b[i][1]) > 0.5; });
  }
  /* resolves when the leaving texts are out of their masks */
  function gone(list) {
    var anims = [];
    list.forEach(function (n) { if (n.getAnimations) anims = anims.concat(n.getAnimations({ subtree: true })); });
    if (anims.length) return within(Promise.all(anims.map(function (a) { return a.finished.then(noop, noop); })), 700);
    return new Promise(function (done) { setTimeout(done, list.length ? 330 : 0); });
  }

  var leaving = [], turn = 0;                           // texts on their way out; the number of the current swap
  function setLang(lg, animate) {
    if (animate && lg !== lang && window.LFtrack) LFtrack('lang_switch', { lang: lg });
    if (lg === want) return;
    want = lg;
    try { history.replaceState(null, '', address(lg)); } catch (e) {}
    var fonts = faces(lg), my = ++turn;
    if (!began) { first = lg; return; }                 // the page has not started yet: it starts in this language
    if (!rv || !animate) { leaving = []; applyLang(lg); return; }
    if (lg === lang) {                                  // back to the language still on the page: what was leaving returns
      leaving.forEach(function (n) { n.classList.remove('sw-out'); arm(n); });
      leaving = [];
      return;
    }
    var shown = all('[data-i18n].rv-item.in').filter(function (n) { return leaving.indexOf(n) < 0 && inView(n); });
    var moved = movers(shown, lg);
    shown = shown.filter(function (n) { return changes(n, lg) || moved.indexOf(n) >= 0; });
    shown.forEach(function (n) {
      clearTimeout(n.__t);
      if (n.dataset.rv === 'lines' && n.classList.contains('settled')) splitLines(n);   // a settled paragraph is plain text: it gets its line masks back
      n.classList.remove('settled');
    });
    void root.offsetWidth;                              // the masks are on before the texts start to leave
    shown.forEach(function (n) { n.classList.add('sw-out'); });
    leaving = leaving.concat(shown);
    void root.offsetWidth;
    Promise.all([gone(leaving), within(fonts, 1200)]).then(function () {
      if (my !== turn) return;                          // another click came in the meantime
      var list = leaving; leaving = [];
      list.forEach(function (n) { n.classList.remove('in', 'sw-out'); });
      applyLang(lg);
      void root.offsetWidth;                            // the new text starts from under the mask
      requestAnimationFrame(function () { list.forEach(show); });
    });
  }

  /* ---------- title: the same width as in the mockup with whatever face has loaded ---------- */
  function fitTitle() {
    var el = document.querySelector('[data-fit-title]'); if (!el) return;
    var h1 = el.parentElement, page = document.querySelector('.page').getBoundingClientRect().width;
    var target = desktop.matches ? page * TITLE_W : page - 16;
    h1.style.fontSize = '';
    var size = parseFloat(getComputedStyle(h1).fontSize), w = el.getBoundingClientRect().width;
    if (w > 0 && Math.abs(w - target) > 0.75) h1.style.fontSize = (size * target / w).toFixed(2) + 'px';
  }

  /* ---------- reveal: once ---------- */

  /* After the reveal the masks come off and a paragraph becomes plain text again: static content
     that wraps, selects and translates like any other. */
  function settle(g) {
    g.classList.add('settled');
    if (g.dataset.rv === 'lines' && g.__src != null) g.innerHTML = g.__src;
  }
  function arm(g) {
    clearTimeout(g.__t);
    g.__t = setTimeout(function check() {
      if (!g.classList.contains('in') || g.classList.contains('sw-out')) return;
      var moving = g.getAnimations && g.getAnimations({ subtree: true }).some(function (a) { return a.playState === 'running'; });
      if (moving) g.__t = setTimeout(check, 250); else settle(g);     // whatever the durations in the stylesheet are
    }, 1200);
  }
  function show(g) {
    if (g.classList.contains('in')) return;
    var go = function () {
      if (g.classList.contains('in')) return;
      g.classList.remove('settled'); g.classList.add('in'); arm(g);
    };
    var img = g.classList.contains('ph') && g.querySelector('img');
    if (!img || !img.decode) { go(); return; }
    /* A photo opens only when it is whole: decode() waits for the file and for the decoding.
       The timer covers a decode() that never answers, but never opens a photo still on its way. */
    img.decode().then(go, go);
    setTimeout(function () {
      if (img.complete) go();
      else { img.addEventListener('load', go); img.addEventListener('error', go); }
    }, 1500);
  }

  /* the photos below the first screen are lazy: they are asked for and decoded a screen and a half before they are seen,
     so that they still open whole and in time */
  if ('IntersectionObserver' in window) {
    var warmPh = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (!e.isIntersecting) return; warmPh.unobserve(e.target); var im = e.target.querySelector('img'); if (!im) return; im.loading = 'eager'; if (im.decode) im.decode().catch(noop); });
    }, { rootMargin: '900px 0px' });
    all('.ph').forEach(function (f) { if (f.querySelector('img[loading="lazy"]')) warmPh.observe(f); });
  }

  var groups = [], io = null;
  function seen(g) { g.__seen = true; if (io) io.unobserve(g); show(g); }
  function start() {
    fitTitle();
    if (!rv) { root.classList.add('rv-ready'); return; }
    all('[data-rv]').forEach(function (n) {
      var kind = n.dataset.rv;
      if ((kind === 'chars' || kind === 'lines' || kind === 'rows') && n.__src == null) n.__src = n.innerHTML;
      build(n); groups.push(n);
    });
    fitTitle();
    if (!('IntersectionObserver' in window)) { groups.forEach(show); root.classList.add('rv-ready'); return; }
    io = new IntersectionObserver(function (entries) {
      var hit = false;
      entries.forEach(function (e) {
        if (!e.isIntersecting && e.boundingClientRect.top > 0) return;     // still below the screen
        seen(e.target); hit = true;
      });
      /* a jump over the page (the End key, a link, a restored position) passes blocks without
         ever crossing them: whatever is above the screen now is opened too, so nothing starts
         to appear on the way back up */
      if (hit) groups.forEach(function (g) { if (!g.__seen && g.getBoundingClientRect().bottom < 0) seen(g); });
    }, { threshold: 0.1, rootMargin: '0px 0px -8% 0px' });
    groups.forEach(function (g) { io.observe(g); });
    root.classList.add('rv-ready');
  }

  /* ---------- language switch ---------- */
  var box = document.querySelector('.lang'), open = false;
  var buttons = box ? all('[data-set-lang]', box) : [];
  /* On the site every language has its own page (/ and /ru/): the pills are links to them, and after a switch the address
     becomes the address of that page. Where there is one page only (the artifact, a file opened from disk) it is "#ru". */
  var pages = null;
  if (box && box.dataset.urls && /^https?:$/.test(location.protocol)) {
    pages = {};
    buttons.forEach(function (b) { pages[b.dataset.setLang] = b.href; b.setAttribute('href', b.href); });   // absolute: they outlive the address change
  }
  function address(lg) {
    if (pages && pages[lg]) return pages[lg] + location.search;     // utm and other parameters stay
    return lg === served ? location.pathname + location.search : '#' + lg;
  }
  function syncSwitch() {
    if (!box) return;
    box.classList.toggle('is-open', open); box.dataset.lang = want;
    buttons.forEach(function (b) {
      var cur = b.dataset.setLang === want;
      if (cur) { b.setAttribute('aria-current', 'true'); b.setAttribute('aria-expanded', String(open)); }
      else { b.removeAttribute('aria-current'); b.removeAttribute('aria-expanded'); }
    });
  }
  function current() { return buttons.filter(function (b) { return b.dataset.setLang === want; })[0]; }
  if (box) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-set-lang]'); if (!b) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;   // a new tab or window: the plain link to the other page
      e.preventDefault();
      if (b.dataset.setLang === want) open = !open;
      else { open = false; setLang(b.dataset.setLang, true); syncSwitch(); b.focus({ preventScroll: true }); return; }
      syncSwitch();
    });
    document.addEventListener('click', function (e) { if (open && !e.target.closest('.lang')) { open = false; syncSwitch(); } });
    document.addEventListener('keydown', function (e) {
      if (!open || e.key !== 'Escape') return;
      var inside = box.contains(document.activeElement), cur = current();
      open = false; syncSwitch();
      if (inside && cur) cur.focus({ preventScroll: true });   // the focus does not stay on the pill that hides
    });
    box.addEventListener('focusout', function (e) { if (open && e.relatedTarget && !box.contains(e.relatedTarget)) { open = false; syncSwitch(); } });
    /* the faces of the other language are fetched as soon as the switch is touched */
    var warm = function () { faces(want === 'ru' ? 'en' : 'ru'); };
    box.addEventListener('pointerover', warm); box.addEventListener('focusin', warm);
  }
  window.addEventListener('hashchange', function () {
    var lg = /^#(ru|en)$/i.test(location.hash) ? location.hash.slice(1).toLowerCase() : (location.hash ? null : served);
    if (lg && lg !== want) { open = false; setLang(lg, true); syncSwitch(); }
  });

  /* ---------- cases feed: covers are loaded before the feed arrives, never one by one in motion ---------- */
  var feed = document.querySelector('[data-feed]'), loop = noop;
  if (feed) {
    var track = feed.querySelector('.feed__track'), covers = all('.feed__item', feed), half = covers.length / 2;
    var fo = null, queue = null;
    var load = function () {
      if (queue) return; if (fo) fo.disconnect();
      var vw = window.innerWidth;                       // the covers on the screen and the next ones to enter go first
      queue = all('img[loading="lazy"]', feed).map(function (img) { var r = img.getBoundingClientRect(); return [r.right < 0 ? 1e6 - r.right : Math.max(0, r.left - vw), img]; })
        .sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; });
      (function next(n) {                               // a few covers a turn: all 124 at once is a 50 ms task, a dropped frame
        while (n-- > 0 && queue.length) queue.shift().loading = 'eager';
        if (queue.length) setTimeout(next, 32, 6);
      })(12);
    };
    if ('IntersectionObserver' in window) {
      fo = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) load(); }, { rootMargin: '1400px 0px' });
      fo.observe(feed);
      /* and in any case once the page itself has loaded: a jump straight to the feed finds the covers there */
      var net = navigator.connection || {};
      var later = function () { if (!net.saveData && !/2g|3g/.test(net.effectiveType || '')) setTimeout(load, 4000); };   // not on a slow or metered line
      if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
    } else load();

    /* One period of the loop is measured, not computed: the browser rounds the widths of the covers,
       and the distance written in the keyframes can be more than a pixel off on the seam. */
    loop = function () {
      var an = track.getAnimations && track.getAnimations()[0];
      if (!an || !an.effect || !an.effect.setKeyframes || !covers[half]) return;
      var d = covers[half].getBoundingClientRect().left - covers[0].getBoundingClientRect().left;
      if (d > 0) an.effect.setKeyframes([{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(' + (-d).toFixed(3) + 'px,0,0)' }]);
    };
    /* with reduced motion the feed stands still and is scrolled by hand: the loop copy is not needed */
    var copies = function () { covers.slice(half).forEach(function (img) { img.style.display = calm.matches ? 'none' : ''; }); loop(); };
    copies();
    if (calm.addEventListener) calm.addEventListener('change', copies); else if (calm.addListener) calm.addListener(copies);
  }

  /* ---------- paragraphs still under their masks are measured again when the width changes ---------- */
  var lastW = window.innerWidth, timer = 0;
  window.addEventListener('resize', function () {
    fitTitle();
    if (window.innerWidth === lastW) return; lastW = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(function () { if (rv) all('[data-rv="lines"].rv-item:not(.settled)').forEach(splitLines); fitTitle(); loop(); }, 180);
  });

  /* ---------- go ---------- */
  window.LF = { lang: function () { return lang; }, t: text, onLang: function (fn) { listeners.push(fn); } };
  var first = /^#(ru|en)$/i.test(location.hash) ? location.hash.slice(1).toLowerCase() : served;
  if (pages && first !== served && pages[first]) { location.replace(pages[first] + location.search); return; }   // an old "#ru" link on the site: go to that page
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  var began = false;
  function begin() {
    if (began) return; began = true;
    all('[data-i18n]').forEach(function (n) { n.__lang = served; });
    want = first;
    if (first !== served) { all('[data-rv]').forEach(function (n) { if (n.dataset.i18n) n.__src = source(n.dataset.i18n, first); }); applyLang(first); }
    start(); syncSwitch(); loop();
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);
  }
  Promise.all([ready, faces(first)]).then(function () { setTimeout(begin, 60); });
  setTimeout(begin, 1800);                               // fonts that never arrive must not hold the page
})();
