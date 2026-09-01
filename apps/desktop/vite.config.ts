import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

const isVercel = process.env.VERCEL === '1' || process.env.BUILD_TARGET === 'web';

export default defineConfig({
  plugins: [
    react(),
    ...(!isVercel
      ? [
          electron([
            {
              // Main process entry point
              entry: path.resolve(__dirname, 'src/main/index.ts'),
              vite: {
                build: {
                  outDir: path.resolve(__dirname, 'dist/main'),
                  rollupOptions: {
                    external: ['electron', 'electron-updater', '@stream-app/native-audio']
                  }
                }
              }
            },
            {
              // Preload script entry point
              entry: path.resolve(__dirname, 'src/preload/index.ts'),
              onstart(options) {
                options.reload();
              },
              vite: {
                build: {
                  outDir: path.resolve(__dirname, 'dist/preload'),
                  rollupOptions: {
                    external: ['electron']
                  }
                }
              }
            }
          ]),
          renderer()
        ]
      : [])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
      '@stream-app/shared': path.resolve(__dirname, './src/renderer/src/types/shared.ts'),
      '@stream-app/native-audio': path.resolve(__dirname, '../../packages/native-audio/index.js')
    }
  },
  root: 'src/renderer',
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true
  },

  server: {
    host: true,
    port: 5173
  }
});
