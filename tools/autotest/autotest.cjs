#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   AUTOTEST — the deck camera end to end, headless (development only)
   Drives the web build (vite dev server) in Playwright with the REAL native
   engine behind it (src-tauri vision.rs test `serve`, over a local socket),
   plays a lift video with a plan made for it, and checks what the camera did.

   usage:
     1. npx vite --port 5199                                   (the app)
     2. DECARGO_VISION_DIR=<vision pack> DECARGO_VISION_SERVE=7788 \
        src-tauri/target/release/deps/spica_tide-<hash> vision::tests::serve --exact --nocapture
     3. DECARGO_CLIPS=<folder with c<clip>.mp4> node tools/autotest/autotest.cjs [scenario…]
   Videos never go into the repo. Output: tools/autotest/out/<scenario>.json + .png
════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), net = require('net');
const { chromium } = require('playwright');
const URL_ = process.env.DECARGO_URL || 'http://localhost:5199/';
const PORT = +(process.env.DECARGO_VISION_SERVE || 7788);
const CLIPS = process.env.DECARGO_CLIPS || '.';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });

/* deck geometry (CLAUDE.md): metres → canvas px */
const M = 31, YS = 380 / 15, JM = 0.15, JP = Math.round(0.15 * M);
const BAYS = [4.15, 4.04, 4.75, 4.03, 4.75, 4.76, 4.04, 4.75, 4.02, 4.75, 4.76, 4.47], BW = BAYS.map(m => Math.round(m * M));
function mToX(m){ let px = 0, mc = 0; for(let i = 0; i < 12; i++){ if(m <= mc + BAYS[i]) return px + (m - mc) / BAYS[i] * BW[i]; px += BW[i]; mc += BAYS[i]; if(m <= mc + JM) return px + (m - mc) / JM * JP; px += JP; mc += JM; } return px; }
/* bay centre in metres from the stern (Bay 12 = index 0) */
const bayX = bay => { let x = 0; for(let i = 0; i < 12 - bay; i++) x += BAYS[i] + JM; return x + BAYS[12 - bay] / 2; };

function engine(){
  const s = net.createConnection(PORT, '127.0.0.1'); let buf = ''; const q = [];
  s.on('data', d => { buf += d; let i; while((i = buf.indexOf('\n')) >= 0){ const line = buf.slice(0, i); buf = buf.slice(i + 1); const w = q.shift(); if(w) w(JSON.parse(line)); } });
  let chain = Promise.resolve();
  /* the engine serves one connection at a time: close it when a scenario ends */
  const call = (cmd, raw, h) => (chain = chain.then(() => new Promise(res => {
    q.push(res);
    const head = { cmd: cmd === 'vision_ocr' ? 'ocr' : cmd === 'vision_detect' ? 'det' : 'status', w: +h['x-w'] || 0, h: +h['x-h'] || 0, both: h['x-both'] !== '0', min: +(h['x-min'] || 0.45) };
    s.write(JSON.stringify(head) + '\n'); if(raw) s.write(raw);
  })));
  call.close = () => s.end();
  return call;
}

async function run(name){
  const sc = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenarios', name + '.json'), 'utf8'));
  const cargo = (sc.units || []).map((u, i) => {
    const xM = u.xM != null ? u.xM : bayX(u.bay) + (u.dx || 0), w = Math.round(u.l * M), h = Math.round(u.w * YS);
    return { id: 1800000000000 + i, side: 'DECK', x: Math.round(mToX(xM) - w / 2), y: Math.round(u.yM * YS - h / 2), w, h, length_m: u.l, width_m: u.w, rot: 0,
      ccu: u.ccu, desc: u.desc || 'Unit', wt: 3, platform: 'BLEO', status: 'L', dgClasses: [], priority: false, trDest: '' };
  });
  const plan = { _schema: 3, _appVersion: 'autotest', name: 'autotest ' + name, plan: { cargo, customLib: [], customLocs: [], voyage: 'TEST', activeLocs: ['BLEO'], selLoc: 'BLEO', date: '2026-11-02',
    dynColors: {}, cargoColors: {}, locColors: {}, voyRemarks: '', loadList: sc.loadList ? { items: sc.loadList.map(c => ({ ccu: c, desc: '' })) } : null, zoomLevel: 0.9, vessel: { id: 'spica-tide', name: 'SPICA TIDE' } } };
  const eng = engine(); const st = await eng('vision_status', null, {}); console.log(name, '· engine', st.device);
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1600, height: 1000 } });
  await pg.exposeFunction('__visionBridge', async (cmd, b64, h) => eng(cmd, b64 ? Buffer.from(b64, 'base64') : null, h));
  await pg.addInitScript(([p, dev]) => {
    try{ localStorage.setItem('spicaTideOperatorMode', 'operator'); localStorage.setItem('spicaTide_plan_current', JSON.stringify(p)); localStorage.setItem('decargo_visionBench', JSON.stringify({ at: Date.now(), detector_ms: 1, ocr_ms: 1 })); }catch(e){}
    const b64 = u8 => { let s = ''; for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    window.__decargoTrackLog = [];
    window.__decargoVisionHook = async (cmd, raw, h) => cmd === 'vision_status' ? { ok: true, device: dev, ocr: true, detector: true } : window.__visionBridge(cmd, raw ? b64(raw) : null, h);
  }, [plan, st.device]);
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(URL_, { waitUntil: 'load', timeout: 180000 }); await pg.waitForTimeout(1500);
  await pg.evaluate(async c => { const m = await import('/src/deckCamera.js'); m._dc.api().setCamera({ rotation: 0, calib: c }); window.__dcm = m; m.openDeckCamera('watch'); }, sc.calib);
  await pg.setInputFiles('#dcFile', path.join(CLIPS, `c${sc.clip}.${process.env.DECARGO_CLIP_EXT || "webm"}`)); await pg.waitForTimeout(1500);
  await pg.click('#dcPlay'); await pg.waitForTimeout(200);
  await pg.evaluate(r => { const v = window.__dcm._dc.state().src; v.playbackRate = r; }, sc.rate || 0.25);
  await pg.click('#dcWBg');
  const t0 = Date.now(); let nEv = 0, shots = 0;
  const snap = () => pg.evaluate(() => {
    const D = window.__dcm._dc, S = D.state(), v = S && S.src;
    return { t: v ? +v.currentTime.toFixed(1) : 0, ended: !!(v && v.ended), mini: [document.querySelector('.dcm-num'), document.querySelector('.dcm-l2')].map(e => e && e.textContent).join(' | '),
      ev: (S && S.wEvents || []).map(e => ({ t: +e.t.toFixed(1), kind: e.moveId != null ? 'moved' : e.kind, where: e.where, read: e.reading && e.reading.text || '', sure: !!(e.reading && e.reading.sure), unit: e.guess || (e.partial && e.partial.ccu) || '', piece: e.partial ? e.partial.frag : '' })).reverse(),
      lifted: [...document.querySelectorAll('.cb-cam-lifted')].map(e => e.dataset.id), ghosts: [...document.querySelectorAll('.cam-ghost-pill')].map(e => e.textContent.replace(/[✓✕]/g, '').trim()) };
  });
  let s = await snap(); const trace = [];
  while(!s.ended && Date.now() - t0 < (sc.timeoutS || 1500) * 1000){
    await pg.waitForTimeout(2000); s = await snap(); trace.push([s.t, s.mini]);
    if(s.ev.length > nEv){ nEv = s.ev.length; await pg.screenshot({ path: path.join(OUT, `${name}_${shots++}.png`) }); }
  }
  await pg.waitForTimeout(1500); s = await snap();
  await pg.screenshot({ path: path.join(OUT, `${name}_end.png`) });
  const idOf = ccu => (cargo.find(c => c.ccu === ccu) || {}).id;
  /* expectations: kind, time window, unit (lift-off on the plan) or bay/side (set-down) */
  const checks = (sc.expect || []).map(x => {
    const hit = s.ev.find(e => e.kind === x.kind && e.t >= x.t[0] && e.t <= x.t[1]);
    let ok = !!hit, why = hit ? '' : 'no ' + x.kind + ' in ' + x.t.join('–') + ' s';
    if(hit && x.unit && hit.unit !== x.unit){ ok = false; why = `unit ${hit.unit || '—'} ≠ ${x.unit}`; }
    if(hit && x.bay && !new RegExp('Bay ' + x.bay + '\\b').test(hit.where)){ ok = false; why = `${hit.where} ≠ Bay ${x.bay}`; }
    if(hit && x.flagged && !s.lifted.includes(String(idOf(x.flagged)))){ ok = false; why = `${x.flagged} not marked LIFTED?`; }
    return { expect: x, ok, why, got: hit || null };
  });
  const extra = s.ev.filter(e => !checks.some(c => c.got === e));
  const tracker = await pg.evaluate(() => window.__decargoTrackLog || []);
  /* every number read per lock, with where it was seen (picture) against where the load was */
  const reads = await pg.evaluate(() => { const W_ = window.__dcm._dc.state().w; const o = {};
    W_.reads.forEach((r, id) => { o[id] = { n: r.n, m: [...r.m].map(([k, v]) => [k, +v.s.toFixed(2), v.occ.map(a => a.map(x => +x.toFixed(3)))]), raw: [...r.raw].map(([k, v]) => [k, +v.s.toFixed(2), v.occ.length]), frag: [...(r.frag || [])].map(([k, v]) => [k, +v.s.toFixed(2), v.occ.length]) }; });
    return { reads: o, deck: (W_.deck || []).map(d => d.n) }; });
  const rep = { reads, tracker, scenario: name, clip: sc.clip, engine: st.device, rate: sc.rate || 0.25, wallS: Math.round((Date.now() - t0) / 1000), checks, extra, lifted: s.lifted, ghosts: s.ghosts, errors: errs.slice(0, 5), trace };
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(rep, null, 1));
  console.log(name, checks.map(c => (c.ok ? 'PASS ' : 'FAIL ') + c.expect.kind + (c.expect.unit ? ' ' + c.expect.unit : '') + (c.why ? ' — ' + c.why : '')).join(' · '), extra.length ? '· extra: ' + extra.map(e => `${e.t}s ${e.kind} ${e.where}`).join(', ') : '');
  await br.close();
  eng.close();
  return checks.every(c => c.ok) && !extra.length;
}
(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(__dirname, 'scenarios')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  let all = true; for(const n of names) all = (await run(n)) && all;
  process.exit(all ? 0 : 1);
})();
