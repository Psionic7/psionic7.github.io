import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: '/',
  publicDir: false,
  define: {__ADMIN_GITHUB_AUTH__: 'true'},
  build: {outDir: 'admin-portal-dist', emptyOutDir: true, sourcemap: false, rolldownOptions: {input: 'admin.html'}},
});
