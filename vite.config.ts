import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Some shells export NODE_ENV=production. Vite then resolves React's
 * production bundle for the component tests, and that bundle omits act() —
 * every render assertion fails before the test body runs. The test build must
 * load the development bundle, so the variable is corrected before Vite reads
 * it. Production builds are untouched.
 */
if (process.env.VITEST !== undefined && process.env.NODE_ENV === 'production') {
  process.env.NODE_ENV = 'test'
}

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
    // The bundle is served from disk inside the application window, not over a
    // network, so the default 500 kB warning threshold measures the wrong thing
    // here. Splitting the canvas out would add a suspense boundary and a
    // loading flash to save a few milliseconds of local parsing.
    chunkSizeWarningLimit: 1024,
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
    // The default is five seconds, which a presentation test can cross on a
    // loaded machine without anything being wrong: typing a field through
    // userEvent and then committing it is real work, and the files run in
    // parallel. A test that reaches this is genuinely stuck, not merely slow.
    testTimeout: 15000,
  },
})
