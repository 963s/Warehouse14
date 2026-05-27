/**
 * Vite — feeds both the Tauri webview (`tauri dev`) and the browser
 * preview (`vite dev`). Tauri-specific tweaks: fixed dev port, no HMR
 * over WS when wrapped, env files prefixed `WAREHOUSE14_PUBLIC_*`.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(() => {
  const serverConfig: import('vite').ServerOptions = {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ['**/src-tauri/**'] },
  };
  if (host) {
    serverConfig.hmr = { protocol: 'ws', host, port: 1421 };
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
