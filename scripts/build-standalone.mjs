// Builds one self-contained HTML file (no server needed) with esbuild.
// Output: dist-standalone/geoestimator.html, and docs/index.html for GitHub Pages "Deploy from a branch".
// Leaflet and the fonts load from public CDNs at runtime, like the basemap tiles.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodePaths = (process.env.NODE_PATH ?? '').split(':').filter(Boolean);

async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch {
    const req = createRequire(import.meta.url);
    for (const p of nodePaths) {
      try { return req(resolve(p, 'esbuild')); } catch { /* try next */ }
    }
    throw new Error('esbuild not found. Run npm install, or set NODE_PATH to a folder that has it.');
  }
}

const { build } = await loadEsbuild();
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const out = await build({
  entryPoints: [resolve(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  write: false,
  outdir: 'out',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths,
  logLevel: 'warning',
});
const js = out.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = out.outputFiles.find((f) => f.path.endsWith('.css')).text;
const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  `<meta name="generator" content="GeoEstimator ${pkg.version}">`,
  '<title>GeoEstimator</title>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700&family=Open+Sans:wght@400;600&display=swap">',
  '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>',
  `<style>${css}</style>`,
].join('\n');
const html = `<!doctype html>\n<html lang="en"><head>\n${head}\n</head><body><div id="root"></div>\n<script>${js}</script>\n</body></html>\n`;
mkdirSync(resolve(root, 'dist-standalone'), { recursive: true });
writeFileSync(resolve(root, 'dist-standalone/geoestimator.html'), html);
mkdirSync(resolve(root, 'docs'), { recursive: true });
writeFileSync(resolve(root, 'docs/index.html'), html);
console.log(`standalone build: ${(js.length / 1024).toFixed(0)} KB JS, ${(css.length / 1024).toFixed(0)} KB CSS`);
