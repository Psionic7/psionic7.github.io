import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import react from '@vitejs/plugin-react';

export default defineConfig({
  define: { __ADMIN_GITHUB_AUTH__: 'false', __DATA_VERSION__: JSON.stringify(createHash('sha256').update(readFileSync(new URL('./public/data/manifest.json', import.meta.url))).digest('hex').slice(0, 16)) },
  plugins: [react()],
  base: '/',
  build: { outDir: 'docs', emptyOutDir: true, sourcemap: false, rolldownOptions: {input: {index: 'index.html', admin: 'admin.html'}} },
  test: { environment: 'jsdom', include: ['tests/**/*.test.jsx'] },
});
