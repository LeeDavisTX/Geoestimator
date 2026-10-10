import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is the GitHub Pages sub-path. Change it if the repo is renamed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/geoestimator/',
  plugins: [react()],
});
