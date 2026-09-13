import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // 🌟 精简 Polyfill，仅注入业务必需的 Buffer 与基础环境变量，减少 JS 堆内存
      include: ['buffer', 'process', 'util', 'stream', 'events'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: [
      'service.btsbots.com',
    ],
  },
  resolve: {
    alias: {
      bitsharesjs: 'bitsharesjs/es/index.js',
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    cssMinify: true,
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
    },
    rollupOptions: {
      external: [],
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          crypto: ['bitsharesjs', 'bitsharesjs-ws'],
        },
      },
    },
  },
});