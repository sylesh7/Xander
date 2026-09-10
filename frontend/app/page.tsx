import AppMount from '@/components/AppMount';
import { ROOT_HTML } from '@/components/rootHtml';

export default function Page() {
  return (
    <>
      {/* #root holds a prerendered snapshot for first paint; the Vite bundle
          re-renders into it on mount. dangerouslySetInnerHTML keeps React from
          managing its internals so the SPA can take the node over cleanly. */}
      <div id="root" dangerouslySetInnerHTML={{ __html: ROOT_HTML }} />
      <AppMount />
    </>
  );
}
