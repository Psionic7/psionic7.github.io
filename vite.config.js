import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'docs', emptyOutDir: true, sourcemap: false },
  test: { environment: 'jsdom', include: ['tests/**/*.test.jsx'] },
});
