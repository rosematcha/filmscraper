import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The aggregation, notes and markdown code is pure TypeScript with no Node
// imports, so the browser runs exactly what the CLI runs.
const core = fileURLToPath(new URL('../src', import.meta.url));

// Development reads the dataset the scheduled scrape published rather than a
// local copy, so what is on screen is what the site is actually serving. A
// local run can still be previewed by pointing this elsewhere.
const SITE_URL = process.env['SITE_URL'] ?? 'https://filmscraper.rosematcha.com';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@core': core } },
  server: {
    port: 5173,
    proxy: {
      '/data': {
        target: SITE_URL,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
