import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Dev-only playground for the boxes-and-lines OVG router experiment.
// Run:  npx vite --config playground/vite.config.ts
const root = dirname(fileURLToPath(import.meta.url));
export default {
  root,
  // allow dgmo (..) + the workspace root (../..) so the gauntlet .dgmo files
  // under my-diagrams/ can be glob-imported.
  server: { fs: { allow: [resolve(root, '../..')] }, open: true },
  build: { outDir: '/tmp/pg-dist', emptyOutDir: true },
  optimizeDeps: { include: ['elkjs/lib/elk.bundled.js', '@dagrejs/dagre'] },
};
