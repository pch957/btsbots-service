import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
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
  },
  resolve: {
    alias: {
      // 彻底解决某些旧版打包工具在 Vite 中找不到库入口的问题
      'bitsharesjs': 'bitsharesjs/es/index.js'
    }
  },
  build: {
    target: 'esnext',
    minify: false, // 关闭混淆以便排查
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
    },
    rollupOptions: {
      external: [],
    },
  },
});