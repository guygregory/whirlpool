/* Whirlpool - a tiny top-down 2D water playground.
   A coarse Eulerian velocity grid (stable fluids: forces, viscosity,
   vorticity confinement, pressure projection, semi-Lagrangian advection)
   drives a cloud of particles that make the flow visible. */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d', { alpha: false });

  var W = 0, H = 0, dpr = 1;

  // --- grid -----------------------------------------------------------
  var CELL = 14;            // grid cell size in CSS pixels
  var VISC = 0.06;          // how gooey the water is
  var DAMP = 0.9975;        // per-frame velocity loss
  var VORT = 0.28;          // vorticity confinement (keeps swirls crisp)
  var JET = 5200;           // jet acceleration
  var nx = 0, ny = 0;
  var u, v, u0, v0, p, div, curl;

  // --- particles ------------------------------------------------------
  var MAX_PARTICLES = 2400;
  var count = 0;
  var px, py, pvx, pvy, phue, pfade;

  // --- density balancing ----------------------------------------------
  // The flow sweeps tracers out of the quiet areas between the jets, which
  // leaves bald patches and hides the swirl. Every frame we count particles
  // in coarse bins and quietly recycle a few from the most crowded bins into
  // the emptiest ones, so the whole screen keeps a roughly even sprinkling.
  var BIN = 46;             // density bin size in CSS pixels
  var RECYCLE_RATE = 0.02;  // fraction of the cloud that may move per frame
  var FADE_IN = 4;          // fade speed of a recycled particle (per second)
  var bnx = 0, bny = 0, bins, sparse, sparseCount = 0;

  // --- input ----------------------------------------------------------
  var jetLeft = false, jetRight = false;
  var tiltX = 0, tiltY = 0;
  var pointers = {};

  function idx(i, j) { return j * nx + i; }

  function alloc() {
    var n = nx * ny;
    u = new Float32Array(n);
    v = new Float32Array(n);
    u0 = new Float32Array(n);
    v0 = new Float32Array(n);
    p = new Float32Array(n);
    div = new Float32Array(n);
    curl = new Float32Array(n);
  }

  function seedParticles() {
    px = new Float32Array(MAX_PARTICLES);
    py = new Float32Array(MAX_PARTICLES);
    pvx = new Float32Array(MAX_PARTICLES);
    pvy = new Float32Array(MAX_PARTICLES);
    phue = new Float32Array(MAX_PARTICLES);
    pfade = new Float32Array(MAX_PARTICLES);
    count = MAX_PARTICLES;
    for (var i = 0; i < count; i++) placeParticle(i, true);
  }

  function placeParticle(i, anywhere) {
    px[i] = CELL + Math.random() * (W - 2 * CELL);
    py[i] = anywhere ? CELL + Math.random() * (H - 2 * CELL)
                     : CELL + Math.random() * (H - 2 * CELL);
    pvx[i] = 0;
    pvy[i] = 0;
    phue[i] = 172 + Math.random() * 48;
    pfade[i] = 1;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var root = document.documentElement;
    W = Math.max(1, Math.round(root.clientWidth || window.innerWidth));
    H = Math.max(1, Math.round(root.clientHeight || window.innerHeight));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#01121f';
    ctx.fillRect(0, 0, W, H);

    nx = Math.max(6, Math.ceil(W / CELL) + 2);
    ny = Math.max(6, Math.ceil(H / CELL) + 2);
    alloc();
    bnx = Math.max(1, Math.ceil(W / BIN));
    bny = Math.max(1, Math.ceil(H / BIN));
    bins = new Int32Array(bnx * bny);
    sparse = new Int32Array(bnx * bny);
    sparseCount = 0;
    if (!px) seedParticles(); else clampParticles();
  }

  function clampParticles() {
    for (var i = 0; i < count; i++) {
      px[i] = Math.min(Math.max(px[i], CELL), W - CELL);
      py[i] = Math.min(Math.max(py[i], CELL), H - CELL);
    }
  }

  // --- fluid steps -----------------------------------------------------
  function bounds() {
    var i, j;
    for (i = 0; i < nx; i++) {
      u[idx(i, 0)] = 0; v[idx(i, 0)] = 0;
      u[idx(i, ny - 1)] = 0; v[idx(i, ny - 1)] = 0;
    }
    for (j = 0; j < ny; j++) {
      u[idx(0, j)] = 0; v[idx(0, j)] = 0;
      u[idx(nx - 1, j)] = 0; v[idx(nx - 1, j)] = 0;
    }
  }

  function addJet(cx, cy, dx, dy, strength, radius) {
    var r = radius / CELL;
    var ci = cx / CELL, cj = cy / CELL;
    var i0 = Math.max(1, Math.floor(ci - r)), i1 = Math.min(nx - 2, Math.ceil(ci + r));
    var j0 = Math.max(1, Math.floor(cj - r)), j1 = Math.min(ny - 2, Math.ceil(cj + r));
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var ddx = i - ci, ddy = j - cj;
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d > r) continue;
        var f = strength * (1 - d / r);
        var n = idx(i, j);
        u[n] += dx * f;
        v[n] += dy * f;
      }
    }
  }

  function applyForces(dt) {
    var s = JET * dt;
    var r = Math.min(W, H) * 0.13;
    // Two opposing streams placed on the ring the water wants to travel on.
    // Each one sits in a lane just inside a wall running along the long axis
    // and fires *along* that wall, starting upstream so the stream has a full
    // side and corner of runway before it meets the other jet. Point-symmetric
    // about the centre, so the pair is a pure couple: nothing cancels, and the
    // whole basin turns instead of just sloshing across.
    var LANE = 0.16;   // distance from the wall, as a fraction of the short side
    var UP = 0.32;     // how far upstream along the wall each jet starts
    if (H >= W) {
      // portrait: the long walls are the sides, so the jets blow up and down
      if (jetLeft) addJet(W * LANE, H * UP, 0, 1, s, r);
      if (jetRight) addJet(W * (1 - LANE), H * (1 - UP), 0, -1, s, r);
    } else {
      // landscape: the long walls are the top and bottom
      if (jetLeft) addJet(W * UP, H * (1 - LANE), 1, 0, s, r);
      if (jetRight) addJet(W * (1 - UP), H * LANE, -1, 0, s, r);
    }

    // Gyroscope tilt - a gentle secondary drift.
    if (tiltX || tiltY) {
      var gx = tiltX * 260 * dt, gy = tiltY * 260 * dt;
      for (var n = 0; n < u.length; n++) { u[n] += gx; v[n] += gy; }
    }

    // Fingers stirring the water directly.
    for (var id in pointers) {
      var pt = pointers[id];
      var dx = pt.x - pt.lx, dy = pt.y - pt.ly;
      if (dx || dy) addJet(pt.x, pt.y, dx, dy, 30, Math.min(W, H) * 0.09);
      pt.lx = pt.x; pt.ly = pt.y;
    }
  }

  function diffuse() {
    if (VISC <= 0) return;
    u0.set(u); v0.set(v);
    var a = VISC;
    for (var j = 1; j < ny - 1; j++) {
      for (var i = 1; i < nx - 1; i++) {
        var n = idx(i, j);
        u[n] = u0[n] + a * (u0[n - 1] + u0[n + 1] + u0[n - nx] + u0[n + nx] - 4 * u0[n]);
        v[n] = v0[n] + a * (v0[n - 1] + v0[n + 1] + v0[n - nx] + v0[n + nx] - 4 * v0[n]);
      }
    }
  }

  function vorticity(dt) {
    if (VORT <= 0) return;
    var i, j, n;
    for (j = 1; j < ny - 1; j++) {
      for (i = 1; i < nx - 1; i++) {
        n = idx(i, j);
        curl[n] = 0.5 * ((v[n + 1] - v[n - 1]) - (u[n + nx] - u[n - nx]));
      }
    }
    for (j = 2; j < ny - 2; j++) {
      for (i = 2; i < nx - 2; i++) {
        n = idx(i, j);
        var gx = 0.5 * (Math.abs(curl[n + 1]) - Math.abs(curl[n - 1]));
        var gy = 0.5 * (Math.abs(curl[n + nx]) - Math.abs(curl[n - nx]));
        var len = Math.sqrt(gx * gx + gy * gy) + 1e-5;
        gx /= len; gy /= len;
        var f = VORT * curl[n] * dt * 60;
        u[n] += gy * f;
        v[n] -= gx * f;
      }
    }
  }

  function project() {
    var i, j, n;
    for (j = 1; j < ny - 1; j++) {
      for (i = 1; i < nx - 1; i++) {
        n = idx(i, j);
        div[n] = 0.5 * (u[n + 1] - u[n - 1] + v[n + nx] - v[n - nx]);
        p[n] = 0;
      }
    }
    for (var k = 0; k < 16; k++) {
      for (j = 1; j < ny - 1; j++) {
        for (i = 1; i < nx - 1; i++) {
          n = idx(i, j);
          p[n] = (p[n - 1] + p[n + 1] + p[n - nx] + p[n + nx] - div[n]) * 0.25;
        }
      }
      // free-slip walls: pressure mirrors the neighbouring cell
      for (j = 1; j < ny - 1; j++) {
        p[idx(0, j)] = p[idx(1, j)];
        p[idx(nx - 1, j)] = p[idx(nx - 2, j)];
      }
      for (i = 0; i < nx; i++) {
        p[idx(i, 0)] = p[idx(i, 1)];
        p[idx(i, ny - 1)] = p[idx(i, ny - 2)];
      }
    }
    for (j = 1; j < ny - 1; j++) {
      for (i = 1; i < nx - 1; i++) {
        n = idx(i, j);
        u[n] -= 0.5 * (p[n + 1] - p[n - 1]);
        v[n] -= 0.5 * (p[n + nx] - p[n - nx]);
      }
    }
    bounds();
  }

  function sample(field, gx, gy) {
    var i = gx | 0, j = gy | 0;
    if (i < 0) i = 0; else if (i > nx - 2) i = nx - 2;
    if (j < 0) j = 0; else if (j > ny - 2) j = ny - 2;
    var fx = gx - i, fy = gy - j;
    if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
    if (fy < 0) fy = 0; else if (fy > 1) fy = 1;
    var a = j * nx + i;
    return (field[a] * (1 - fx) + field[a + 1] * fx) * (1 - fy) +
           (field[a + nx] * (1 - fx) + field[a + nx + 1] * fx) * fy;
  }

  function advectField(dt) {
    u0.set(u); v0.set(v);
    var step = dt / CELL;
    for (var j = 1; j < ny - 1; j++) {
      for (var i = 1; i < nx - 1; i++) {
        var n = idx(i, j);
        var x = i - u0[n] * step;
        var y = j - v0[n] * step;
        u[n] = sample(u0, x, y) * DAMP;
        v[n] = sample(v0, x, y) * DAMP;
      }
    }
    bounds();
  }

  function moveParticles(dt) {
    var lo = 1.5, hiX = W - 1.5, hiY = H - 1.5;
    for (var k = 0; k < count; k++) {
      var gx = px[k] / CELL, gy = py[k] / CELL;
      var fu = sample(u, gx, gy);
      var fv = sample(v, gx, gy);
      // ease towards the flow so particles keep a little momentum of their own
      var vx = pvx[k] + (fu - pvx[k]) * 0.35;
      var vy = pvy[k] + (fv - pvy[k]) * 0.35;

      // a whisper of jitter stops tracers collapsing into thin threads
      var x = px[k] + vx * dt + (Math.random() - 0.5) * 26 * dt;
      var y = py[k] + vy * dt + (Math.random() - 0.5) * 26 * dt;
      if (x < lo) { x = lo; vx = Math.abs(vx) * 0.3; }
      else if (x > hiX) { x = hiX; vx = -Math.abs(vx) * 0.3; }
      if (y < lo) { y = lo; vy = Math.abs(vy) * 0.3; }
      else if (y > hiY) { y = hiY; vy = -Math.abs(vy) * 0.3; }

      px[k] = x; py[k] = y; pvx[k] = vx; pvy[k] = vy;
      if (pfade[k] < 1) {
        var f = pfade[k] + FADE_IN * dt;
        pfade[k] = f > 1 ? 1 : f;
      }
    }
  }

  function binOf(x, y) {
    var i = (x / BIN) | 0, j = (y / BIN) | 0;
    if (i < 0) i = 0; else if (i > bnx - 1) i = bnx - 1;
    if (j < 0) j = 0; else if (j > bny - 1) j = bny - 1;
    return j * bnx + i;
  }

  // Move a few particles per frame out of the crowded streams and into the
  // areas the flow has emptied, so every part of the screen keeps tracers.
  function balanceDensity() {
    var nb = bnx * bny, b, k;
    for (b = 0; b < nb; b++) bins[b] = 0;
    for (k = 0; k < count; k++) bins[binOf(px[k], py[k])]++;

    var target = count / nb;
    var lean = target * 0.6, crowded = target * 1.4;
    sparseCount = 0;
    for (b = 0; b < nb; b++) if (bins[b] < lean) sparse[sparseCount++] = b;
    if (!sparseCount) return;

    var budget = Math.max(1, Math.round(count * RECYCLE_RATE));
    var tries = budget * 8, moved = 0;
    for (var t = 0; t < tries && moved < budget; t++) {
      k = (Math.random() * count) | 0;
      var from = binOf(px[k], py[k]);
      if (bins[from] <= crowded) continue;
      var to = sparse[(Math.random() * sparseCount) | 0];
      if (bins[to] >= target) continue;

      bins[from]--; bins[to]++;
      var bi = to % bnx, bj = (to / bnx) | 0;
      var x = bi * BIN + Math.random() * BIN;
      var y = bj * BIN + Math.random() * BIN;
      px[k] = Math.min(Math.max(x, 1.5), W - 1.5);
      py[k] = Math.min(Math.max(y, 1.5), H - 1.5);
      // start with the local flow so the tracer joins in instead of stalling
      pvx[k] = sample(u, px[k] / CELL, py[k] / CELL);
      pvy[k] = sample(v, px[k] / CELL, py[k] / CELL);
      pfade[k] = 0;   // fade in, so the jump itself is invisible
      moved++;
    }
  }

  function render() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(1, 18, 31, 0.26)';
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < count; k++) {
      var sp = Math.sqrt(pvx[k] * pvx[k] + pvy[k] * pvy[k]);
      var t = sp / 400;
      if (t > 1) t = 1;
      ctx.globalAlpha = pfade[k];
      ctx.fillStyle = 'hsl(' + (phue[k] - t * 46) + ',95%,' + (40 + t * 45) + '%)';
      ctx.fillRect(px[k] - 1.5, py[k] - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  var last = 0;
  function frame(now) {
    var dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    if (dt > 0.04) dt = 0.04;
    if (dt <= 0) dt = 0.016;

    applyForces(dt);
    diffuse();
    vorticity(dt);
    project();
    advectField(dt);
    project();
    moveParticles(dt);
    balanceDensity();
    render();
    requestAnimationFrame(frame);
  }

  // --- buttons (multi-touch friendly) ----------------------------------
  function bindJet(el, set) {
    var held = 0;
    function down(e) {
      held++;
      el.classList.add('active');
      set(true);
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      e.preventDefault();
    }
    function up(e) {
      held = Math.max(0, held - 1);
      if (!held) { el.classList.remove('active'); set(false); }
      e.preventDefault();
    }
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  bindJet(document.getElementById('jet-left'), function (on) { jetLeft = on; });
  bindJet(document.getElementById('jet-right'), function (on) { jetRight = on; });

  canvas.addEventListener('pointerdown', function (e) {
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
  });
  canvas.addEventListener('pointermove', function (e) {
    var pt = pointers[e.pointerId];
    if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
  });
  function endPointer(e) { delete pointers[e.pointerId]; }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', endPointer);

  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  // --- gyroscope (a secondary flavour, not the main event) -------------
  function onOrientation(e) {
    var beta = e.beta || 0;    // front/back tilt
    var gamma = e.gamma || 0;  // left/right tilt
    tiltX = Math.max(-1, Math.min(1, gamma / 40));
    tiltY = Math.max(-1, Math.min(1, (beta - 40) / 40));
  }

  var tiltBtn = document.getElementById('tilt');
  if (window.DeviceOrientationEvent) {
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      tiltBtn.hidden = false;
      tiltBtn.addEventListener('click', function () {
        window.DeviceOrientationEvent.requestPermission().then(function (state) {
          if (state === 'granted') {
            window.addEventListener('deviceorientation', onOrientation);
            tiltBtn.hidden = true;
          }
        }).catch(function () {});
      });
    } else {
      window.addEventListener('deviceorientation', onOrientation);
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

  resize();
  requestAnimationFrame(frame);
})();
