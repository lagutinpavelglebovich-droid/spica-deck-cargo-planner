/* v3.40 — text reading through the OCR worker; falls back to the main
   thread when a worker cannot start (old WebView). */
let worker = null, broken = false, seq = 0;
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
