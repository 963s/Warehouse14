/**
 * Vite — feeds both the Tauri webview (`tauri dev`) and the browser preview.
 * Tauri-specific tweaks mirror apps/tauri-pos: fixed dev port (1422 so it can
 * run alongside the POS on 1420), no HMR over WS unless wrapped, env files
 * prefixed `WAREHOUSE14_PUBLIC_*`.
 */

import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(() => {
  const serverConfig: import('vite').ServerOptions = {
    port: 1422,
    strictPort: true,
    host: host || false,
    watch: { ignored: ['**/src-tauri/**'] },
  };
  if (host) {
    serverConfig.hmr = { protocol: 'ws', host, port: 1423 };
  }
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    clearScreen: false,
    envPrefix: ['VITE_', 'WAREHOUSE14_PUBLIC_'],
    server: serverConfig,
    build: {
      target: 'es2022',
      minify: 'esbuild' as const,
      sourcemap: true,
      outDir: 'dist',
    },
  };
});
