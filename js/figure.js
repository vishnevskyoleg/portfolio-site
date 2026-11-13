/* ==========================================================================
   3D figure — point-splat renderer (WebGL2, no dependencies)

   Data:   js/figure-data.js  → window.__FIGURE__ (gzip + base64)
           ~530k coloured surface points built from the layer photo:
           front = real pixels with estimated depth, back/sides = reconstructed.
   Place:  the element [data-figure-slot] defines where the figure stands on the
           page and how tall it is. The canvas is fixed to the viewport, so the
           cost is one screen of pixels no matter how tall the figure is.
   Looks:  dots (molecules, default) | photo      (?look=…)
   Motion: scroll (default) | spin | hold      (?motion=…)   drag always works
   Alive:  dots breathe, part around the cursor, ripple on click, loosen on fast scroll,
           assemble on load; the band at the middle of the screen is the sharpest
   Other:  ?rot=90 start angle in degrees, ?ui=1 shows the switcher
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var canvas = document.getElementById('figure-canvas');
  var slot = document.querySelector('[data-figure-slot]');
  var ui = document.querySelector('[data-figure-ui]');
  var params = new URLSearchParams(location.search);
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- title: fit "MY BACKGROUND" to the frame with whatever face loaded ---------- */
  function fitTitle() {
    var el = document.querySelector('[data-fit]');
    if (!el) return;
    var h1 = el.parentElement;
    var page = document.querySelector('.page').getBoundingClientRect().width;
    var desktop = window.matchMedia('(min-width: 1080px)').matches;
    var target = desktop ? page * (1342 / 1440) : page * 0.955;
    h1.style.fontSize = '';
    var size = parseFloat(getComputedStyle(h1).fontSize);
    var w = el.getBoundingClientRect().width;
    if (w > 0) h1.style.fontSize = (size * target / w).toFixed(2) + 'px';
  }
  fitTitle();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);
  window.addEventListener('resize', fitTitle);

  if (!canvas || !slot) return;

  var LOOKS = {
    dots: { gap: 1.85, dot: 1.0, dim: 1.3 },
    photo: { frac: 1.0, k: 2.6, dim: 0.74 }
  };
  var state = {
    look: LOOKS[params.get('look')] ? params.get('look') : 'dots',
    motion: ['scroll', 'spin', 'hold'].indexOf(params.get('motion')) >= 0 ? params.get('motion') : (reduced ? 'hold' : 'scroll'),
    base: (parseFloat(params.get('rot')) || 0) * Math.PI / 180,
    rot0: (parseFloat(params.get('rot')) || 0) * Math.PI / 180, swingT: 0,
    user: 0, vel: 0, resumeAt: 0, dragging: false,
    follow: 0, followTo: 0, ptrX: 0, ptrY: 0, ptrOn: 0, ptrGain: 0, energy: 0, burst: 0, away: 0, dir: 1, ripX: 0, ripY: 0, ripT: 99, assemble: reduced ? 1 : 0, lastScroll: window.scrollY
  };

  var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl || !window.__FIGURE__ || !('DecompressionStream' in window)) return; // the cut-out image stays as the fallback
  root.classList.add('wants-3d');

  /* ---------- shaders ---------- */
  var VS = '#version 300 es\n' + [
    'in vec3 aPos; in vec3 aCol; in vec3 aNor;',
    'uniform vec2 uRot; uniform vec4 uMap; uniform vec3 uPtr; uniform vec3 uRip; uniform vec3 uSh;',
    'uniform float uSize, uEps, uTime, uIdle, uAssemble, uEnergy, uDir, uDots, uFocusY, uPtrR, uWall, uBurst, uPersp, uEdge, uEdge2, uFlip;',
    'out vec3 vCol; out vec3 vNor; out float vFade; out float vLum; out float vDepth; out float vSize;',
    // integer hash: fract(sin(n)) loses precision on real GPUs for large point ids and the
    // "random" values start to repeat along the sorted rows -> horizontal bands
    'uint hashu(uint x){ x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }',
    'float hash(float n){ return float(hashu(floatBitsToUint(n)) >> 8) / 16777216.0; }',
    'void main(){',
    '  vec3 p = aPos / 30000.0; vec3 n = aNor; float id = float(gl_VertexID);',
    '  float h = hash(id * 0.37), h2 = hash(id * 1.13 + 4.0), h3 = hash(id * 2.71 + 9.0);',
    '  vec3 rnd = vec3(h, h2, h3) - 0.5;',
    '  vec3 q = vec3(p.x * uRot.x + p.z * uRot.y, p.y, -p.x * uRot.y + p.z * uRot.x);',
    '  vec3 nv = vec3(n.x * uRot.x + n.z * uRot.y, n.y, -n.x * uRot.y + n.z * uRot.x);',
    '  float luma = dot(aCol, vec3(0.299, 0.587, 0.114));',
    '  vFade = 1.0; vLum = luma; vDepth = 1.0;',
    '  float size = uSize * (0.85 + 0.3 * h); bool gone = false;',
    '  if (uDots > 0.5) {',
    '    float trust = 1.0;',                 // the photo side is reliable, the far side is not
    '    float tone = smoothstep(0.12, 0.82, luma);',
    '    tone = mix(max(tone, 0.34), tone, uWall);',
    '    float shd = uWall * exp(-pow((p.x - uSh.x) / uSh.z, 2.0) - pow((p.y - uSh.y) / (uSh.z * 0.2), 2.0));', // contact shadow under the shoes
    '    tone *= 1.0 - 0.9 * shd;',
    '    gone = h2 > mix(0.82, 1.0, trust) || hash(id * 5.3 + 2.0) > mix(mix(0.55, 1.0, uWall), 1.0, tone);', // halftone: tone = density
    '    if (uWall < 0.5 && hash(id * 7.7 + 1.0) > smoothstep(0.0, 0.016, p.y) + 0.12) gone = true;',
    '    float F = abs(nv.z);',
    '    float g = smoothstep(0.07, 0.28, abs(p.y - uFocusY));',      // focus band at the middle of the screen
    '    float amp = mix(0.6, 1.9, g) * (1.0 + 1.2 * (1.0 - trust)) * (1.0 + 3.0 * uEnergy) * uIdle;',
    '    vec3 flow = vec3(sin(dot(p, vec3(7.1, 5.3, 6.7)) + uTime * 0.9), sin(dot(p, vec3(-5.9, 8.3, 4.1)) + uTime * 1.1 + 1.7), sin(dot(p, vec3(6.3, -4.7, 9.1)) + uTime * 0.7 + 3.1));',
    '    float breath = sin(p.y * 9.0 - uTime * 1.2 + h * 0.6);',
    '    vec3 j = vec3(sin(uTime * (1.5 + 2.0 * h) + h * 40.0), cos(uTime * (1.2 + 2.0 * h2) + h2 * 40.0), sin(uTime * (1.7 + h3) + h3 * 17.0));',
    '    q += nv * breath * 0.0030 * mix(0.3, 1.0, F) * amp;',
    '    q += (j - nv * dot(j, nv)) * 0.0019 * amp;',
    '    q += (flow - nv * dot(flow, nv)) * 0.0017 * amp;',
    '    if (h3 < 0.07) q += (nv * (0.006 + 0.012 * h) + flow * 0.006) * (0.5 + 0.5 * sin(uTime * 0.8 + h * 30.0)) * uIdle;', // free molecules
    // pointer: dots part around it and swirl
    '    vec2 d = q.xy - uPtr.xy; float r = length(d) + 1e-4;',
    '    float f = exp(-r * r / (uPtrR * uPtrR)) * uPtr.z;',
    '    q.xy += (d / r) * f * 0.013 * mix(0.5, 1.5, h) + vec2(-d.y, d.x) / r * f * 0.005;',
    '    q.z += f * 0.015;',
    // click ripple
    '    vec2 dr = q.xy - uRip.xy; float rr = length(dr) + 1e-4;',
    '    float w = exp(-pow((rr - uRip.z * 0.55) / 0.03, 2.0)) * exp(-uRip.z * 2.5);',
    '    q.xy += (dr / rr) * w * 0.02; q.z += w * 0.02;',
    // scroll: light dots lag behind, the cloud loosens
    '    q.y -= uDir * uEnergy * 0.03 * h * h;',
    '    q += rnd * vec3(0.01, 0.02, 0.01) * uEnergy * (0.25 + h3);',
    // the turn: while the figure spins on scroll it opens into a cloud and closes again
    '    q += (nv * (0.02 + 0.05 * h) + rnd * 0.05 + vec3(0.0, 0.03 * (h2 - 0.3), 0.0)) * uBurst * (0.35 + h3);',
    // assemble from a loose cloud, feet first
    '    float delay = p.y * 0.55 + h * 0.3;',
    '    float t = clamp(uAssemble * 1.85 - delay, 0.0, 1.0); float e = 1.0 - exp2(-10.0 * t);',
    '    vec3 off = normalize(rnd + 1e-3) * (0.3 + 0.7 * h) + vec3(0.0, -0.12, 0.4 * h2);',
    '    float sw = (1.0 - e) * 2.2; off.xz = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * off.xz;',
    '    q += off * (1.0 - e); vFade = smoothstep(0.0, 0.15, t);',
    '    size = uSize * mix(0.62, 1.18, tone) * (0.8 + 0.4 * h) * mix(1.12, 0.9, g) * mix(0.6, 1.0, trust) * (1.0 + 0.2 * f) * (1.0 + 2.0 * (1.0 - e));',
    '    vDepth = mix(smoothstep(-0.12, 0.12, q.z), 1.0, uWall);',
    '    float mx = max(aCol.r, max(aCol.g, aCol.b)), mn = min(aCol.r, min(aCol.g, aCol.b));',
    '    float neutral = (1.0 - smoothstep(0.10, 0.26, (mx - mn) / max(mx, 0.01))) * smoothstep(0.42, 0.62, luma);', // white shoes stay white, also in their own shade
    '    vLum = mix(tone, max(tone, 0.92), neutral * (1.0 - uWall));',
    '  }',
    '  if (uWall > 0.5) {',                                              // the wall never ends with an edge: it thins out
    '    float sy = p.y * uFlip;',                                        // below the floor line the floor goes on as a mirrored copy
    '    float fz = 1.0 - smoothstep(0.085, 0.125, p.y);',               // 1 on the floor, 0 on the wall
    '    float ff = smoothstep(-0.17, 0.07, sy) * mix(1.0, 1.0 - smoothstep(0.14, 0.5, abs(p.x - uSh.x)), fz);',
    '    if (uFlip < 0.0 && p.y > 0.2) ff = 0.0;',
    '    ff *= mix(1.0, 0.6, fz);',
    '    ff *= 1.0 - smoothstep(uEdge, uEdge2, abs(q.x * uMap.x + uMap.y));', // the wall has a maximum width; beyond it, it fades
    '    if (hash(id * 3.1 + 7.0) > ff * 1.1) gone = true;',
    '    vFade *= smoothstep(0.0, 0.45, ff); size *= mix(0.7, 1.0, ff);',
    '  }',
    '  float pk = 1.0 / (1.0 - q.z * uPersp); q.x *= pk; q.y = 0.55 + (q.y - 0.55) * pk;', // weak perspective, zero in the photo view
    '  gl_Position = gone ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(q.x * uMap.x + uMap.y, q.y * uMap.z + uMap.w, clamp(-q.z * 3.0 + uEps, -0.98, 0.98), 1.0);',
    '  gl_PointSize = size; vSize = size;',
    '  vCol = aCol; vNor = nv;',
    '}'].join('\n');
  var FS = '#version 300 es\nprecision highp float;\n' + [
    'in vec3 vCol; in vec3 vNor; in float vFade; in float vLum; in float vDepth; in float vSize;',
    'uniform int uPass; uniform float uDim, uCut;',
    'out vec4 o;',
    'void main(){',
    '  vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c);',
    '  if (r2 > 1.0) discard;',
    '  if (uPass == 0) { if (r2 > uCut) discard; o = vec4(0.0); return; }',
    '  if (uPass == 3) { o = vec4(vCol * uDim, 1.0); return; }',
    '  if (uPass == 4) { o = vec4(0.016, 0.085, 0.105, 1.0); return; }',           // dark body under the dots
    '  if (uPass == 5) {',                                                          // one molecule
    '    vec3 n = normalize(vNor); float F = abs(n.z);',
    '    vec3 ramp = mix(vec3(0.043, 0.227, 0.290), vec3(0.170, 0.640, 0.680), smoothstep(0.0, 0.6, vLum));',
    '    ramp = mix(ramp, vec3(0.749, 0.961, 0.949), smoothstep(0.78, 1.0, vLum));',
    '    vec3 col = mix(ramp, vCol, 0.3);',
    '    col *= 0.62 + 0.42 * max(dot(n, normalize(vec3(-0.4, 0.5, 0.75))), 0.0);',
    '    col += vec3(0.60, 0.92, 0.92) * pow(clamp(abs(n.x), 0.0, 1.0), 3.0) * 0.28;', // rim light only where the surface turns sideways
    '    col *= 1.0 - 0.45 * smoothstep(0.45, 0.95, abs(n.y));',                     // ledges facing up/down never light up as a line
    '    col *= mix(0.6, 1.0, vDepth) * uDim;',
    '    col *= 0.78 + 0.3 * sqrt(1.0 - r2);',                                     // a small sphere, not a flat disc
    '    float a = (1.0 - smoothstep(1.0 - 2.4 / max(vSize, 2.4), 1.0, sqrt(r2))) * vFade;',
    '    o = vec4(col * a, a); return;',
    '  }',
    '  float w = exp(-r2 * 3.0);',
    '  o = vec4(vCol * uDim * w, w);',
    '}'].join('\n');
  var QVS = '#version 300 es\nin vec2 aP; out vec2 vUv; void main(){ vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }';
  var QFS = '#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTex; uniform float uGain; out vec4 o;\n' +
    'void main(){ vec4 t = texture(uTex, vUv); float a = smoothstep(0.03, 0.85, t.a * uGain); o = vec4(t.rgb / max(t.a, 1e-4) * a, a); }';

  function compile(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs, attribs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    attribs.forEach(function (name, i) { gl.bindAttribLocation(p, i, name); });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p: p, u: u };
  }

  /* ---------- data ---------- */
  function inflate(b64) {
    // atob + Blob stream: works on file:// and under strict CSP (no fetch of data: URLs)
    if (!('DecompressionStream' in window)) return Promise.reject(new Error('no DecompressionStream'));
    var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  function unpack(buf) {
    var head = new Uint32Array(buf, 0, 2), n = head[0], nb = head[1];
    var counts = new Uint32Array(buf, 8, nb), off = 8 + 4 * nb;
    var dPos = new Int16Array(buf, off, n * 3); off += n * 6;
    var dCol = new Uint8Array(buf, off, n * 3); off += n * 3;
    var dNor = new Int8Array(buf, off, n * 3);
    var pos = new Int16Array(n * 3), col = new Uint8Array(n * 3), nor = new Int8Array(n * 3);
    for (var c = 0; c < 3; c++) {
      var a = 0, b = 0, d = 0, base = c * n;
      for (var i = 0; i < n; i++) {
        a = (a + dPos[base + i]) << 16 >> 16; pos[i * 3 + c] = a;
        b = (b + dCol[base + i]) & 255; col[i * 3 + c] = b;
        d = (d + dNor[base + i]) << 24 >> 24; nor[i * 3 + c] = d;
      }
    }
    var prefix = [0];
    for (var k = 0; k < nb; k++) prefix.push(prefix[k] + counts[k]);
    return { n: n, nb: nb, prefix: prefix, pos: pos, col: col, nor: nor };
  }
  // Twice the points without twice the download: every surface point gets a twin,
  // shifted inside its voxel along the surface. Same shape, finer grain.
  function densify(d, voxel) {
    var n = d.n, pos = new Int16Array(n * 6), col = new Uint8Array(n * 6), nor = new Int8Array(n * 6), seed = 1234567;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; }
    for (var i = 0; i < n; i++) {
      var a = i * 3, b = i * 6;
      var nx = d.nor[a] / 127, ny = d.nor[a + 1] / 127, nz = d.nor[a + 2] / 127;
      var tx = -nz, tz = nx, tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;      // tangent 1 = n x up
      var ux = ny * tz, uy = nz * tx - nx * tz, uz = -ny * tx;                       // tangent 2 = n x t1
      for (var k = 0; k < 2; k++) {
        var j1 = rnd() * voxel, j2 = rnd() * voxel, o = b + k * 3;
        pos[o] = d.pos[a] + tx * j1 + ux * j2; pos[o + 1] = d.pos[a + 1] + uy * j2; pos[o + 2] = d.pos[a + 2] + tz * j1 + uz * j2;
        col[o] = d.col[a]; col[o + 1] = d.col[a + 1]; col[o + 2] = d.col[a + 2];
        nor[o] = d.nor[a]; nor[o + 1] = d.nor[a + 1]; nor[o + 2] = d.nor[a + 2];
      }
    }
    return { n: n * 2, nb: d.nb, prefix: d.prefix.map(function (v) { return v * 2; }), pos: pos, col: col, nor: nor };
  }

  var model, wall = null, pts, quad, vao, qvao, fbo = null, floatOK = false;
  var HP = 1131; // point rows per figure height (800 voxel rows x sqrt(2) after densify)
  var plate = document.querySelector('.plate');

  function cloud(data) {
    var v = gl.createVertexArray(); gl.bindVertexArray(v);
    [[data.pos, 0, gl.SHORT, false], [data.col, 1, gl.UNSIGNED_BYTE, true], [data.nor, 2, gl.BYTE, true]].forEach(function (a) {
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a[0], gl.STATIC_DRAW);
      gl.enableVertexAttribArray(a[1]); gl.vertexAttribPointer(a[1], 3, a[2], a[3], 0, 0);
    });
    gl.bindVertexArray(null);
    return { vao: v, n: data.n, nb: data.nb, prefix: data.prefix };
  }
  function setup(data) {
    pts = program(VS, FS, ['aPos', 'aCol', 'aNor']);
    quad = program(QVS, QFS, ['aP']);
    model = cloud(data); vao = model.vao;
    qvao = gl.createVertexArray(); gl.bindVertexArray(qvao);
    var qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    floatOK = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    delete window.__FIGURE__;
  }

  function makeTarget(w, h) {
    if (fbo) { gl.deleteFramebuffer(fbo.f); gl.deleteTexture(fbo.t); gl.deleteRenderbuffer(fbo.d); }
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var d = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, d);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) floatOK = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fbo = { f: f, t: t, d: d, w: w, h: h };
  }

  /* ---------- frame ---------- */
  var last = { key: '' }, small = window.matchMedia('(max-width: 700px)'), WALL_ASPECT = 1440 / 2630, WALL_FULL = 1800, WALL_END = 2700, WALL_DIM = 0.3;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, small.matches ? 2 : 1.5);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (floatOK && (!fbo || fbo.w !== w || fbo.h !== h)) makeTarget(w, h);
    return dpr;
  }

  function draw(now) {
    var dpr = resize();
    var W = canvas.clientWidth, H = canvas.clientHeight;
    var r = slot.getBoundingClientRect();
    var look = LOOKS[state.look], dots = state.look === 'dots';
    var theta = state.base + state.user + state.follow * state.away;
    var visible = r.height > 0 && ((r.bottom > -40 && r.top < H + 40) || (dots && wall && plate && plate.getBoundingClientRect().bottom * 1.2 > 0));
    var key = [state.look, theta.toFixed(4), r.left.toFixed(1), r.top.toFixed(1), r.height.toFixed(1), canvas.width, canvas.height, visible].join('|');
    var live = dots && visible && (!reduced || state.assemble < 1 || state.ptrGain > 0.01 || state.energy > 0.01 || state.ripT < 3);
    if (key === last.key && !live) return;
    last.key = key;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!visible) return;

    var cx = r.left + r.width / 2, h = r.height;
    var spacing = h * dpr / HP;

    gl.useProgram(pts.p);
    gl.uniform2f(pts.u.uRot, Math.cos(theta), Math.sin(theta));
    gl.uniform4f(pts.u.uMap, 2 * h / W, 2 * cx / W - 1, 2 * h / H, 1 - 2 * r.bottom / H);
    gl.uniform1f(pts.u.uTime, now / 1000);
    gl.uniform1f(pts.u.uDim, look.dim);
    gl.uniform1f(pts.u.uCut, 1.0);
    gl.uniform1f(pts.u.uIdle, reduced ? 0 : 1);
    gl.uniform1f(pts.u.uAssemble, state.assemble);
    gl.uniform1f(pts.u.uEnergy, state.energy);
    gl.uniform3f(pts.u.uPtr, (state.ptrX - cx) / h, (r.bottom - state.ptrY) / h, state.ptrGain);
    gl.uniform3f(pts.u.uRip, (state.ripX - cx) / h, (r.bottom - state.ripY) / h, state.ripT);
    gl.uniform1f(pts.u.uDir, state.dir);
    gl.uniform1f(pts.u.uFocusY, (r.bottom - H * 0.5) / h);
    gl.uniform1f(pts.u.uPtrR, 95 / h);
    gl.bindVertexArray(vao);

    if (dots && wall && plate) {
      // 0. the wall, also as a cloud: same shader, no body under it, drawn behind everything
      var pr = plate.getBoundingClientRect();
      var wh = pr.height, ww = wh * WALL_ASPECT, wcx = pr.left + pr.width / 2;
      var wgapCss = 3.9 * wh / 2630, wTarget = 2.3;
      var wb = Math.max(1, Math.min(wall.nb, Math.round(Math.pow(wgapCss / wTarget, 2) * wall.nb)));
      var wgap = wgapCss * dpr / Math.sqrt(wb / wall.nb);
      var wt = theta * 0.1;
      gl.enable(gl.SCISSOR_TEST);
      var below = wh * 0.2;
      gl.scissor(Math.max(0, Math.floor(pr.left * dpr)), Math.max(0, Math.floor((H - pr.bottom - below) * dpr)), Math.ceil(pr.width * dpr), Math.max(0, Math.ceil(Math.min(pr.bottom + below, H) * dpr)));
      gl.uniform2f(pts.u.uRot, Math.cos(wt), Math.sin(wt));
      gl.uniform1f(pts.u.uFocusY, (pr.bottom - H * 0.5) / wh);
      gl.uniform1f(pts.u.uPtrR, 95 / wh);
      gl.uniform1f(pts.u.uDim, WALL_DIM); gl.uniform1f(pts.u.uWall, 1); gl.uniform1f(pts.u.uBurst, 0); gl.uniform1f(pts.u.uPersp, 0);
      // full density up to WALL_FULL px wide (any laptop: simply cropped by the window),
      // then a long fade that ends at WALL_END px (27-inch and wider: the wall ends softly)
      gl.uniform1f(pts.u.uEdge, WALL_FULL / W); gl.uniform1f(pts.u.uEdge2, WALL_END / W);
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(pts.u.uDots, 1); gl.uniform1i(pts.u.uPass, 5); gl.uniform1f(pts.u.uEps, 0);
      gl.uniform1f(pts.u.uSize, Math.max(1.1 * dpr, Math.min(wgap * 0.78, 1.9 * dpr)));
      gl.bindVertexArray(wall.vao);
      // on screens wider than the wall it continues to both sides as mirrored copies, so the stripes meet
      var copies = Math.max(0, Math.ceil((pr.width / ww - 1) / 2));
      for (var ci = -copies; ci <= copies; ci++) {
        var mir = ci % 2 ? -1 : 1, ccx = wcx + ci * ww;
        gl.uniform4f(pts.u.uMap, mir * 2 * wh / W, 2 * ccx / W - 1, 2 * wh / H, 1 - 2 * pr.bottom / H);
        gl.uniform3f(pts.u.uPtr, mir * (state.ptrX - ccx) / wh, (pr.bottom - state.ptrY) / wh, state.ptrGain * 0.8);
        gl.uniform3f(pts.u.uRip, mir * (state.ripX - ccx) / wh, (pr.bottom - state.ripY) / wh, state.ripT);
        gl.uniform3f(pts.u.uSh, mir * (cx - ccx) / wh, (pr.bottom - r.bottom) / wh + 0.012 * h / wh, 0.19 * h / wh);
        gl.uniform1f(pts.u.uFlip, 1);
        gl.drawArrays(gl.POINTS, 0, wall.prefix[wb]);
        if (pr.bottom < H + 40) {                              // the floor continues below its line and fades out
          gl.uniform4f(pts.u.uMap, mir * 2 * wh / W, 2 * ccx / W - 1, -2 * wh / H, 1 - 2 * pr.bottom / H);
          gl.uniform1f(pts.u.uFlip, -1);
          gl.drawArrays(gl.POINTS, 0, wall.prefix[wb]);
        }
      }
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
      // back to the figure
      gl.bindVertexArray(vao);
      gl.uniform2f(pts.u.uRot, Math.cos(theta), Math.sin(theta));
      gl.uniform4f(pts.u.uMap, 2 * h / W, 2 * cx / W - 1, 2 * h / H, 1 - 2 * r.bottom / H);
      gl.uniform3f(pts.u.uPtr, (state.ptrX - cx) / h, (r.bottom - state.ptrY) / h, state.ptrGain);
      gl.uniform3f(pts.u.uRip, (state.ripX - cx) / h, (r.bottom - state.ripY) / h, state.ripT);
      gl.uniform1f(pts.u.uFocusY, (r.bottom - H * 0.5) / h);
      gl.uniform1f(pts.u.uPtrR, 95 / h);
      gl.uniform1f(pts.u.uDim, look.dim);
    }
    gl.uniform1f(pts.u.uWall, 0);
    gl.uniform1f(pts.u.uPersp, 0.42 * Math.min(1, (1 - Math.cos(theta)) * 0.9));
    gl.uniform1f(pts.u.uBurst, reduced || state.motion !== 'scroll' ? 0 : state.burst * 0.16);
    if (dots) {
      // 1. dark body: every point as an opaque disc, hides the wall and the far side
      var body = Math.min(1, Math.max(0, (state.assemble - 0.55) / 0.45)) * (state.motion === 'scroll' ? 1 - 0.15 * state.burst : 1);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      if (body > 0) {
        gl.enable(gl.BLEND); gl.blendColor(body, body, body, body * 0.9);
        gl.blendFuncSeparate(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        gl.uniform1f(pts.u.uDots, 0); gl.uniform1i(pts.u.uPass, 4); gl.uniform1f(pts.u.uEps, 0.03);
        gl.uniform1f(pts.u.uSize, Math.max(2, spacing * 2.4 * 1.6));
        gl.drawArrays(gl.POINTS, 0, model.prefix[3]);
      }
      // 2. the molecules: a random subset of the surface, small lit dots
      var G = look.gap * dpr;
      var buckets = Math.max(1, Math.min(model.nb, Math.round(Math.pow(spacing / G, 2) * model.nb)));
      var gap = spacing / Math.sqrt(buckets / model.nb);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthFunc(gl.LEQUAL);
      gl.uniform1f(pts.u.uDots, 1); gl.uniform1i(pts.u.uPass, 5); gl.uniform1f(pts.u.uEps, 0);
      gl.uniform1f(pts.u.uSize, Math.max(1.3 * dpr, Math.min(gap * look.dot, 2.1 * dpr)));
      gl.drawArrays(gl.POINTS, 0, model.prefix[buckets]);
      gl.disable(gl.BLEND);
      return;
    }

    var size = Math.max(2, spacing * look.k);
    gl.uniform1f(pts.u.uDots, 0); gl.uniform1f(pts.u.uSize, size);
    var pad = h * 0.08;
    var sx = Math.max(0, Math.floor((r.left - pad) * dpr)), sy = Math.max(0, Math.floor((H - r.bottom - pad) * dpr));
    var sw = Math.min(canvas.width - sx, Math.ceil((r.width + pad * 2) * dpr)), sh = Math.min(canvas.height - sy, Math.ceil((h + pad * 2) * dpr));
    if (sw <= 0 || sh <= 0) return;
    gl.enable(gl.SCISSOR_TEST); gl.scissor(sx, sy, sw, sh);

    if (!floatOK) {
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      gl.uniform1i(pts.u.uPass, 3); gl.uniform1f(pts.u.uEps, 0);
      gl.drawArrays(gl.POINTS, 0, model.n);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.f);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.uniform1i(pts.u.uPass, 0); gl.uniform1f(pts.u.uEps, 0.02);
    gl.drawArrays(gl.POINTS, 0, model.n);
    gl.colorMask(true, true, true, true); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1i(pts.u.uPass, 1); gl.uniform1f(pts.u.uEps, 0);
    gl.drawArrays(gl.POINTS, 0, model.n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
    gl.useProgram(quad.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbo.t); gl.uniform1i(quad.u.uTex, 0);
    gl.uniform1f(quad.u.uGain, Math.max(1, 2.2 / Math.max(spacing, 0.5)));
    gl.bindVertexArray(qvao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* ---------- motion ---------- */
  var prev = 0, spinGain = 0;
  function tick(now) {
    var dt = Math.min(0.05, (now - prev) / 1000 || 0); prev = now;
    if (!state.dragging) {
      state.user += state.vel * dt; state.vel *= Math.pow(0.04, dt);
      if (Math.abs(state.vel) < 0.01) state.vel = 0;
    }
    var free = !state.dragging && now > state.resumeAt;
    spinGain += ((free ? 1 : 0) - spinGain) * Math.min(1, dt * 3);
    if (state.motion === 'spin') state.base += 0.32 * dt * spinGain;
    else if (state.motion === 'scroll') {
      // the reliable front stays towards the viewer: +20deg at the head, -15deg at the feet, a slow sway on top
      var rr = slot.getBoundingClientRect(), vh = window.innerHeight;
      var p = Math.min(1, Math.max(0, (vh * 0.5 - rr.top) / rr.height));
      state.swingT += dt * spinGain;
      // faces the viewer at the head and at the feet, makes one full turn in between
      var sp = Math.min(1, Math.max(0, (p - 0.2) / 0.5)); sp = sp * sp * (3 - 2 * sp);
      var away = Math.min(1, p / 0.12);                       // at the top of the page: exactly the photo angle
      var to = state.rot0 - Math.PI * 2 * sp + 0.06 * Math.sin(state.swingT * 0.5) * away;
      state.burst = Math.sin(Math.PI * sp); state.away = away;
      state.base += (to - state.base) * Math.min(1, dt * 5);
    }
    // cursor: the figure turns a little towards it, dots part around it
    state.follow += (state.followTo - state.follow) * Math.min(1, dt * 3.5);
    state.ptrGain += (state.ptrOn - state.ptrGain) * Math.min(1, dt * (state.ptrOn > state.ptrGain ? 9 : 2.2));
    if (state.ptrOn > 0.25) state.ptrOn = Math.max(0.25, state.ptrOn - dt * 1.5);
    state.ripT += dt;
    // scroll: speed loosens the cloud, it settles in about half a second
    var sy = window.scrollY, dv = sy - state.lastScroll, v = Math.abs(dv) / Math.max(dt, 0.001); state.lastScroll = sy;
    if (dv) state.dir = dv > 0 ? 1 : -1;
    state.energy = Math.max(state.energy * Math.pow(0.012, dt), reduced ? 0 : Math.min(1, v / 3000));
    if (state.assemble < 1) { if (!state.t0) state.t0 = now; state.assemble = Math.min(1, (now - state.t0) / 2400); }
    draw(now);
    requestAnimationFrame(tick);
  }

  /* ---------- drag to rotate ---------- */
  var ptr = null;
  function inSlot(x, y) { var r = slot.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
  document.addEventListener('dragstart', function (e) { if (e.target.tagName === 'IMG') e.preventDefault(); });
  document.addEventListener('pointerdown', function (e) {
    if (e.button || !inSlot(e.clientX, e.clientY) || e.target.closest('a, button, input, [data-figure-ui]')) return;
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, lt: e.timeStamp, live: false };
  });
  window.addEventListener('pointermove', function (e) {
    if (!ptr || e.pointerId !== ptr.id) {
      if (e.pointerType === 'mouse') {
        var near = inSlot(e.clientX, e.clientY);
        root.style.cursor = near && !e.target.closest('a, button') ? 'grab' : '';
        state.ptrX = e.clientX; state.ptrY = e.clientY; state.ptrOn = 1;
        if (!reduced) state.followTo = (e.clientX / window.innerWidth - 0.5) * 0.2;
        var sp = Math.hypot(e.movementX || 0, e.movementY || 0); state.ptrOn = Math.min(1, 0.25 + sp / 40);
      }
      return;
    }
    var dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    if (!ptr.live) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) { if (Math.abs(dy) > 12) ptr = null; return; }
      ptr.live = true; state.dragging = true; state.vel = 0; root.classList.add('is-dragging');
      var sel = window.getSelection && window.getSelection(); if (sel) sel.removeAllRanges();
    }
    var step = (e.clientX - ptr.lx) * 0.0075, t = Math.max(1, e.timeStamp - ptr.lt);
    state.user += step; state.vel = step / (t / 1000) * 0.6;
    ptr.lx = e.clientX; ptr.lt = e.timeStamp;
    e.preventDefault();
  }, { passive: false });
  function release(e) {
    if (!ptr || (e && e.pointerId !== ptr.id)) return;
    if (!ptr.live && !reduced && inSlot(ptr.x, ptr.y)) { state.ripX = ptr.x; state.ripY = ptr.y; state.ripT = 0; }
    if (ptr.live) { state.dragging = false; state.resumeAt = performance.now() + 1400; root.classList.remove('is-dragging'); }
    ptr = null;
  }
  document.addEventListener('pointerleave', function () { state.ptrOn = 0; state.followTo = 0; });
  document.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { state.ptrX = e.clientX; state.ptrY = e.clientY; state.ptrOn = 1; } });
  window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') state.ptrOn = 0; });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  /* ---------- switcher ---------- */
  function sync() {
    if (!ui) return;
    ui.querySelectorAll('[data-look]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.look === state.look)); });
    ui.querySelectorAll('[data-motion]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.motion === state.motion)); });
  }
  if (ui) ui.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.look) state.look = b.dataset.look;
    if (b.dataset.motion) { state.motion = b.dataset.motion; state.user = 0; state.vel = 0; }
    sync();
  });

  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); root.classList.remove('is-3d'); });

  /* ---------- go ---------- */
  inflate(window.__FIGURE__).then(function (buf) {
    setup(densify(unpack(buf), 30000 / 800));
    if (window.__WALL__) inflate(window.__WALL__).then(function (wb) { wall = cloud(unpack(wb)); delete window.__WALL__; root.classList.add('is-wall'); }).catch(function () {});
    resize();
    sync();
    if (ui && params.get('ui') === '1') ui.hidden = false;
    requestAnimationFrame(function (t) { prev = t; draw(t); root.classList.add('is-3d'); requestAnimationFrame(tick); });
  }).catch(function (err) {
    root.classList.remove('wants-3d');
    if (window.console) console.warn('3D figure is off, the image stays:', err);
  });
})();
