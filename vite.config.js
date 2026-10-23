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
};
function ocrAssets(){
  return {
    name: 'spica-ocr-assets',
    configureServer(server){
      server.middlewares.use((req, res, next) => {
        const m = req.url && req.url.match(/^\/ocr\/([^?#]+)/);
        const src = m && OCR_FILES[m[1]];
        if(!src || !existsSync(resolve(src))) return next();
        res.setHeader('Content-Type', m[1].endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
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
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
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
