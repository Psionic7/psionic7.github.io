import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'admin',publicDir:false,plugins:[react()],base:'/',build:{outDir:'../admin-dist',emptyOutDir:true,sourcemap:false}});
