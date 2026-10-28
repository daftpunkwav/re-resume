/**
 * @file productionBundle.test
 * @description The production build must not contain the preview assembly. The
 * branch in main.tsx is guarded by import.meta.env.DEV, and this asserts the
 * bundler actually removed it rather than shipping a second entry point.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

/**
 * The Vitest process exports NODE_ENV=test and VITEST, and the Vite config
 * corrects NODE_ENV for the test build. A production build needs the opposite:
 * the environment is set for this one call and restored afterwards.
 */
async function withProductionEnvironment(run: () => Promise<void>): Promise<void> {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    VITEST: process.env.VITEST,
  }
  process.env.NODE_ENV = 'production'
  delete process.env.VITEST
  try {
    await run()
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous.NODE_ENV
    if (previous.VITEST === undefined) delete process.env.VITEST
    else process.env.VITEST = previous.VITEST
  }
}

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')

function javascriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...javascriptFiles(absolute))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolute)
    }
  }
  return files
}

describe('production bundle', () => {
  it('does not ship the preview assembly', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 're-resume-build-'))
    try {
      await withProductionEnvironment(async () => {
        await build({
          configFile: join(REPOSITORY_ROOT, 'vite.config.ts'),
          mode: 'production',
          logLevel: 'silent',
          build: { outDir, emptyOutDir: true, sourcemap: false },
        })
      })

      const scripts = javascriptFiles(outDir)
      expect(scripts.length).toBeGreaterThan(0)

      const bundle = scripts.map((file) => readFileSync(file, 'utf8')).join('\n')
      expect(bundle).not.toContain('previewRoot')
      expect(bundle).not.toContain('previewMain')
      // The real window is in the bundle: an empty build would pass the two
      // assertions above without proving anything.
      expect(bundle).toContain('从一段对话开始')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 180_000)
})
