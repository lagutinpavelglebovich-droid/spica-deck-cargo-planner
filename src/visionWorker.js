/* v3.40 — PaddleOCR (vision.js) off the main thread, so a playing deck
   video and the lock on the load do not stutter while a unit number is
   being read. Message: { id, img: ImageData, opts } → { id, ok, res | err } */
import { readText } from './vision.js';

self.onmessage = async e => {
  const { id, img, opts } = e.data || {};
  try{
    const res = await readText(img, opts || {});
    self.postMessage({ id, ok: true, res });
  }catch(err){
    self.postMessage({ id, ok: false, err: String(err && err.message || err) });
  }
};
