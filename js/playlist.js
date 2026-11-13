/* ==========================================================================
   "Welcome to my playlist": a drum and bass loop and its picture made of particles.

   Sound:   generated in the browser with Web Audio (no audio file): 174 BPM, two-step
            break, reese bass with a sub, a pad and a pluck in F minor. Starts only
            from the "Listen" button.
   Picture: a field of dots in perspective (WebGL2). The front row is the spectrum of
            what is playing right now, the rows behind it are the last seconds.
            While nothing plays the field breathes slowly. Colours are the hoodie
            of the figure: deep teal → #38b1ba → pale mint.
   ========================================================================== */
(function () {
  'use strict';
  var sec = document.querySelector('[data-playlist]'); if (!sec) return;
  var canvas = sec.querySelector('.pl__canvas');
  var btn = sec.querySelector('[data-listen]');
  var status = sec.querySelector('[data-track]');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LF = window.LF || { t: function (k) { return { pl_listen: 'Listen →', pl_pause: 'Pause', pl_on: 'Playing', pl_off: 'Paused' }[k] || ''; }, onLang: function () {} };

  /* ======================= sound ======================= */
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master, analyser, duck, drums, music, send, noise;
  var reeseA, reeseB, reeseF, reeseG, sub, subG, pad = [], padG, padF;
  var hits = null, notes = null;                          // buses of the one-shot sounds of the current run
  var playing = false, ran = false, timer = 0, clockW = null, step = 0, nextT = 0, late = false, freq = null;
  var BPM = 174, S = 60 / BPM / 4;                        // one sixteenth
  var AHEAD = 0.18;                                       // how far ahead of the clock the steps are written

  var ROOTS = [43.65, 43.65, 34.65, 34.65, 51.91, 51.91, 38.89, 38.89];           // F  Db  Ab  Eb, one per bar
  var CHORDS = [[174.61, 207.65, 261.63, 392.0], [138.59, 174.61, 207.65, 261.63], [207.65, 261.63, 311.13, 392.0], [155.56, 196.0, 233.08, 349.23]];
  var WOB = [1, 0.62, 0.3, 0.8, 0.5, 0.22, 0.1, 0.1, 0.1, 0.1, 1, 0.7, 0.4, 0.9, 0.5, 0.3];
  var GATE = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
  var PLUCK = [0, 3, 6, 9, 12, 14];

  /* a gain that is silent until its envelope starts: a source may begin one sample frame before
     the time it was given, and with the default gain of 1 that frame is a click at full level */
  function quiet() { var g = ctx.createGain(); g.gain.value = 0; return g; }

  function setup() {
    ctx = new AC();
    var n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noise = buf;

    master = ctx.createGain(); master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.16;
    analyser = ctx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.55;
    freq = new Uint8Array(analyser.frequencyBinCount);
    /* a limiter after the compressor: no peak reaches the edge of the scale */
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    comp.connect(lim); lim.connect(master); master.connect(ctx.destination); comp.connect(analyser);

    drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(comp);
    duck = ctx.createGain(); duck.connect(comp);            // the music gives way to every kick
    music = ctx.createGain(); music.gain.value = 0.8; music.connect(duck);

    var delay = ctx.createDelay(1); delay.delayTime.value = S * 3;
    var fb = ctx.createGain(); fb.gain.value = 0.36;
    var tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600;
    send = ctx.createGain(); send.gain.value = 0.5;
    send.connect(delay); delay.connect(tone); tone.connect(fb); fb.connect(delay); tone.connect(music);

    /* reese: two detuned saws through a moving low-pass, and a sine an octave below */
    reeseF = ctx.createBiquadFilter(); reeseF.type = 'lowpass'; reeseF.Q.value = 7; reeseF.frequency.value = 300;
    reeseG = ctx.createGain(); reeseG.gain.value = 0;
    reeseA = ctx.createOscillator(); reeseA.type = 'sawtooth'; reeseA.detune.value = -16;
    reeseB = ctx.createOscillator(); reeseB.type = 'sawtooth'; reeseB.detune.value = 16;
    reeseA.connect(reeseF); reeseB.connect(reeseF); reeseF.connect(reeseG); reeseG.connect(music);
    sub = ctx.createOscillator(); sub.type = 'sine'; subG = ctx.createGain(); subG.gain.value = 0;
    sub.connect(subG); subG.connect(music);
    reeseA.start(); reeseB.start(); sub.start();

    /* pad: four slow voices */
    padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 1500; padF.Q.value = 0.6;
    padG = ctx.createGain(); padG.gain.value = 0;
    padF.connect(padG); padG.connect(music); padG.connect(send);
    for (var v = 0; v < 4; v++) {
      var o = ctx.createOscillator(); o.type = v % 2 ? 'triangle' : 'sawtooth'; o.detune.value = (v - 1.5) * 7;
      var g = ctx.createGain(); g.gain.value = v % 2 ? 0.5 : 0.22;
      o.connect(g); g.connect(padF); o.start(); pad.push(o);
    }

    /* the system can take the sound away (a call, a tab put to sleep on a phone): the button must not lie */
    ctx.onstatechange = function () { if (playing && ran && ctx.state !== 'running') pause(); };
  }

  function burst(t, dur, type, f, q, gain) {
    var src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    var flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    var g = quiet(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(flt); flt.connect(g); g.connect(hits);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }
  function kick(t, v) {
    var o = ctx.createOscillator(), g = quiet();
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(hits); o.start(t); o.stop(t + 0.32);
    burst(t, 0.02, 'highpass', 3000, 0.7, 0.25 * v);
    /* the music ducks in 5 ms, not in one sample: a step in the gain of a held bass note is a click */
    duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(1, t); duck.gain.linearRampToValueAtTime(0.4, t + 0.005); duck.gain.linearRampToValueAtTime(1, t + 0.2);
  }
  function snare(t, v) {
    burst(t, 0.17, 'bandpass', 1900, 0.7, 0.85 * v);
    burst(t, 0.09, 'highpass', 5200, 0.7, 0.42 * v);
    var o = ctx.createOscillator(), g = quiet(); o.type = 'triangle';
    o.frequency.setValueAtTime(215, t); o.frequency.exponentialRampToValueAtTime(165, t + 0.08);
    g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g); g.connect(hits); o.start(t); o.stop(t + 0.12);
  }
  function hat(t, v, open) { burst(t, open ? 0.17 : 0.035, 'highpass', 7600, 0.7, 0.5 * v); }
  function pluck(t, f) {
    var o = ctx.createOscillator(), g = quiet(); o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(notes); o.start(t); o.stop(t + 0.25);
  }

  /* one sixteenth. `fresh` is the first step after a gap: the held voices are tuned again right away */
  function schedule(n, t, fresh) {
    var s = n % 16, bar = Math.floor(n / 16), phrase = bar % 16, b8 = bar % 8;
    var breakdown = phrase >= 8 && phrase < 12, turn = bar % 4 === 3;

    /* drums */
    if (!breakdown) {
      if (s === 0 || s === 10 || (turn && s === 6)) kick(t, 1);
      if (s === 4 || s === 12) snare(t, 1);
      if (s === 7 || s === 15) snare(t, 0.16);
      if (turn && s === 14) snare(t, 0.5);
    } else if (phrase === 11 && s >= 8) snare(t, 0.2 + (s - 8) * 0.1);       // the roll back into the beat
    if (s % 2 === 0) hat(t, breakdown ? 0.4 : (s % 4 === 2 ? 0.85 : 0.55), !breakdown && s === 14 && bar % 2 === 1);
    else hat(t, breakdown ? 0.12 : 0.22);

    /* bass: the sub is held back so that the low end does not eat the headroom of the whole mix,
       and it steps down in the breakdown, which has to be quieter than the beat it leads into */
    var root = ROOTS[b8];
    if (s === 0 || fresh) { reeseA.frequency.setTargetAtTime(root * 2, t, 0.03); reeseB.frequency.setTargetAtTime(root * 2, t, 0.03); sub.frequency.setTargetAtTime(root, t, 0.03); }
    var on = GATE[s];
    reeseG.gain.setTargetAtTime(on ? (breakdown ? 0.1 : 0.32) : 0, t, 0.012);
    subG.gain.setTargetAtTime(on ? (breakdown ? 0.24 : 0.36) : 0, t, 0.012);
    reeseF.frequency.setTargetAtTime((breakdown ? 180 : 240) + (breakdown ? 260 : 1100) * WOB[s], t, 0.03);

    /* pad and pluck */
    var chord = CHORDS[Math.floor(b8 / 2)];
    if ((s === 0 && b8 % 2 === 0) || fresh) pad.forEach(function (o, i) { o.frequency.setTargetAtTime(chord[i], t, 0.08); });
    if (s === 0 || fresh) padG.gain.setTargetAtTime(breakdown ? 0.2 : 0.11, t, 0.4);
    var k = PLUCK.indexOf(s);
    if (k >= 0 && (phrase >= 4 || breakdown)) pluck(t, chord[(k + bar) % 4] * 2);
  }

  function tick() {
    if (!playing) return;
    var now = ctx.currentTime;
    if (nextT < now) {                                    // the page was held up (a busy frame, a sleeping tab):
      var miss = Math.ceil((now + 0.02 - nextT) / S);     // what is already in the past is dropped, not played in one heap,
      step += miss; nextT += miss * S; late = true;       // and the beat stays on its grid
    }
    var ahead = document.hidden && !clockW ? 1.25 : AHEAD; // no worker and a hidden tab: one tick has to cover a whole second
    while (nextT < now + ahead) { schedule(step, nextT, late); late = false; nextT += S; step++; }
  }

  /* timers of a hidden tab fire once a second, a worker keeps its pace: the loop goes on in the background */
  function metronome(on) {
    clearInterval(timer);
    if (on) timer = setInterval(tick, 25);
    try {
      if (on && !clockW && window.Worker && window.Blob && window.URL) {
        clockW = new Worker(URL.createObjectURL(new Blob(['var t=0;onmessage=function(e){clearInterval(t);if(e.data)t=setInterval(function(){postMessage(0)},25)}'], { type: 'text/javascript' })));
        clockW.onmessage = tick; clockW.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); clockW = null; };
      }
      if (clockW) clockW.postMessage(on ? 1 : 0);
    } catch (e) { clockW = null; }
  }

  function label() {
    if (!btn) return;
    var l = btn.querySelector('[data-listen-label]') || btn;
    l.textContent = LF.t(playing ? 'pl_pause' : 'pl_listen');
    btn.setAttribute('aria-pressed', String(playing));
  }
  function held() { return [reeseG.gain, subG.gain, padG.gain, reeseF.frequency, reeseA.frequency, reeseB.frequency, sub.frequency].concat(pad.map(function (o) { return o.frequency; })); }
  function play() {
    if (!AC) return;
    try { if (!ctx) setup(); } catch (e) { ctx = null; if (btn) btn.disabled = true; return; }
    ran = false;                                           // true once this run is really sounding
    var p = ctx.resume(); if (p && p.then) p.then(function () { ran = playing; }, function () { if (playing) pause(); });
    var t = ctx.currentTime;
    /* every run has its own buses: whatever the previous run had already written ahead stays in its own, silent ones */
    hits = ctx.createGain(); hits.connect(drums);
    notes = ctx.createGain(); notes.connect(music); notes.connect(send);
    step = 0; nextT = t + 0.08; late = false;
    master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(0, t); master.gain.setTargetAtTime(0.62, t, 0.45);   // the sound comes in over a second and a half
    playing = true; tick(); metronome(true);
    label(); if (status) status.textContent = LF.t('pl_on');
  }
  function pause() {
    playing = false; metronome(false);
    var t = ctx.currentTime;
    master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(0, t, 0.05);
    held().forEach(function (a) { a.cancelScheduledValues(t); });
    [reeseG, subG, padG].forEach(function (g) { g.gain.setTargetAtTime(0, t, 0.05); });
    duck.gain.cancelScheduledValues(t); duck.gain.setTargetAtTime(1, t, 0.02);
    [hits, notes].forEach(function (b) { if (b) { b.gain.setTargetAtTime(0, t, 0.02); setTimeout(function () { b.disconnect(); }, 600); } });
    hits = notes = null;
    setTimeout(function () { if (!playing && ctx && ctx.state === 'running') ctx.suspend(); }, 400);
    label(); if (status) status.textContent = LF.t('pl_off');
  }
  if (btn) {
    if (!AC) btn.disabled = true;
    btn.addEventListener('click', function () { if (playing) pause(); else play(); });
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && playing) pause(); else tick(); });   // a hidden tab does not keep playing on its own
  LF.onLang(function () { label(); if (status && status.textContent) status.textContent = LF.t(playing ? 'pl_on' : 'pl_off'); });
  label();                                                // the page may already be in Russian when this file arrives

  /* ======================= picture ======================= */
  if (!canvas) return;
  var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return;

  var NX = 208, NZ = 84, ROW_MS = 40;
  var VS = '#version 300 es\n' + [
    'in vec3 aCell;',                                     // x index, z index, random
    'uniform sampler2D uField; uniform vec2 uRes; uniform float uPhase, uDpr, uNarrow;',
    'out vec3 vCol; out float vA;',
    'void main(){',
    '  float r2 = fract(sin(aCell.z * 91.7 + aCell.x * 0.37) * 43758.5453);',
    '  float x = (aCell.x + 0.5 + (aCell.z - 0.5) * 0.9) / ' + NX + '.0 * 2.0 - 1.0;',   // dots are scattered inside their cell: particles, not a grid
    '  float zr = aCell.y + 0.5 + (r2 - 0.5) * 0.9;',    // a dot keeps its place; the heights travel through the dots
    '  float z = zr / ' + NZ + '.0;',
    '  int ix = int(aCell.x), iz = int(aCell.y);',
    '  float h = mix(texelFetch(uField, ivec2(ix, min(iz + 1, ' + (NZ - 1) + ')), 0).r, texelFetch(uField, ivec2(ix, iz), 0).r, uPhase);',   // between two rows of the history: no step when a new row arrives
    '  float s = 1.0 / (1.0 + z * 1.7);',                // perspective
    '  float halfW = mix(0.64, 1.05, uNarrow) * uRes.x;',
    '  float yFront = 0.965 * uRes.y, yVanish = 0.3 * uRes.y;',
    '  float px = 0.5 * uRes.x + x * halfW * s;',
    '  float py = mix(yVanish, yFront, s) - h * mix(0.56, 0.46, uNarrow) * uRes.y * s;',
    '  gl_Position = vec4(px / uRes.x * 2.0 - 1.0, 1.0 - py / uRes.y * 2.0, 0.0, 1.0);',
    '  float tone = smoothstep(0.03, 0.85, h);',
    '  gl_PointSize = uDpr * (1.6 + 2.7 * tone) * mix(0.5, 1.0, s) * (0.8 + 0.4 * r2) * clamp(uRes.x / (1440.0 * uDpr), 1.0, 1.6);',   // wider screens: larger dots
    '  vec3 c0 = vec3(0.110, 0.470, 0.530), c1 = vec3(0.220, 0.694, 0.729), c2 = vec3(0.749, 0.961, 0.949);',
    '  vCol = mix(mix(c0, c1, smoothstep(0.0, 0.42, h)), c2, smoothstep(0.5, 1.0, h));',
    '  vCol = mix(vCol, c2, step(0.93, r2) * 0.55);',    // a few pale dots, as on the face and the sneakers of the figure
    '  float edge = 1.0 - smoothstep(0.62, 1.0, abs(x));',
    '  float depth = smoothstep(0.0, 1.5, zr) * (1.0 - smoothstep(0.55, 1.0, z));',
    '  vA = (0.68 + 0.32 * tone) * edge * depth;',
    '}'].join('\n');
  var FS = '#version 300 es\nprecision mediump float;\n' + [
    'in vec3 vCol; in float vA; out vec4 o;',
    'void main(){',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float a = (1.0 - smoothstep(0.34, 0.5, d)) * vA;',
    '  if (a < 0.01) discard;',
    '  o = vec4(vCol * a, a);',
    '}'].join('\n');

  var cells = new Float32Array(NX * NZ * 3), p = 0;
  for (var iz = NZ - 1; iz >= 0; iz--) for (var ix = 0; ix < NX; ix++) { cells[p++] = ix; cells[p++] = iz; cells[p++] = Math.random(); }   // far rows first
  var field = new Uint8Array(NX * NZ), row = new Float32Array(NX);
  var U = {}, ready = false, dirty = true, W = 0, H = 0, dpr = 1;

  /* everything that lives in the GL context; built again when the browser gives a lost context back */
  function build() {
    function shader(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    var vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aCell'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NX, NZ, 0, gl.RED, gl.UNSIGNED_BYTE, field);
    ['uField', 'uRes', 'uPhase', 'uDpr', 'uNarrow'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.uField, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    W = H = 0; dirty = false;
    return true;
  }

  var live = 0, clock = 0, tail = 0;                     // tail: rows still to draw after a pause when motion is reduced
  /* one new front row: the spectrum when the track plays, a slow swell when it does not */
  function sample(t) {
    live += ((playing ? 1 : 0) - live) * 0.12;
    if (playing) tail = NZ + 40; else if (tail) tail--;
    if (playing && analyser) analyser.getByteFrequencyData(freq);
    var nyq = ctx ? ctx.sampleRate / 2 : 22050, bins = freq ? freq.length : 0;
    for (var i = 0; i < NX; i++) {
      var u = Math.abs((i + 0.5) / NX * 2 - 1);                                  // bass in the middle, air at the edges
      var xs = (i + 0.5) / NX * 2 - 1;
      var idle = 0.24 + 0.17 * Math.sin(xs * 5.2 - t * 0.0012) * Math.sin(xs * 1.9 + t * 0.0007) + 0.07 * Math.sin(xs * 11.0 + t * 0.0017) * (1 - u);
      var v = 0;
      if (live > 0.01 && bins) {
        var f0 = 38 * Math.pow(14000 / 38, u), f1 = 38 * Math.pow(14000 / 38, Math.min(1, u + 2 / NX));
        var a = Math.floor(f0 / nyq * bins), b = Math.max(a + 1, Math.ceil(f1 / nyq * bins)), m = 0;
        for (var k = a; k < b && k < bins; k++) if (freq[k] > m) m = freq[k];
        v = Math.pow(Math.max(0, m / 255 * (0.8 + 0.7 * u) - 0.34) / 0.66, 1.35);
      }
      var target = Math.min(1, Math.max(0, idle) * (1 - 0.75 * live) + v * live);
      row[i] += (target - row[i]) * 0.7;
    }
    field.copyWithin(NX, 0, NX * (NZ - 1));                                       // history moves one row back
    for (var j = 0; j < NX; j++) {
      var sm = (row[Math.max(0, j - 1)] + row[j] * 2 + row[Math.min(NX - 1, j + 1)]) / 4;
      field[j] = Math.max(0, Math.min(255, sm * 255));
    }
    dirty = true;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect(), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (!w || !h || (w === W && h === H)) return;
    W = canvas.width = w; H = canvas.height = h; gl.viewport(0, 0, W, H);
  }
  var visible = false, last = 0, raf = 0;
  function frame(t) {
    raf = 0; if (!visible || !ready) return;
    resize();
    if (!last) last = t;
    clock += Math.min(100, t - last); last = t;
    while (clock >= ROW_MS) { clock -= ROW_MS; sample(t); }
    if (dirty) { gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NX, NZ, gl.RED, gl.UNSIGNED_BYTE, field); dirty = false; }   // one upload a frame, however many rows arrived
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uPhase, clock / ROW_MS); gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uNarrow, W / dpr < 700 ? 1 : 0);
    gl.drawArrays(gl.POINTS, 0, NX * NZ);
    if (!reduced || playing || tail) raf = requestAnimationFrame(frame);   // reduced motion: one still frame, moving only with the sound (and until the sound has left the field)
  }
  function wake() { if (!raf && visible && ready) { last = 0; raf = requestAnimationFrame(frame); } }
  function start() {
    ready = !gl.isContextLost() && build();
    sec.classList.toggle('pl-on', ready);
    dirty = true; wake();
  }
  for (var w0 = 0; w0 < NZ; w0++) sample(w0 * ROW_MS * 9);                         // the field is not empty on the first frame
  start();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[es.length - 1].isIntersecting; wake(); }, { rootMargin: '200px 0px' }).observe(canvas);
  } else { visible = true; wake(); }
  if (btn) btn.addEventListener('click', function () { setTimeout(wake, 0); });
  window.addEventListener('resize', wake);
  /* a lost context (a sleeping tab, a driver reset) stops the drawing; when it comes back the field is built again */
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); ready = false; if (raf) cancelAnimationFrame(raf); raf = 0; sec.classList.remove('pl-on'); });
  canvas.addEventListener('webglcontextrestored', start);
})();
