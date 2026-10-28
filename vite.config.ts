import { readFileSync } from 'node:fs'
import { configDefaults, defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
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
 * The package version is the one fact the About section shows about the build.
 * Reading it here keeps the number in package.json instead of in a second place
 * that would drift.
 */
const packageVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

/**
 * The WebView baseline is Safari 15 on the macOS side, so the production bundle
 * is compiled down to it. Vite 8 transpiles through Oxc/Rolldown and no longer
 * exposes a top-level esbuild target, so build.target is the single place the
 * baseline is expressed.
 */
const webviewBaseline = 'safari15'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  build: {
    target: webviewBaseline,
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // The bundle is served from disk inside the application window, not over a
    // network, so the default 500 kB warning threshold measures the wrong thing
    // here. Splitting the canvas out would add a suspense boundary and a
    // loading flash to save a few milliseconds of local parsing. The limit
    // tracks the bundle as it exists, so the warning stays meaningful: the
    // growth past 1024 kB is the fontkit measurer, which every page needs.
    chunkSizeWarningLimit: 1536,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    globals: true,
    // The default is five seconds, which a presentation test can cross on a
    // loaded machine without anything being wrong: typing a field through
    // userEvent and then committing it is real work, and the files run in
    // parallel. A test that reaches this is genuinely stuck, not merely slow.
    testTimeout: 15000,
    // Two projects, one command. The unit project runs in jsdom, which is
    // fast and enough for everything that does not depend on what a browser
    // paints. The browser project runs in a headless Chromium, which is the
    // only place the cascade, the outline shorthand and the custom properties
    // resolve the way the application sees them.
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./test/setup.ts'],
          include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
          // The browser tests belong to the browser project: a test that
          // reads what a browser paints cannot be read by jsdom.
          exclude: [...configDefaults.exclude, 'test/browser/**'],
        },
      },
      {
        // The browser loads the dependencies of a test as separate modules, so
        // they are pre-bundled before the run. A dependency the bundler
        // discovers while a test is running makes the page reload under it,
        // and the test fails on a reload it did not cause.
        optimizeDeps: {
          include: [
            'react',
            'react-dom',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            'zustand',
            '@testing-library/react',
            '@testing-library/jest-dom/vitest',
          ],
        },
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.tsx'],
          // The jsdom setup replaces the ResizeObserver with a double the
          // test drives by hand. A browser has a real one, so the browser
          // project loads the matchers only.
          setupFiles: ['./test/browser/setup.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
