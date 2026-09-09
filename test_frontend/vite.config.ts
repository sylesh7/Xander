import { defineConfig } from 'vite'

/**
 * Dev-server proxy to the real backend, so this page can call the real API
 * without the backend needing CORS middleware added just for a local test
 * tool. `/api/*` here maps to `http://localhost:3000/*` on the real server.
 *
 * Change the target if your backend runs on a different port (PORT in
 * backend/.env).
 */
export default defineConfig({
  optimizeDeps: {
    // @worldcoin/idkit-core loads a real WASM module via
    // `new URL('idkit_wasm_bg.wasm', import.meta.url)`. Vite's dev-mode
    // dependency pre-bundler (esbuild) copies the package into
    // node_modules/.vite/deps/ without the sibling .wasm file, so that URL
    // resolves to a path Vite's dev server has nothing to serve — which
    // falls through to its SPA index.html fallback, and the browser tries to
    // WebAssembly.instantiate() an HTML page (fails with "expected magic
    // word ... found 3c 21 64 6f", i.e. the bytes of "<!do"). Verified by
    // running the real page in a real browser, not by inspection.
    // Excluding it from pre-bundling makes Vite serve it as native ESM
    // straight from node_modules, where the relative URL resolves correctly.
    // `npm run build`'s production bundling was never affected — Rollup
    // handles this asset pattern correctly on its own.
    exclude: ['@worldcoin/idkit-core'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
