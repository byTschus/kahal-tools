import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST ?? 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target },
      '/auth': { target },
      '/feeds': { target },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
