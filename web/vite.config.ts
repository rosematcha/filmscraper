import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The aggregation, notes and markdown code is pure TypeScript with no Node
// imports, so the browser runs exactly what the CLI runs.
const core = fileURLToPath(new URL('../src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@core': core } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
