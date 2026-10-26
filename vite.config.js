import { defineConfig } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* v3.14 — offline OCR assets for scanned PDF manifests. Tesseract's worker,
   WASM core and English data are served / emitted under /ocr/ straight from
   node_modules, so nothing is fetched from the internet at runtime. */
const OCR_FILES = {
  'worker.min.js':                      'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-simd-lstm.wasm.js':   'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js':        'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'eng.traineddata.gz':                 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  /* v3.17 — deck-camera text reading (PaddleOCR PP-OCRv4 on ONNX Runtime) */
  'ort-wasm-simd-threaded.wasm':        'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs':         'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
  'ppocr-det.onnx':                     'node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx',
  'ppocr-rec.onnx':                     'node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx',
  'ppocr-keys.txt':                     'node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt',
  /* v3.37.2 — pdf.js image decoders: CCITT G4 / JBIG2 / JPEG 2000 scans
     (what most black-and-white office scanners produce) decode only when
     wasmUrl points at these; without them the page OCRs as blank. */
  'pdfjs/jbig2.wasm':                   'node_modules/pdfjs-dist/wasm/jbig2.wasm',
  'pdfjs/openjpeg.wasm':                'node_modules/pdfjs-dist/wasm/openjpeg.wasm',
  'pdfjs/qcms_bg.wasm':                 'node_modules/pdfjs-dist/wasm/qcms_bg.wasm',
  'pdfjs/jbig2_nowasm_fallback.js':     'node_modules/pdfjs-dist/wasm/jbig2_nowasm_fallback.js',
  'pdfjs/openjpeg_nowasm_fallback.js':  'node_modules/pdfjs-dist/wasm/openjpeg_nowasm_fallback.js',
};
const OCR_TYPE = n => n.endsWith('.wasm') ? 'application/wasm'
  : /\.m?js$/.test(n) ? 'application/javascript'
  : n.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/octet-stream';
function ocrAssets(){
  return {
    name: 'spica-ocr-assets',
    configureServer(server){
      server.middlewares.use((req, res, next) => {
        const m = req.url && req.url.match(/^\/ocr\/([^?#]+)/);
        const src = m && OCR_FILES[m[1]];
        if(!src || !existsSync(resolve(src))) return next();
        res.setHeader('Content-Type', OCR_TYPE(m[1]));
        res.end(readFileSync(resolve(src)));
      });
    },
    generateBundle(){
      for(const [name, src] of Object.entries(OCR_FILES)){
        if(existsSync(resolve(src))) this.emitFile({ type:'asset', fileName:'ocr/' + name, source: readFileSync(resolve(src)) });
      }
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [ocrAssets()],
  /* v3.17 — CPU (WASM) build of ONNX Runtime only: the default entry pulls
     the 28 MB WebGPU/JSEP variant that the WebView does not need. */
  /* The "extern wasm" build loads ort-wasm-simd-threaded.{mjs,wasm} from
     env.wasm.wasmPaths (/ocr/), so the 14 MB runtime is shipped once. */
  resolve: { alias: [{ find: /^onnxruntime-web$/, replacement: resolve('node_modules/onnxruntime-web/dist/ort.wasm.min.mjs') }] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    /* Desktop app: the bundle is read from local disk by the Tauri
       WebView, never downloaded, so the 500 kB web-page warning does
       not apply. Main bundle ≈ 3.5 MB (app + SheetJS + jsPDF). */
    chunkSizeWarningLimit: 5000,
  },
  server: {
    /* host:true binds to both IPv4 and IPv6 — otherwise Vite defaults to
       IPv6-only ([::1]) and browsers that resolve localhost → 127.0.0.1
       get ERR_CONNECTION_REFUSED. */
    host: true,
    port: 1420,
    strictPort: true,
  },
});
