import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
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
