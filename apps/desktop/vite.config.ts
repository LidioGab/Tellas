import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry point
        entry: path.resolve(__dirname, 'src/main/index.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist/main'),
            rollupOptions: {
              external: ['electron', '@stream-app/native-audio']
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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
      '@stream-app/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@stream-app/native-audio': path.resolve(__dirname, '../../packages/native-audio/index.js')
    }
  },
  root: 'src/renderer',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer')
  },
  server: {
    host: true,
    port: 5173
  }
});
