(() => {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);

// shared state
const ptr = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0, has: false };
const App = { warp: 12, warpTarget: 12 };

addEventListener('pointermove', e => {
  ptr.x = e.clientX; ptr.y = e.clientY;
  ptr.nx = (e.clientX / innerWidth - .5) * 2;
  ptr.ny = (e.clientY / innerHeight - .5) * 2;
  ptr.has = true;
}, { passive: true });
addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') ptr.has = false; });
addEventListener('pointercancel', () => { ptr.has = false; });   // e.g. a touch turned into a scroll
document.documentElement.addEventListener('mouseleave', () => { ptr.has = false; });
addEventListener('deviceorientation', e => {
  if (e.gamma == null || ptr.has) return;
  ptr.nx = Math.max(-1, Math.min(1, e.gamma / 30));
  ptr.ny = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
});

/* ============================================================
   SOUND  (synthesised with WebAudio - no audio files needed)
   Browsers only allow audio after the first click/tap.
   ============================================================ */
const Sound = (() => {
  let ctx = null, unlocked = false, muted = false, noiseBuf = null;
  try { muted = localStorage.getItem('muted') === '1'; } catch (e) {}

  function ac() {
    if (!unlocked) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f1, f2, dur, vol, type) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + .03);
  }
  return {
    unlock() { unlocked = true; },
    get muted() { return muted; },
    setMuted(v) {
      muted = v;
      try { localStorage.setItem('muted', v ? '1' : '0'); } catch (e) {}
    },
    hover() { tone(1250, 1700, .07, .02); },
    click() { tone(420, 760, .12, .05, 'triangle'); setTimeout(() => tone(760, 1100, .1, .03), 55); },
    enter() { tone(220, 880, .6, .05, 'sine'); },
    whoosh() {
      if (muted) return;
      const c = ac(); if (!c) return;
      if (!noiseBuf) {
        noiseBuf = c.createBuffer(1, c.sampleRate * 1.2, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3500, t + 1);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.05, t + .25);
      g.gain.exponentialRampToValueAtTime(.0001, t + 1.1);
      s.connect(f); f.connect(g); g.connect(c.destination);
      s.start(t); s.stop(t + 1.2);
    }
  };
})();

/* ============================================================
   WEBGL BACKGROUND: 3D starfield + fluid nebula in one shader
   ============================================================ */
(() => {
  const canvas = $('#gl');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { canvas.remove(); return; }

  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uTime; uniform float uTravel; uniform vec2 uMouse; uniform float uFlash;

float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y);
}
float fbm(vec2 p){
  float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<4;i++){ v+=a*noise(p); p=m*p; a*=.5; }
  return v;
}
// one depth layer of stars flying toward the camera
float starLayer(vec2 uv, float i){
  float z = fract(uTravel + i/6.);
  float sc = mix(22., 1.6, z);
  float fade = smoothstep(0.,.12,z) * smoothstep(1.,.72,z);
  vec2 p = (uv + uMouse*.05*(1.-z)) * sc + i*41.7;
  vec2 id = floor(p), f = fract(p)-.5;
  float h = hash(id + i*7.1);
  if(h < .85) return 0.;
  vec2 off = (vec2(hash(id+3.1), hash(id+9.7)) - .5) * .5;
  float d = length(f-off);
  float size = .03 + .06*hash(id+5.5);
  float tw = .65 + .35*sin(uTime*(1.5+h*3.) + h*60.);
  float core = smoothstep(size,0.,d);
  float halo = exp(-d*d/(size*size*3.)) * smoothstep(.25,.06,d) * .3;
  return (core+halo) * fade * tw;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  float asp = uRes.x/uRes.y;

  // black hole drifting along a slow looping path
  vec2 bh = vec2(.55*sin(uTime*.11+1.)*min(asp,1.2), .32*cos(uTime*.075));
  vec2 d = uv - bh;
  float br = length(d);
  vec2 uvl = uv - d*(.012/(br*br+.012));          // gravitational lensing

  // fast, swirling, domain-warped nebula (greyscale)
  float t = uTime*.22, a = .3*sin(uTime*.1);
  vec2 p = mat2(cos(a),-sin(a),sin(a),cos(a))*uvl*1.5 + uMouse*.12;
  vec2 q = vec2(fbm(p+t), fbm(p+vec2(5.2,1.3)-t));
  vec2 w = vec2(fbm(p+3.*q+vec2(1.7,9.2)+1.5*t), fbm(p+3.*q+vec2(8.3,2.8)-1.2*t));
  float f = fbm(p+3.*w);
  float neb = pow(smoothstep(.24,.9,f),1.25)*(.3+.7*w.x);
  vec3 col = vec3(neb*.4);

  float s = 0.;
  for(int k=0;k<6;k++){ s += starLayer(uvl, float(k)); }
  col += vec3(s);

  // accretion disk + photon ring + event horizon
  float ang = atan(d.y,d.x);
  float rr = length(vec2(d.x, d.y*3.4));
  float disk = exp(-pow((rr-.13)/.022,2.)) * (.55 + .45*sin(ang*2. - uTime*2.6));
  float photon = exp(-pow((br-.058)/.006,2.));
  col += vec3(disk*.9 + photon*.8 + exp(-br*7.)*.12);
  col *= smoothstep(.042,.056,br);

  // slow supernova flash with expanding shockwave (every 8s, smooth decay)
  float cyc = floor(uTime/8.), ph = fract(uTime/8.);
  vec2 fp = (vec2(hash(vec2(cyc,1.)),hash(vec2(cyc,2.)))-.5)*vec2(1.5*min(asp,1.2),.9);
  float fd = length(uv-fp);
  float env = smoothstep(0.,.05,ph)*exp(-ph*4.5)*uFlash;
  col += vec3(env*(.05/(fd+.06))*.35);
  col += vec3(exp(-pow((fd-ph*.9)/.025,2.))*env*.5);
  col += vec3(neb*env*.35);

  col = min(col, vec3(1.));
  vec2 vn = gl_FragCoord.xy/uRes - .5;
  col *= 1. - .9*dot(vn,vn);
  gl_FragColor = vec4(col,1.);
}`;

  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) { canvas.remove(); return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'uRes'), uTime = gl.getUniformLocation(prog, 'uTime'),
        uTravel = gl.getUniformLocation(prog, 'uTravel'), uMouse = gl.getUniformLocation(prog, 'uMouse');

  let q = fine ? .85 : .6, W = 0, H = 0;   // render scale (auto-lowered on slow devices)
  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = Math.max(2, Math.floor(innerWidth * dpr * q));
    H = Math.max(2, Math.floor(innerHeight * dpr * q));
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
  }
  size();

  // visitors with "reduce motion" on still get a gentle (half speed, no flashes) moving background
  const SPEED = reduce ? .5 : 1;
  gl.uniform1f(gl.getUniformLocation(prog, 'uFlash'), reduce ? 0 : 1);
  let time = 0, travel = 0, last = performance.now(), sx = 0, sy = 0, acc = 0, frames = 0;
  function draw() {
    gl.uniform2f(uRes, W, H); gl.uniform1f(uTime, time); gl.uniform1f(uTravel, travel);
    gl.uniform2f(uMouse, sx, -sy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now) {
    const dt = Math.min((now - last) / 1000, .1); last = now;
    App.warp += (App.warpTarget - App.warp) * (1 - Math.exp(-dt * 2.2));
    time += dt * SPEED; travel += dt * App.warp * .1 * SPEED;
    sx += (ptr.nx - sx) * .05; sy += (ptr.ny - sy) * .05;
    draw();
    // auto quality: if frames are slow, render at a lower resolution
    acc += dt; frames++;
    if (frames === 90) {
      if (acc / 90 > .032 && q > .42) { q *= .85; size(); }
      acc = 0; frames = 0;
    }
    requestAnimationFrame(loop);
  }
  addEventListener('resize', size);
  requestAnimationFrame(loop);
})();

/* ============================================================
   2D FX: constellation, cursor web, shooting stars, meteor shower
   ============================================================ */
const Fx = (() => {
  const c = $('#fx'), x = c.getContext('2d');
  let w, h, dpr, pts = [], shooters = [], sparks = [], sx = 0, sy = 0;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, fine ? 2 : 1.5); w = innerWidth; h = innerHeight;
    c.width = w * dpr; c.height = h * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(w * h / 11000);
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h, z: Math.random(),
      r: Math.random() * 1.1 + .3, ph: Math.random() * 6.28, sp: rnd(.5, 2)
    }));
  }

  function ambient() {
    shooters.push({ x: rnd(w * .1, w * .9), y: rnd(0, h * .4), vx: rnd(6, 10), vy: rnd(3, 5.5), life: 0, max: 55 });
  }
  function meteor() {
    if (reduce) return;
    for (let i = 0; i < 26; i++) {
      setTimeout(() => shooters.push({
        x: rnd(-w * .1, w), y: -10 - Math.random() * h * .25,
        vx: rnd(8, 15), vy: rnd(4.5, 9), life: 0, max: 70 + Math.random() * 35
      }), i * 85 + Math.random() * 120);
    }
  }
  if (fine && !reduce) addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || sparks.length > 70) return;
    sparks.push({ x: e.clientX, y: e.clientY, vx: rnd(-.5, .5), vy: rnd(-.3, .6), life: 0, max: rnd(26, 46) });
  }, { passive: true });

  function draw(t) {
    x.clearRect(0, 0, w, h);
    const time = t / 1000, L = 120, CL = 190;
    sx += (ptr.nx - sx) * .05; sy += (ptr.ny - sy) * .05;

    const P = [];
    x.fillStyle = '#fff';
    for (const p of pts) {
      p.y -= (.02 + p.z * .12) * (reduce ? .5 : 1); p.x += (.01 + p.z * .05) * (reduce ? .5 : 1);
      if (p.y < -20) { p.y = h + 20; p.x = Math.random() * w; }
      if (p.x > w + 20) p.x = -20;
      let X = p.x - sx * p.z * 22, Y = p.y - sy * p.z * 22;
      if (ptr.has) {            // pulled gently toward the cursor
        const dx = ptr.x - X, dy = ptr.y - Y, d = Math.hypot(dx, dy);
        if (d < CL) { const f = (1 - d / CL) * .28; X += dx * f; Y += dy * f; }
      }
      x.globalAlpha = .3 + .35 * Math.sin(time * p.sp + p.ph);
      x.beginPath(); x.arc(X, Y, p.r, 0, 6.2832); x.fill();
      P.push(X, Y);
    }

    {
      x.strokeStyle = '#fff'; x.lineWidth = .7;
      for (let i = 0; i < P.length; i += 2) {
        for (let j = i + 2; j < P.length; j += 2) {
          const dx = P[i] - P[j], dy = P[i + 1] - P[j + 1], d2 = dx * dx + dy * dy;
          if (d2 < L * L) {
            x.globalAlpha = (1 - Math.sqrt(d2) / L) * .28;
            x.beginPath(); x.moveTo(P[i], P[i + 1]); x.lineTo(P[j], P[j + 1]); x.stroke();
          }
        }
        if (ptr.has) {
          const d = Math.hypot(P[i] - ptr.x, P[i + 1] - ptr.y);
          if (d < CL) {
            x.globalAlpha = (1 - d / CL) * .7;
            x.beginPath(); x.moveTo(P[i], P[i + 1]); x.lineTo(ptr.x, ptr.y); x.stroke();
          }
        }
      }

      if (!reduce && Math.random() < .012 && shooters.length < 3) ambient();
      shooters = shooters.filter(s => s.life < s.max);
      for (const s of shooters) {
        s.x += s.vx; s.y += s.vy; s.life++;
        const f = 1 - s.life / s.max, tx = s.x - s.vx * 14, ty = s.y - s.vy * 14;
        const g = x.createLinearGradient(s.x, s.y, tx, ty);
        g.addColorStop(0, 'rgba(255,255,255,' + f + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.globalAlpha = 1; x.strokeStyle = g; x.lineWidth = 1.6;
        x.beginPath(); x.moveTo(s.x, s.y); x.lineTo(tx, ty); x.stroke();
      }

      sparks = sparks.filter(s => s.life < s.max);
      x.fillStyle = '#fff';
      for (const s of sparks) {
        s.x += s.vx; s.y += s.vy; s.life++;
        x.globalAlpha = (1 - s.life / s.max) * .8;
        x.beginPath(); x.arc(s.x, s.y, 1.3 * (1 - s.life / s.max) + .3, 0, 6.2832); x.fill();
      }
    }
    x.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
  return { meteor };
})();

// optional background video (bg.webm / bg.mp4); silently skipped if missing or data-saver is on
(() => {
  const v = $('#bgv');
  const saver = navigator.connection && navigator.connection.saveData;
  if (reduce || saver) { v.remove(); return; }
  v.addEventListener('loadeddata', () => {
    document.body.classList.add('has-video');
    const p = v.play(); if (p && p.catch) p.catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) v.pause(); else if (document.body.classList.contains('has-video')) v.play().catch(() => {});
  });
})();

// endlessly looping CSS shooting stars
(() => {
  if (reduce) return;
  const box = $('#shoot');
  for (let n = 0; n < 14; n++) {
    const i = document.createElement('i'), d = rnd(5, 11);
    i.style.cssText = '--x:' + rnd(-5, 95) + '%;--y:' + rnd(-10, 55) + '%;--len:' + rnd(90, 200) + 'px;--rot:' + rnd(25, 42) +
      'deg;--dist:' + rnd(600, 1200) + 'px;--d:' + d + 's;--delay:-' + rnd(0, d) + 's';
    box.appendChild(i);
  }
})();

/* ============================================================
   LANGUAGE + TYPEWRITER
   ============================================================ */
(() => {
  const I18N = {
    en: { music: 'Music', discord: 'Join Discord', donate: 'Donate (Inpestz)', skip: 'Click to skip', snd: 'Sound',
          words: ['Official Links', 'Join the Community', 'Support the Channel'] },
    th: { music: 'เพลง', discord: 'เข้าร่วม Discord', donate: 'สนับสนุน (Inpestz)', skip: 'แตะเพื่อข้าม', snd: 'เสียง',
          words: ['ลิงก์ทางการ', 'เข้าร่วมคอมมูนิตี้', 'สนับสนุนช่อง'] }
  };
  const el = $('#tag');
  let lang = '';
  try { lang = localStorage.getItem('lang') || ''; } catch (e) {}
  if (!I18N[lang]) lang = (navigator.language || '').toLowerCase().startsWith('th') ? 'th' : 'en';

  let i = 0, j = 0, del = false, timer = 0;
  function tick() {
    const word = I18N[lang].words[i];
    el.textContent = word.slice(0, j);
    if (!del && j === word.length) { del = true; return timer = setTimeout(tick, 1800); }
    if (del && j === 0) { del = false; i = (i + 1) % I18N[lang].words.length; return timer = setTimeout(tick, 350); }
    j += del ? -1 : 1;
    timer = setTimeout(tick, del ? 35 : 80);
  }
  function apply(l) {
    lang = l;
    try { localStorage.setItem('lang', l); } catch (e) {}
    document.documentElement.lang = l;
    $$('[data-i18n]').forEach(n => n.textContent = I18N[l][n.dataset.i18n]);
    $('#snd').setAttribute('aria-label', I18N[l].snd);
    $$('.lang button').forEach(b => {
      const on = b.dataset.lang === l;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    clearTimeout(timer); i = j = 0; del = false;
    if (reduce) el.textContent = I18N[l].words[0]; else tick();
  }
  $$('.lang button').forEach(b => b.addEventListener('click', () => apply(b.dataset.lang)));
  apply(lang);
})();

$('#y').textContent = new Date().getFullYear();

/* ============================================================
   INTRO
   ============================================================ */
const intro = $('#intro');
let introDone = false;
function endIntro(withSound) {
  if (introDone) return;
  introDone = true;
  App.warpTarget = 1;
  intro.classList.add('out');
  document.body.classList.add('ready');
  if (withSound) Sound.enter();
  setTimeout(() => intro.remove(), 1200);
}
if (reduce) { App.warp = 1; endIntro(false); }
else {
  setTimeout(() => endIntro(false), 2400);
  intro.addEventListener('pointerdown', () => { Sound.unlock(); endIntro(true); });
  addEventListener('keydown', () => { Sound.unlock(); endIntro(true); }, { once: true });
}

/* ============================================================
   GLASS LIGHT, BUTTON TILT, RIPPLE, METEOR, SOUND WIRING
   ============================================================ */
$$('.glass').forEach(el => {
  const isBtn = el.classList.contains('btn');
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    el.style.setProperty('--mx', px + 'px'); el.style.setProperty('--my', py + 'px');
    if (isBtn && e.pointerType === 'mouse') {
      el.style.setProperty('--ry', ((px / r.width) - .5) * 10 + 'deg');
      el.style.setProperty('--rx', -((py / r.height) - .5) * 8 + 'deg');
    }
  });
  el.addEventListener('pointerleave', () => {
    ['--mx', '--my', '--rx', '--ry'].forEach(k => el.style.removeProperty(k));
  });
});

$$('.btn').forEach(b => b.addEventListener('pointerdown', e => {
  const box = b.querySelector('.ripbox'), r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
  const s = document.createElement('span'); s.className = 'rip';
  s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
  box.appendChild(s); setTimeout(() => s.remove(), 700);
  if (b.hasAttribute('data-meteor')) { Fx.meteor(); Sound.whoosh(); }
}));

/* ---------- link transition: warp + loading screen, then open the link ---------- */
const go = $('#go'), goIcon = $('#goIcon'), goText = $('#goText');
const OPENING = { en: 'Opening', th: 'กำลังเปิด' };
let going = false;
$$('.btn').forEach(a => a.addEventListener('click', e => {
  // let ctrl/cmd/shift/middle clicks behave normally (new tab)
  if (going || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault(); going = true;
  goIcon.innerHTML = a.querySelector('svg').outerHTML;
  goText.textContent = (OPENING[document.documentElement.lang] || OPENING.en) + ' ' + (a.dataset.name || '');
  go.classList.add('show');
  App.warpTarget = reduce ? 3 : 16;      // hyperspace jump (milder with reduce-motion)
  Sound.whoosh();
  setTimeout(() => { location.href = a.href; }, 1300);
  setTimeout(() => { going = false; go.classList.remove('show'); App.warpTarget = 1; }, 7000); // safety reset
}));
// coming back with the browser's Back button: clear the loading screen
addEventListener('pageshow', e => {
  if (e.persisted) { going = false; go.classList.remove('show'); App.warpTarget = 1; }
});

/* ---------- background music (music.mp3) ---------- */
const bgm = $('#bgm'), mus = $('#mus');
let wantMusic = true, fadeT = 0;
try { wantMusic = localStorage.getItem('music') !== 'off'; } catch (e) {}
bgm.volume = 0;
function fadeTo(v, ms, done) {
  clearInterval(fadeT);
  const from = bgm.volume, t0 = performance.now();
  fadeT = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    bgm.volume = from + (v - from) * k;
    if (k === 1) { clearInterval(fadeT); if (done) done(); }
  }, 30);
}
function startMusic() {
  const p = bgm.play();
  if (p && p.then) p.then(() => fadeTo(.5, 1800)).catch(() => {});   // blocked until the first click/tap
}
function paintMusic() {
  mus.classList.toggle('off', bgm.paused);
  mus.setAttribute('aria-pressed', String(!bgm.paused));
}
bgm.addEventListener('play', paintMusic);
bgm.addEventListener('pause', paintMusic);
mus.addEventListener('click', () => {
  if (bgm.paused) {
    wantMusic = true; startMusic();
  } else {
    wantMusic = false; fadeTo(0, 500, () => bgm.pause());
  }
  try { localStorage.setItem('music', wantMusic ? 'on' : 'off'); } catch (e) {}
});
// browsers need a user gesture before audio: start on the first click / key press
['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, function once(e) {
  if (mus.contains(e.target)) return;
  removeEventListener('pointerdown', once, true); removeEventListener('keydown', once, true);
  if (wantMusic && bgm.paused) startMusic();
}, true));
if (wantMusic) startMusic();    // works directly if the browser allows autoplay

const interactive = '.btn,.lang button,.icon-btn,.music';
$$(interactive).forEach(el => {
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') Sound.hover(); });
  el.addEventListener('pointerdown', () => { Sound.unlock(); Sound.click(); });
});

const snd = $('#snd');
function paintSnd() {
  snd.classList.toggle('off', Sound.muted);
  snd.setAttribute('aria-pressed', String(!Sound.muted));
}
paintSnd();
snd.addEventListener('click', () => {
  Sound.setMuted(!Sound.muted); paintSnd();
  if (!Sound.muted) Sound.click();
});

/* ============================================================
   PROFILE TILT + CUSTOM CURSOR  (one shared animation loop)
   ============================================================ */
const prof = $('.profile'), ring = $('#cur-ring'), dot = $('#cur-dot');
let rx = 0, ry = 0, tx = 0, ty = 0, cx = ptr.x, cy = ptr.y;

if (fine && !reduce) {
  document.body.classList.add('has-cursor');
  addEventListener('pointermove', () => document.body.classList.add('cur-on'), { once: true });
  document.documentElement.addEventListener('mouseleave', () => document.body.classList.remove('cur-on'));
  document.documentElement.addEventListener('mouseenter', () => document.body.classList.add('cur-on'));
  addEventListener('pointerover', e => ring.classList.toggle('hot', !!e.target.closest('a,button')));
  addEventListener('pointerdown', () => ring.classList.add('down'));
  addEventListener('pointerup', () => ring.classList.remove('down'));
}

function ui() {
  const k = .08;
  rx += (-ptr.ny * 6 - rx) * k; ry += (ptr.nx * 9 - ry) * k;
  tx += (ptr.nx - tx) * k; ty += (ptr.ny - ty) * k;
  prof.style.setProperty('--prx', rx.toFixed(2) + 'deg');
  prof.style.setProperty('--pry', ry.toFixed(2) + 'deg');
  prof.style.setProperty('--tx', tx.toFixed(3));
  prof.style.setProperty('--ty', ty.toFixed(3));
  if (fine) {
    cx += (ptr.x - cx) * .2; cy += (ptr.y - cy) * .2;
    dot.style.transform = 'translate3d(' + ptr.x + 'px,' + ptr.y + 'px,0)';
    ring.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0)';
  }
  requestAnimationFrame(ui);
}
if (!reduce) requestAnimationFrame(ui);

})();
