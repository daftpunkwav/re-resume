/**
 * @file dependencyDirection.test
 * @description Automated enforcement of the layering rules in spec section 1.1:
 * a direction violation is caught here rather than in review.
 *
 * Responsibilities:
 * - Parse the import specifiers of every TypeScript file under src/
 * - Assert each layer only reaches the layers below it
 * - Assert bootstrap/ is the single directory allowed to combine application/
 *   with infrastructure/
 *
 * Constraints:
 * - The scan is deliberately dependency-free: node:fs plus a line-anchored
 *   regex over import/export forms, including dynamic import().
 * - A specifier is resolved before it is judged, so a relative path that
 *   climbs out of its own layer is caught as the layer it lands in.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
const SOURCE_ROOT = join(REPOSITORY_ROOT, 'src')

const LAYERS = ['domain', 'application', 'infrastructure', 'presentation', 'bootstrap'] as const

type Layer = (typeof LAYERS)[number]

interface SourceFile {
  /** Repository-relative, so a failure message names a path the reader can find. */
  readonly path: string
  readonly layer: Layer | null
  readonly specifiers: readonly string[]
}

interface Violation {
  readonly file: string
  readonly specifier: string
}

/**
 * Line-anchored, so a commented-out or documented example of an import is not
 * read as a real one. The three forms cover static import/export ... from,
 * a bare side-effect import and import(). Backtick quoting counts as well:
 * it is valid syntax and would otherwise be an unpoliced way in.
 */
const IMPORT_FORMS = [
  /^[ \t]*(?:import|export)\b[^'"]*?\bfrom[ \t]*['"]([^'"]+)['"]/gm,
  /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm,
  /\bimport\([ \t]*['"]([^'"]+)['"][ \t]*\)/g,
]

function readSpecifiers(source: string): readonly string[] {
  const found = new Set<string>()
  for (const form of IMPORT_FORMS) {
    form.lastIndex = 0
    let match = form.exec(source)
    while (match !== null) {
      if (match[1] !== undefined) found.add(match[1])
      match = form.exec(source)
    }
  }
  return [...found]
}

function layerOfPath(repositoryPath: string): Layer | null {
  const match = new RegExp(`^src[\\\\/](${LAYERS.join('|')})[\\\\/]`).exec(repositoryPath)
  return (match?.[1] as Layer | undefined) ?? null
}

function scanSourceFiles(directory: string): readonly SourceFile[] {
  const files: SourceFile[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...scanSourceFiles(absolute))
      continue
    }
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue
    const path = relative(REPOSITORY_ROOT, absolute).split(sep).join('/')
    files.push({
      path,
      layer: layerOfPath(path),
      specifiers: readSpecifiers(readFileSync(absolute, 'utf8')),
    })
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Where a specifier lands, or null for a package: a bare specifier is either a
 * dependency or a node builtin, neither of which belongs to a layer.
 */
function layerOfSpecifier(file: SourceFile, specifier: string): Layer | null {
  if (specifier.startsWith('.')) {
    // Resolved against the importing file's own directory, so ".." lands where
    // the runtime would look rather than one level above it.
    return layerOfPath(
      relative(REPOSITORY_ROOT, resolve(REPOSITORY_ROOT, dirname(file.path), specifier))
        .split(sep)
        .join('/'),
    )
  }
  // Root-absolute form, in case an import is ever written as src/domain/...
  const withoutLeadingSlash = specifier.replace(/^\/+/u, '')
  return specifier.startsWith('/') || withoutLeadingSlash.startsWith('src/')
    ? layerOfPath(withoutLeadingSlash)
    : null
}

function violationsAgainst(
  files: readonly SourceFile[],
  forbidden: (specifierLayer: Layer, file: SourceFile) => boolean,
  describeRefusal: (specifierLayer: Layer, file: SourceFile) => string,
): readonly Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    for (const specifier of file.specifiers) {
      const specifierLayer = layerOfSpecifier(file, specifier)
      if (specifierLayer === null) continue
      if (!forbidden(specifierLayer, file)) continue
      violations.push({
        file: file.path,
        specifier: `${specifier} (${describeRefusal(specifierLayer, file)})`,
      })
    }
  }
  return violations
}

function expectNoViolations(violations: readonly Violation[]): void {
  expect(violations.map((violation) => `${violation.file}: ${violation.specifier}`)).toEqual([])
}

const files = scanSourceFiles(SOURCE_ROOT)
const inLayer = (layer: Layer): readonly SourceFile[] => files.filter((file) => file.layer === layer)

describe('dependency direction', () => {
  it('scans a non-empty source tree', () => {
    expect(
      files.length,
      `No .ts or .tsx file was found under ${SOURCE_ROOT}. A scan that reads nothing ` +
        'passes every rule below for the wrong reason.',
    ).toBeGreaterThan(0)
  })

  it('keeps domain/ free of package and cross-layer imports', () => {
    // The domain depends on nothing: not on another layer, not on a runtime
    // dependency. Relative paths inside domain/ stay legal.
    const violations: Violation[] = []
    for (const file of inLayer('domain')) {
      for (const specifier of file.specifiers) {
        if (specifier.startsWith('.')) continue
        violations.push({
          file: file.path,
          specifier: `${specifier} (domain/ may import nothing but relative paths)`,
        })
      }
    }
    expectNoViolations(violations)
  })

  it('keeps application/ off infrastructure/ and presentation/', () => {
    expectNoViolations(
      violationsAgainst(
        inLayer('application'),
        (specifierLayer) => specifierLayer === 'infrastructure' || specifierLayer === 'presentation',
        (specifierLayer) => `application/ must not import ${specifierLayer}/`,
      ),
    )
  })

  it('keeps presentation/ off infrastructure/', () => {
    expectNoViolations(
      violationsAgainst(
        inLayer('presentation'),
        (specifierLayer) => specifierLayer === 'infrastructure',
        (specifierLayer) => `presentation/ must not import ${specifierLayer}/`,
      ),
    )
  })

  it('keeps infrastructure/ off presentation/ and application/', () => {
    expectNoViolations(
      violationsAgainst(
        inLayer('infrastructure'),
        (specifierLayer) => specifierLayer === 'presentation' || specifierLayer === 'application',
        (specifierLayer) => `infrastructure/ must not import ${specifierLayer}/`,
      ),
    )
  })

  it('keeps bootstrap/ off presentation/', () => {
    expectNoViolations(
      violationsAgainst(
        inLayer('bootstrap'),
        (specifierLayer) => specifierLayer === 'presentation',
        (specifierLayer) => `bootstrap/ must not import ${specifierLayer}/`,
      ),
    )
  })

  it('leaves bootstrap/ as the only directory combining application/ and infrastructure/', () => {
    // Without the whitelist the four prohibitions above would make every
    // infrastructure implementation unreachable, because nothing else is
    // allowed to name both the use case and the implementation it needs.
    const combined: { directory: string; importers: string[] }[] = []
    for (const layer of LAYERS) {
      const layerFiles = inLayer(layer)
      const importers = layerFiles.filter((file) => {
        const reached = new Set(
          file.specifiers
            .map((specifier) => layerOfSpecifier(file, specifier))
            .filter((specifierLayer): specifierLayer is Layer => specifierLayer !== null),
        )
        return reached.has('application') && reached.has('infrastructure')
      })
      if (importers.length === 0) continue
      if (layer === 'bootstrap') continue
      combined.push({ directory: `src/${layer}/`, importers: importers.map((file) => file.path) })
    }
    expect(
      combined.map((entry) => `${entry.directory}: ${entry.importers.join(', ')}`),
      'Only src/bootstrap/ may import application/ and infrastructure/ together.',
    ).toEqual([])
  })
})
