import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * The WebView baseline is Safari 15 on the macOS side, so the production bundle
 * is compiled down to it. Vite 8 transpiles through Oxc/Rolldown and no longer
 * exposes a top-level esbuild target, so build.target is the single place the
 * baseline is expressed.
 */
const webviewBaseline = 'safari15'

export default defineConfig({
  plugins: [react()],
  build: {
    target: webviewBaseline,
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
})
