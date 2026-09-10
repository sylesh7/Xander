'use client';

import { useEffect } from 'react';

/**
 * Textmode Overlay is a Vite-built React SPA. Its entry bundle
 * (index_byanxxth.js, an ES module) calls createRoot(#root).render(App) and
 * renders the whole page itself, lazy-importing its engine chunks
 * (textmode.esm, fluid-source, filters, contour, noise, motion) from the same
 * /assets/ directory. We just load that entry module; its relative dynamic
 * imports resolve against its own URL, so every chunk comes from /public/assets.
 */
let mounted = false;

export default function AppMount() {
  useEffect(() => {
    if (mounted) return;
    mounted = true;

    const el = document.createElement('script');
    el.type = 'module';
    el.src = '/assets/index_byanxxth.js';
    el.crossOrigin = 'anonymous';
    document.body.appendChild(el);
  }, []);

  return null;
}
