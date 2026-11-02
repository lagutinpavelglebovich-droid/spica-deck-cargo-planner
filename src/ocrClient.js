/* v3.40 — text reading through the OCR worker; falls back to the main
   thread when a worker cannot start (old WebView). */
import { invoke } from '@tauri-apps/api/core';
let worker = null, broken = false, seq = 0;

/* v3.41 — the native engine in the desktop app (ONNX Runtime + OpenVINO,
   PP-OCRv5, RF-DETR). Used whenever it is there; the WASM reader stays as
   the fallback (browser, dev builds, a machine where it cannot start). */
let native = null, nativeStatus = null, nativeTry = null;
const inTauri = () => typeof window !== 'undefined' && !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
/* v3.42 — development only: tools/autotest drives the web build headless and
   hands the native engine in through this hook (never set by the app itself) */
const hook = () => typeof window !== 'undefined' && typeof window.__decargoVisionHook === 'function' ? window.__decargoVisionHook : null;
const call = (cmd, raw, headers) => hook() ? hook()(cmd, raw, headers || {}) : invoke(cmd, raw, headers ? { headers } : undefined);
export async function visionStatus(){
  if(native !== null) return nativeStatus;
  if(!inTauri() && !hook()){ native = false; return null; }
  if(!nativeTry) nativeTry = call('vision_status').then(st => { nativeStatus = st || null; native = !!(st && st.ok); return nativeStatus; })
    .catch(() => { native = false; return null; });
  return nativeTry;
}
const rawOf = img => new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
/* img: ImageData → [{ label, score, x, y, w, h }] in its pixels, or null without the native engine */
export async function detectObjects(img, minScore = 0.35){
  const st = await visionStatus();
  if(!st || !st.ok || !st.detector) return null;
  try{ return await call('vision_detect', rawOf(img), { 'x-w': String(img.width), 'x-h': String(img.height), 'x-min': String(minScore) }); }
  catch(e){ console.warn('[vision] detector', e); return null; }
}
const waiting = new Map();

function start(){
  if(worker || broken) return worker;
  try{
    worker = new Worker(new URL('./visionWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const m = e.data || {}, w = waiting.get(m.id);
      if(!w) return;
      waiting.delete(m.id);
      m.ok ? w.res(m.res) : w.rej(new Error(m.err));
    };
    worker.onerror = () => {
      broken = true; try{ worker.terminate(); }catch(e){} worker = null;
      waiting.forEach(w => w.rej(new Error('worker'))); waiting.clear();
    };
  }catch(e){ broken = true; worker = null; }
  return worker;
}

/* img: ImageData. → [{ text, score, cx, cy, w, h, a }] in its pixels */
export async function readTextAsync(img, opts){
  const st = await visionStatus();
  if(st && st.ok && st.ocr){
    try{
      return await call('vision_ocr', rawOf(img), { 'x-w': String(img.width), 'x-h': String(img.height), 'x-both': opts && opts.both === false ? '0' : '1' });
    }catch(e){ console.warn('[vision] native OCR failed — using the built-in reader', e); nativeStatus = Object.assign({}, st, { ocr: false }); }
  }
  const w = start();
  if(!w){
    const { readText } = await import('./vision.js');
    return readText(img, opts);
  }
  const id = ++seq;
  return new Promise((res, rej) => {
    waiting.set(id, { res, rej });
    try{ w.postMessage({ id, img, opts }, [img.data.buffer]); }
    catch(e){ waiting.delete(id); rej(e); }
  }).catch(e => {
    /* the worker died with this picture (its pixels went with it) — the next one is read on this thread */
    if(String(e && e.message) === 'worker') return [];
    throw e;
  });
}
export function ocrBusy(){ return waiting.size > 0; }
