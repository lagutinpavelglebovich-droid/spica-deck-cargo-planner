/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Atmosphere sky (WebGL, engine = "cinematic")

   Procedural volumetric sky rendered in one full-screen fragment shader:
   a 3D cloud slab seen in perspective from the deck (raymarched, Beer–
   Lambert, light march toward sun/moon, height-graded ambient, distance
   haze), sun/moon/stars by local time, North Sea below the horizon, rain
   streaks with refracting drops on glass, snow, fog banks, in-cloud
   lightning. No texture assets.

   Public API (mirrors wxScene):
     skyGL.supported()                        → boolean (WebGL available)
     skyGL.init(parentEl)                     mount <canvas class="wx-gl">
     skyGL.set({ condition, intensity, motion })
                                              condition: weather/api.js keys
                                              ('clear-day', 'cloudy', 'rain', …)
                                              or 'off' to stop rendering
     skyGL.destroy()

   Cost control: adaptive render scale (0.4–1.25× CSS px), 30 fps for
   cloud-only scenes and 60 fps with precipitation, paused when hidden
   or off, motion 'off' renders one still frame. The PDF exporter already
   detaches '.wx-scene canvas' before html2canvas runs.
   ════════════════════════════════════════════════════════════════════════ */

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FS = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uCover, uExt, uBase, uTop, uStrato, uDark, uRain, uSnow, uFog, uFlash, uWind, uInt, uSunI, uVis;
uniform vec4  uTodW;          // night, dawn, day, dusk
uniform vec3  uSunDir;        // sun by day, moon by night (world space, camera looks +z)
uniform float uIsSun, uBodyVis, uSunElev;
uniform vec3  uFlashP;

const float PITCH = 0.28;     // camera tilt above horizon (rad)
const float TANH  = 0.5774;   // tan(30°): 60° vertical field of view
const float CAMY  = 20.;      // eye height on deck (m)

vec3 L(vec3 c){ return pow(c, vec3(2.2)); }
float sstep(float a, float b, float x){ float den = b - a; den = abs(den) < 1e-6 ? 1e-6 : den; float t = clamp((x - a)/den, 0., 1.); return t*t*(3. - 2.*t); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float noise2(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.,0.)), u.x), mix(hash12(i+vec2(0.,1.)), hash12(i+vec2(1.,1.)), u.x), u.y);
}
float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.-2.*f);
  float a = hash13(i),               b = hash13(i+vec3(1.,0.,0.));
  float c = hash13(i+vec3(0.,1.,0.)), d = hash13(i+vec3(1.,1.,0.));
  float e = hash13(i+vec3(0.,0.,1.)), f1 = hash13(i+vec3(1.,0.,1.));
  float g = hash13(i+vec3(0.,1.,1.)), h = hash13(i+vec3(1.,1.,1.));
  return mix(mix(mix(a,b,u.x), mix(c,d,u.x), u.y), mix(mix(e,f1,u.x), mix(g,h,u.x), u.y), u.z);
}
float fbm3(vec3 p, int oct){
  float s = 0., a = .5, n = 0.;
  for(int i = 0; i < 3; i++){ if(i >= oct) break; s += a*noise3(p); n += a; p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= .5; }
  return s / n;
}
float fbm2(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 5; i++){ s += a*noise2(p); p = mat2(1.6,1.2,-1.2,1.6)*p; a *= .5; } return s; }

/* ── cloud density at world position (m). hi = full detail ── */
float dens(vec3 p, float hi){
  float baseVar = (noise2(p.xz*.0008 + 3.1) - .5) * 260.;           // undulating cloud base
  float lb = uBase + baseVar;
  float hf = (p.y - lb) / (uTop - lb);
  if(hf < 0. || hf > 1.) return 0.;
  vec3 q = p;
  q.x += uTime*uWind*11. + hf*160.*uWind;                              // advection + wind shear
  q.z += uTime*uWind*4.;
  float big = fbm3(q*.00085 + vec3(0., uTime*.0035, 0.), hi > .5 ? 3 : 2); // ~1.2 km structure, slow evolution
  big = clamp((big - .22) / .56, 0., 1.);
  float cel = noise3(q*.0052 + vec3(big*1.8, big*.6, 0.));            // ~200 m lobes (warped)
  cel = sstep(.22, .82, cel);
  float n = mix(big, big*.42 + cel*.58, uStrato);
  float prof = sstep(0., .16, hf) * sstep(1., mix(.62, .38, uStrato), hf);
  float d = clamp((n - (1. - uCover)) / max(uCover, .06), 0., 1.) * prof;
  if(hi > .5 && d > 0.){
    float det = noise3(q*.021 + vec3(0., uTime*.025, 0.));
    d = clamp(d - (1. - d)*det*.6, 0., 1.);
  }
  return d;
}

float hg(float mu, float g){ float g2 = g*g; return (1. - g2) / (12.566 * pow(max(1. + g2 - 2.*g*mu, 1e-4), 1.5)); }

/* ── sky radiance (linear) for a view direction ── */
vec3 skyL(vec3 rd){
  float h = clamp(rd.y, 0., 1.);
  float hh = pow(h, .5);
  vec3 top = vec3(.018,.035,.10)*uTodW.x + vec3(.16,.21,.42)*uTodW.y + vec3(.09,.38,.80)*uTodW.z + vec3(.11,.12,.31)*uTodW.w;
  vec3 mid = vec3(.04,.07,.17)*uTodW.x + vec3(.62,.46,.62)*uTodW.y + vec3(.30,.60,.90)*uTodW.z + vec3(.55,.32,.48)*uTodW.w;
  vec3 hor = vec3(.09,.13,.25)*uTodW.x + vec3(.98,.66,.50)*uTodW.y + vec3(.66,.82,.95)*uTodW.z + vec3(.96,.52,.36)*uTodW.w;
  vec3 s = hh < .45 ? mix(hor, mid, sstep(0., .45, hh)) : mix(mid, top, sstep(.45, 1., hh));
  s = L(s);
  float over = clamp(uCover*1.25 + uDark*.4 - .50, 0., 1.);
  float g0 = dot(s, vec3(.2126,.7152,.0722));
  s = mix(s, vec3(g0)*vec3(.92,.97,1.06)*.95, over*.85);
  return s * (1. - uDark*.55);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv0 = frag / uRes.y;
  float t = uTime;

  /* ── rain on the glass: drops refract the view behind them ── */
  vec2 sc = frag;
  float dropM = 0., dropRim = 0., dropSpec = 0.;
  if(uRain > .01){
    for(int j = 0; j < 2; j++){
      float fj = float(j);
      float gs = 7. + fj*9.;
      vec2 g = uv0*gs + vec2(fj*3.7, 0.);
      vec2 id = floor(g), f = fract(g) - .5;
      float r = hash12(id + .37 + fj);
      vec2 o = (vec2(hash12(id + 5.1 + fj), hash12(id + 9.7 + fj)) - .5) * .6;
      float life = fract(t*(.05 + .04*fj) + r);
      float rad = (.10 + .16*hash12(id + 2.2 + fj)) * sstep(0., .06, life) * sstep(1., .55, life);
      vec2 v = f - o; v.y *= 1.12;
      float d = length(v);
      float on = step(mix(.55, .35, fj), r) * uRain;
      float m = sstep(rad, rad*.82, d) * on;
      sc -= (v / gs) * uRes.y * m * 2.4;
      dropM = max(dropM, m);
      dropRim = max(dropRim, sstep(rad*.62, rad, d) * m);
      dropSpec = max(dropSpec, m * sstep(.55, .95, dot(normalize(v + 1e-4), vec2(-.55, .75))) * sstep(rad*.3, rad*.85, d));
    }
  }

  /* ── camera ray ── */
  vec2 ndc = (sc - .5*uRes) / uRes.y;           // y in [-.5,.5]
  vec3 fw = vec3(0., sin(PITCH), cos(PITCH));
  vec3 up = vec3(0., cos(PITCH), -sin(PITCH));
  vec3 rd = normalize(fw + (ndc.x*vec3(1.,0.,0.) + ndc.y*up) * 2. * TANH);
  vec3 ro = vec3(0., CAMY, 0.);

  float bright = dot(uTodW, vec4(.20, .74, 1., .68));
  float mu = dot(rd, uSunDir);
  vec3 sunCol = uIsSun > .5 ? mix(L(vec3(1., .50, .28)), L(vec3(1., .95, .88)), sstep(.02, .45, uSunElev))
                            : L(vec3(.62, .72, 1.));
  float clearSky = 1. - sstep(.45, .97, uCover);

  vec3 col;
  if(rd.y > -.002){
    /* sky + stars + sun/moon */
    col = skyL(rd);
    float nightness = uTodW.x + uTodW.w*.25 + uTodW.y*.15;
    if(nightness > .02){
      vec2 sg = rd.xy / (rd.z + 1.2) * 230.;
      vec2 sid = floor(sg); vec2 sf = fract(sg) - .5;
      float sr = hash12(sid);
      vec2 so = (vec2(hash12(sid + 1.3), hash12(sid + 2.7)) - .5) * .7;
      float tw = .55 + .45*sin(t*(1.5 + sr*3.) + sr*40.);
      col += vec3(.75,.8,1.) * step(.984, sr) * sstep(.10, 0., length(sf - so)) * tw * nightness * clearSky * sstep(.05, .3, rd.y) * .35;
    }
    float bodyI = mix(.35, 1., uIsSun) * uBodyVis;
    col += sunCol * bodyI * (pow(max(mu,0.), 6.)*.10 + pow(max(mu,0.), 60.)*.45) * (.25 + .75*clearSky) * mix(.4, 1.8, uIsSun);
    float disc = sstep(mix(.99975, .99985, uIsSun), mix(.99988, .99993, uIsSun), mu);
    col = mix(col, sunCol * mix(.9, 9., uIsSun), disc * uBodyVis * (.15 + .85*clearSky));

    /* ── volumetric clouds ── */
    if(rd.y > .012 && uCover > .01){
      float t0 = (uBase - 260. - ro.y) / rd.y;
      float t1 = min((uTop - ro.y) / rd.y, 18000.);
      if(t0 < 18000.){
        float ds = (t1 - t0) / 40.;
        float ign = hash12(frag*1.37 + 11.7);
        float tt = t0 + ds*ign;
        float ph = mix(hg(mu, .62), hg(mu, -.22), .32) * 12.566;   // normalised so isotropic = 1
        ph = mix(ph, 1., uStrato*uCover*.75);                     // stratiform deck: light is diffused, no forward glare
        vec3 ambTop = skyL(vec3(0., 1., 0.)) * .95 + sunCol*uSunI*.06;
        vec3 ambBot = skyL(normalize(vec3(0., .05, 1.))) * .22 * (1. - uDark*.4);
        vec3 acc = vec3(0.); float T = 1., tw = 0., wsum = 0.;
        for(int i = 0; i < 40; i++){
          vec3 p = ro + rd*tt;
          float d = dens(p, 1.);
          if(d > .003){
            float sig = d * uExt;
            float od = 0.;
            if(uSunI > .002){
              od  = dens(p + uSunDir*90., 0.) * 90.;
              od += dens(p + uSunDir*360., 0.) * 270.;
              od += dens(p + uSunDir*1000., 0.) * 640.;
              od *= uExt;
            }
            float hf = clamp((p.y - uBase) / (uTop - uBase), 0., 1.);
            float powder = 1. - .35*exp(-d*uExt*650.);
            vec3 direct = sunCol * uSunI * (exp(-od)*ph + exp(-od*.3)*.12) * powder;    // single + multi-scatter approx
            vec3 amb = mix(ambBot, ambTop, pow(hf, 1.2)) * mix(.45, 1., 1. - d);
            vec3 fl = vec3(.75,.82,1.) * uFlash * exp(-length(p - uFlashP)/650.) * 6.;
            vec3 S = direct + amb + fl;
            float Tr = exp(-sig*ds);
            float w = T * (1. - Tr);
            acc += S * w; tw += w*tt; wsum += w;
            T *= Tr;
            if(T < .02) break;
          }
          tt += ds;
        }
        float tMean = wsum > 0. ? tw / wsum : t1;
        vec3 haze = skyL(normalize(vec3(rd.x, .10, rd.z))) * .85;
        float fa = 1. - exp(-tMean / uVis);
        col = col*T + mix(acc, haze*(1. - T), fa);
      }
    }
    /* horizon haze band */
    col = mix(col, skyL(normalize(vec3(rd.x, .06, rd.z)))*.95, sstep(.10, 0., rd.y)*.62);
  } else {
    /* North Sea below the horizon */
    vec2 sp = ro.xz + rd.xz * (ro.y / -rd.y);
    float wv = fbm2(sp*.06 + vec2(t*.35, t*.2)) - .5;
    vec3 n = normalize(vec3(wv*.35, 1., wv*.25));
    vec3 rr = reflect(rd, n);
    float fres = .02 + .98*pow(1. - max(dot(-rd, n), 0.), 5.);
    vec3 deep = mix(L(vec3(.04,.08,.11)), L(vec3(.07,.09,.10)), uCover) * (.25 + .75*bright) * (1. - uDark*.5);
    col = mix(deep, skyL(vec3(rr.x, max(rr.y, .02), rr.z)), fres);
    col += sunCol * uSunI * pow(max(dot(rr, uSunDir), 0.), 220.) * 1.5 * uBodyVis * clearSky;
    col = mix(col, skyL(normalize(vec3(rd.x, .01, rd.z))), sstep(-.06, 0., rd.y)*.7);
  }

  col += L(vec3(.55,.62,.85)) * uFlash * .08;

  /* tonemap (filmic) + display gamma */
  col *= .78;
  col = clamp((col*(2.51*col + .03)) / (col*(2.43*col + .59) + .14), 0., 1.);
  col = pow(col, vec3(1./2.2));

  /* ── fog: low drifting banks around the horizon (display space) ── */
  float hzY = .5 - tan(PITCH) / (2.*TANH);       // horizon height, screen fraction
  float yn = frag.y / uRes.y;
  if(uFog > .01){
    float fn  = fbm2(vec2(uv0.x*1.1 - t*.025*uWind, uv0.y*3.4 + t*.01));
    float fn2 = fbm2(vec2(uv0.x*2.3 + t*.04, uv0.y*6.0));
    float band = sstep(.75, 0., abs(yn - hzY - .08));
    vec3 fogC = mix(vec3(.62,.66,.72), vec3(.86,.88,.90), uTodW.z + uTodW.y*.6) * (.35 + .65*bright);
    col = mix(col, fogC, clamp(uFog*(.35 + .65*fn*band) + uFog*fn2*band*.25, 0., .94));
  }

  /* ── rain streaks ── */
  if(uRain > .01){
    float rn = 0.;
    for(int k = 0; k < 3; k++){
      float fk = float(k);
      float scl = fk < .5 ? 36. : (fk < 1.5 ? 22. : 12.);
      float fall = fk < .5 ? 1.05 : (fk < 1.5 ? 1.45 : 2.10);
      float wpx = fk < .5 ? 1.0 : (fk < 1.5 ? 1.4 : 2.1);
      float slant = .16 + fk*.025;
      float dens0 = fk < .5 ? .55 : (fk < 1.5 ? .50 : .42);
      float a = fk < .5 ? .35 : (fk < 1.5 ? .55 : .75);
      vec2 u = uv0; u.x += u.y*slant;
      float kk = scl*.12;
      vec2 g = vec2(u.x*scl, (u.y + t*fall)*kk);
      vec2 id = floor(g), f = fract(g);
      float seed = 3.1 + fk*4.6;
      float r = hash12(id + seed);
      float xo = .15 + .7*hash12(id*1.31 + seed);
      float w = wpx*scl/uRes.y;
      float len = .30 + .45*hash12(id*2.7 + seed);
      float yo = hash12(id*3.9 + seed)*(1. - len);
      float yy = (f.y - yo)/len;
      float body = step(0., yy)*step(yy, 1.)*sstep(0., .07, yy)*(1. - yy);
      rn += step(r, dens0) * sstep(w, 0., abs(f.x - xo)) * body * (.55 + .45*hash12(id*5.3 + seed)) * a;
    }
    vec3 rc = vec3(.80,.86,.94)*(.45 + .55*bright) + vec3(.6,.65,.8)*uFlash*.6;
    col = mix(col, rc, clamp(rn*uRain*uInt, 0., 1.)*.72);
    col = mix(col, vec3(.52,.57,.66)*(.4 + .6*bright), uRain*.10);
  }

  /* ── snow ── */
  if(uSnow > .01){
    float sn = 0.;
    for(int k = 0; k < 3; k++){
      float fk = float(k);
      float scl = fk < .5 ? 26. : (fk < 1.5 ? 14. : 6.);
      float fall = fk < .5 ? .045 : (fk < 1.5 ? .070 : .110);
      float sz = fk < .5 ? 1.6 : (fk < 1.5 ? 2.6 : 6.0);
      float soft = fk < .5 ? .25 : (fk < 1.5 ? .30 : .55);
      float a = fk < .5 ? .55 : (fk < 1.5 ? .80 : .55);
      float seed = 2.3 + fk*3.1;
      vec2 g = uv0*scl;
      g.y += t*fall*scl;
      g.x += t*.05*uWind*scl + sin(uv0.y*3.1 + t*.55 + seed)*.35;
      vec2 id = floor(g), f = fract(g) - .5;
      float r = hash12(id + seed);
      vec2 o = (vec2(hash12(id + seed + 1.7), hash12(id + seed + 4.3)) - .5)*.6;
      o.x += sin(t*1.1 + r*6.283)*.14;
      float rad = sz*scl/uRes.y*(.55 + .7*hash12(id*2.3 + seed));
      sn += step(.30, r) * sstep(rad, rad*soft, length(f - o)) * a;
    }
    col = mix(col, vec3(.97,.98,1.)*(.55 + .45*bright), clamp(sn*uSnow*uInt, 0., 1.));
  }

  /* ── glass drop shading ── */
  col *= 1. - dropRim*.22;
  col += vec3(1.) * dropSpec * .35 * (.4 + .6*bright);
  col = mix(col, col*1.06 + .015, dropM*.5);

  vec2 q = frag / uRes - .5;
  col *= 1. - .20*dot(q*1.25, q*1.25);
  col += (hash12(frag + fract(t)*100.) - .5) / 255.;
  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
}`;

/* cover = coverage, ext = extinction (1/m), base/top = slab (m),
   strato = cobblestone weight, vis = haze distance (m) */
const CONDITIONS = {
  clear:  { name:'Clear',         cover:.10, ext:.0022, base:1000, top:1900, strato:.10, dark:0,   rain:0, snow:0, fog:0, storm:0, wind:.6, vis:40000 },
  partly: { name:'Partly Cloudy', cover:.42, ext:.0026, base:900,  top:2300, strato:.25, dark:0,   rain:0, snow:0, fog:0, storm:0, wind:1,  vis:34000 },
  cloudy: { name:'Overcast',      cover:.97, ext:.0044, base:650,  top:1550, strato:1,   dark:.12, rain:0, snow:0, fog:0, storm:0, wind:.9, vis:30000 },
  rain:   { name:'Rain',          cover:1,   ext:.0050, base:520,  top:1650, strato:.65, dark:.38, rain:1, snow:0, fog:0, storm:0, wind:1.4,vis:16000 },
  storm:  { name:'Thunderstorm',  cover:1,   ext:.0070, base:450,  top:2600, strato:.40, dark:.66, rain:.9,snow:0, fog:0, storm:1, wind:2.1,vis:12000 },
  snow:   { name:'Snow',          cover:.95, ext:.0040, base:600,  top:1500, strato:.70, dark:.15, rain:0, snow:1, fog:0, storm:0, wind:.7, vis:12000 },
  fog:    { name:'Fog',           cover:.85, ext:.0030, base:300,  top:900,  strato:.80, dark:.06, rain:0, snow:0, fog:1, storm:0, wind:.4, vis:5000 },
};

/* weather/api.js condition keys → shader state (+ forced time of day) */
const MAP = {
  'clear-day':           { s:'clear',  tod:'day'   },
  'clear-night':         { s:'clear',  tod:'night' },
  'partly-cloudy-day':   { s:'partly', tod:'day'   },
  'partly-cloudy-night': { s:'partly', tod:'night' },
  'cloudy':              { s:'cloudy' },
  'dusk':                { s:'partly', tod:'dusk'  },
  'rain':                { s:'rain'   },
  'fog':                 { s:'fog'    },
  'snow':                { s:'snow'   },
  'thunderstorm':        { s:'storm'  },
};
const INTENSITY = { subtle:0.6, normal:1, strong:1.35 };
const KEYS = ['cover','ext','base','top','strato','dark','rain','snow','fog','storm','wind','int','vis'];

let _canvas = null, _gl = null, _prog = null, _U = {};
let _raf = 0, _running = false, _last = 0, _simT = 0, _lastDraw = 0;
let _target = null, _cur = null, _todForce = null, _speed = 1, _still = false;
let _flashT = [], _nextFlash = 3, _flashP = [0, 800, 4000];
let _scale = 0.75, _maxScale = 1, _frames = 0, _acc = 0;
let _supported = null;

function supported(){
  if(_supported !== null) return _supported;
  try { const c = document.createElement('canvas'); _supported = !!(c.getContext('webgl')); }
  catch(e){ _supported = false; }
  return _supported;
}

function _compile(type, src){
  const sh = _gl.createShader(type); _gl.shaderSource(sh, src); _gl.compileShader(sh);
  if(!_gl.getShaderParameter(sh, _gl.COMPILE_STATUS)) throw new Error(_gl.getShaderInfoLog(sh));
  return sh;
}

function init(parentEl){
  if(_canvas || !parentEl || !supported()) return !!_canvas;
  _canvas = document.createElement('canvas');
  _canvas.className = 'wx-gl';
  _canvas.setAttribute('aria-hidden', 'true');
  parentEl.insertBefore(_canvas, parentEl.firstChild);
  _gl = _canvas.getContext('webgl', { antialias:false, alpha:false, depth:false, stencil:false, powerPreference:'high-performance', preserveDrawingBuffer:false });
  if(!_gl){ _canvas.remove(); _canvas = null; _supported = false; return false; }
  try {
    _prog = _gl.createProgram();
    _gl.attachShader(_prog, _compile(_gl.VERTEX_SHADER, VS));
    _gl.attachShader(_prog, _compile(_gl.FRAGMENT_SHADER, FS));
    _gl.linkProgram(_prog);
    if(!_gl.getProgramParameter(_prog, _gl.LINK_STATUS)) throw new Error(_gl.getProgramInfoLog(_prog));
    _gl.useProgram(_prog);
    const buf = _gl.createBuffer(); _gl.bindBuffer(_gl.ARRAY_BUFFER, buf);
    _gl.bufferData(_gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), _gl.STATIC_DRAW);
    const loc = _gl.getAttribLocation(_prog, 'p'); _gl.enableVertexAttribArray(loc); _gl.vertexAttribPointer(loc, 2, _gl.FLOAT, false, 0, 0);
    ['uRes','uTime','uCover','uExt','uBase','uTop','uStrato','uDark','uRain','uSnow','uFog','uFlash','uWind','uInt','uSunI','uVis',
     'uTodW','uSunDir','uIsSun','uBodyVis','uSunElev','uFlashP'].forEach(n => _U[n] = _gl.getUniformLocation(_prog, n));
  } catch(e){
    console.error('[skyGL] shader setup failed:', e);
    _canvas.remove(); _canvas = null; _gl = null; _supported = false; return false;
  }
  _maxScale = Math.min(window.devicePixelRatio || 1, 1.25);
  _scale = Math.min(0.75, _maxScale);
  _canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); _stop(); });
  document.addEventListener('visibilitychange', _onVisibility);
  return true;
}

function _hourNow(){
  if(_todForce === 'day')   return 13;
  if(_todForce === 'night') return 23;
  if(_todForce === 'dusk')  return 19.4;
  const d = new Date(); return d.getHours() + d.getMinutes()/60;
}
function _todWeights(H){
  const g = (c, w) => { let d = Math.abs(H - c); d = Math.min(d, 24 - d); return Math.exp(-(d*d)/(2*w*w)); };
  const n = g(0.5, 3.0), a = g(6.4, 1.15), dd = g(13, 3.5), k = g(19.5, 1.15);
  const s = n + a + dd + k; return [n/s, a/s, dd/s, k/s];
}
function _celestial(H){
  let s, sun, vis;
  if(H >= 5.5 && H <= 20.5){ s = (H - 5.5)/15; sun = 1; vis = Math.min(1, Math.min(H - 5.5, 20.5 - H)/0.8); }
  else { s = (((H - 20.5) + 24) % 24)/9; sun = 0; vis = Math.min(1, Math.min(s*9, (1 - s)*9)/0.8); }
  const elev = sun ? 0.03 + 0.63*Math.sin(Math.PI*s) : 0.10 + 0.55*Math.sin(Math.PI*Math.min(s,1));
  const az = -0.95 + 1.9*s, ce = Math.cos(elev);
  return { dir:[Math.sin(az)*ce, Math.sin(elev), Math.cos(az)*ce], sun, vis:Math.max(0, vis), elev };
}

function _resize(){
  const w = Math.max(1, Math.floor(_canvas.clientWidth * _scale));
  const h = Math.max(1, Math.floor(_canvas.clientHeight * _scale));
  if(_canvas.width !== w || _canvas.height !== h){ _canvas.width = w; _canvas.height = h; _gl.viewport(0, 0, w, h); }
}

function _draw(){
  const H = _hourNow(), w = _todWeights(H), c = _celestial(H), cur = _cur;
  let flash = 0;
  for(const ft of _flashT){ const a = _simT - ft; if(a >= 0) flash += Math.exp(-a/0.075) * (ft === _flashT[0] ? 1 : 0.75); }
  flash *= cur.storm;
  const sunI = (c.sun ? 2.4 : 0.12) * c.vis * (1 - cur.dark*0.7) * (1 - Math.pow(cur.cover, 3)*0.55);
  const U = _U, gl = _gl;
  gl.uniform2f(U.uRes, _canvas.width, _canvas.height);
  gl.uniform1f(U.uTime, _simT);
  gl.uniform1f(U.uCover, cur.cover); gl.uniform1f(U.uExt, cur.ext);
  gl.uniform1f(U.uBase, cur.base);   gl.uniform1f(U.uTop, cur.top);
  gl.uniform1f(U.uStrato, cur.strato); gl.uniform1f(U.uDark, cur.dark);
  gl.uniform1f(U.uRain, cur.rain);   gl.uniform1f(U.uSnow, cur.snow);
  gl.uniform1f(U.uFog, cur.fog);     gl.uniform1f(U.uFlash, Math.min(1.4, flash));
  gl.uniform1f(U.uWind, cur.wind);   gl.uniform1f(U.uInt, cur.int);
  gl.uniform1f(U.uSunI, sunI);       gl.uniform1f(U.uVis, cur.vis);
  gl.uniform4f(U.uTodW, w[0], w[1], w[2], w[3]);
  gl.uniform3f(U.uSunDir, c.dir[0], c.dir[1], c.dir[2]);
  gl.uniform1f(U.uIsSun, c.sun); gl.uniform1f(U.uBodyVis, c.vis); gl.uniform1f(U.uSunElev, c.elev);
  gl.uniform3f(U.uFlashP, _flashP[0], _flashP[1], _flashP[2]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function _frame(now){
  if(!_running) return;
  _raf = requestAnimationFrame(_frame);
  const precip = _target.rain > 0 || _target.snow > 0 || _target.storm > 0;
  const minGap = precip ? 0 : 1000/31;                   /* 30 fps for cloud-only scenes */
  if(now - _lastDraw < minGap) return;
  const dt = Math.min(0.1, (now - _last)/1000); _last = now; _lastDraw = now;
  _simT += dt * _speed;
  const k = 1 - Math.exp(-dt/1.2);
  for(const key of KEYS) _cur[key] += (_target[key] - _cur[key]) * k;
  if(_cur.storm > 0.5 && _speed > 0.5){
    _nextFlash -= dt;
    if(_nextFlash <= 0){
      const t0 = _simT;
      _flashT = [t0, t0 + 0.08 + Math.random()*0.05, t0 + 0.22 + Math.random()*0.12].slice(0, 2 + (Math.random() > .4));
      _flashP = [ -3500 + Math.random()*7000, _cur.base + 250 + Math.random()*500, 2500 + Math.random()*6000 ];
      _nextFlash = 3 + Math.random()*7;
    }
  }
  _resize();
  _draw();
  _frames++; _acc += dt;
  if(_acc >= 2){
    const fps = _frames/_acc, want = precip ? 50 : 26; _frames = 0; _acc = 0;
    if(fps < want && _scale > 0.4) _scale = Math.max(0.4, _scale*0.88);
    else if(fps > want + 8 && _scale < _maxScale - 0.01) _scale = Math.min(_maxScale, _scale*1.04);
  }
  if(_still){ _stop(); }
}

function _start(){
  if(_running || !_canvas) return;
  if(document.hidden) return;
  _running = true; _last = performance.now(); _lastDraw = 0;
  _raf = requestAnimationFrame(_frame);
}
function _stop(){ _running = false; if(_raf) cancelAnimationFrame(_raf); _raf = 0; }
function _onVisibility(){ if(document.hidden) _stop(); else if(_target) _start(); }

function set(state){
  if(!_canvas) return;
  const cond = state && state.condition;
  const m = MAP[cond];
  if(!m || cond === 'off'){
    _target = null; _stop();
    _canvas.style.display = 'none';
    return;
  }
  _canvas.style.display = 'block';
  _todForce = m.tod || null;
  const preset = CONDITIONS[m.s];
  const intensity = INTENSITY[state.intensity] || 1;
  const wasOff = !_target;
  _target = Object.assign({}, preset, { int: intensity });
  if(wasOff || !_cur) _cur = Object.assign({}, _target);   /* no fade-in from a stale scene */
  const motion = state.motion || 'full';
  _speed = motion === 'off' ? 0 : motion === 'reduced' ? 0.3 : 1;
  try { if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) _speed = Math.min(_speed, 0.3); } catch(e){}
  _still = _speed === 0;
  if(_still) _cur = Object.assign({}, _target);
  _stop(); _start();
}

function destroy(){
  _stop();
  document.removeEventListener('visibilitychange', _onVisibility);
  if(_canvas) _canvas.remove();
  _canvas = null; _gl = null; _prog = null; _target = null; _cur = null;
}

export const skyGL = { supported, init, set, destroy };
