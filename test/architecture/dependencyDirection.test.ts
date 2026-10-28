/**
 * @file dependencyDirection.test
 * @description Automated enforcement of the layering rules: a direction
 * violation is caught here rather than in review.
 *
 * Responsibilities:
 * - Parse the import specifiers of every TypeScript file under src/
 * - Assert each layer only reaches the layers below it, and only the packages
 *   the layer is allowed to name
 * - Assert bootstrap/ is the single place that names a SQLite repository
 *
 * Constraints:
 * - The scan is deliberately dependency-free: node:fs plus a line-anchored
 *   regex over import/export forms, including dynamic import().
 * - A specifier is resolved before it is judged, so a relative path that
 *   climbs out of its own layer is caught as the layer it lands in.
 * - The rule helpers are exported, and tested against a synthetic file, so a
 *   rule that stopped matching would fail its own test rather than pass
 *   vacuously.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
const SOURCE_ROOT = join(REPOSITORY_ROOT, 'src')

const LAYERS = ['domain', 'application', 'infrastructure', 'presentation', 'bootstrap'] as const

export type Layer = (typeof LAYERS)[number]

interface SourceFile {
  /** Repository-relative, so a failure message names a path the reader can find. */
  readonly path: string
  readonly layer: Layer | null
  readonly specifiers: readonly string[]
  readonly source: string
}

interface Violation {
  readonly file: string
  readonly specifier: string
}

/**
 * Line-anchored, so a commented-out or documented example of an import is not
 * read as a real one. The forms cover static import/export ... from, a named
 * import whose brace closes on a later line, a bare side-effect import and
 * import(). Backtick quoting counts in every form: a template literal is valid
 * syntax and would otherwise be an unpoliced way in.
 */
const IMPORT_FORMS = [
  /^[ \t]*(?:import|export)\b[^'"`\n]*?\bfrom[ \t]*['"`]([^'"`]+)['"`]/gm,
  /^[ \t]*\}[ \t]*from[ \t]*['"`]([^'"`]+)['"`]/gm,
  /^[ \t]*import[ \t]*['"`]([^'"`]+)['"`]/gm,
  /\bimport\([ \t]*['"`]([^'"`]+)['"`][ \t]*\)/g,
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
    const source = readFileSync(absolute, 'utf8')
    files.push({
      path,
      layer: layerOfPath(path),
      specifiers: readSpecifiers(source),
      source,
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

/** The package a bare specifier names, e.g. `@tauri-apps/api/core` → `@tauri-apps/api`. */
function packageNameOf(specifier: string): string | null {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('src/') ||
    specifier.startsWith('node:')
  ) {
    return null
  }
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? null)
}

/**
 * A package rule: files of one layer may not name a package that matches any
 * of the forbidden patterns, unless their path matches the exemption.
 */
export interface PackageRule {
  readonly appliesTo: readonly Layer[]
  readonly forbids: readonly RegExp[]
  readonly describe: string
  /** Files this rule does not apply to, for a dependency confined to one area. */
  readonly exceptPath?: RegExp
}

export const PACKAGE_RULES: readonly PackageRule[] = [
  {
    appliesTo: ['application'],
    // Everything except zod: the use cases may not know a UI, a database or a
    // provider implementation.
    forbids: [/^(?!zod$).+/],
    describe: 'application/ may import only zod from packages',
  },
  {
    appliesTo: ['presentation'],
    forbids: [/^@tauri-apps\//, /^@react-pdf\//, /^fontkit$/],
    describe: 'presentation/ must not name the native container, the PDF renderer or the font engine',
  },
  {
    appliesTo: ['infrastructure'],
    forbids: [/^react$/],
    exceptPath: /^src\/infrastructure\/exporter\/react-pdf\//,
    describe: 'react is allowed in infrastructure/ only under the PDF exporter',
  },
  {
    appliesTo: ['infrastructure'],
    forbids: [/^react-dom$/, /^zustand$/, /^konva$/, /^react-konva$/],
    describe: 'infrastructure/ must stay off the interface libraries',
  },
]

function packageViolationsFor(
  files: readonly SourceFile[],
  rules: readonly PackageRule[],
): readonly Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    if (file.layer === null) continue
    for (const specifier of file.specifiers) {
      const packageName = packageNameOf(specifier)
      if (packageName === null) continue
      for (const rule of rules) {
        if (!rule.appliesTo.includes(file.layer)) continue
        if (rule.exceptPath?.test(file.path) === true) continue
        if (!rule.forbids.some((pattern) => pattern.test(packageName))) continue
        violations.push({ file: file.path, specifier: `${specifier} (${rule.describe})` })
      }
    }
  }
  return violations
}

/** Any use of a SQLite repository outside src/bootstrap/. */
function sqliteRepositoryViolationsFor(files: readonly SourceFile[]): readonly Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    if (file.path.startsWith('src/bootstrap/')) continue
    // The repository implementation files declare the class; what the rule
    // bounds is who may *name* one as a dependency. Naming the file is the
    // definition, not a use.
    if (/(^|\/)Sqlite[A-Za-z]+Repository\.ts$/u.test(file.path)) continue
    const match = /Sqlite[A-Za-z]+Repository/.exec(file.source)
    if (match === null) continue
    violations.push({
      file: file.path,
      specifier: `${match[0]} (only bootstrap/ may name a SQLite repository)`,
    })
  }
  return violations
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

function syntheticFile(
  path: string,
  source: string,
): SourceFile {
  return {
    path,
    layer: layerOfPath(path),
    specifiers: readSpecifiers(source),
    source,
  }
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

  it('keeps application off every package but zod', () => {
    expectNoViolations(packageViolationsFor(files, [PACKAGE_RULES[0] as PackageRule]))
  })

  it('keeps presentation off tauri and react-pdf', () => {
    expectNoViolations(packageViolationsFor(files, [PACKAGE_RULES[1] as PackageRule]))
  })

  it('allows react in infrastructure only under the pdf exporter', () => {
    expectNoViolations(packageViolationsFor(files, [PACKAGE_RULES[2] as PackageRule]))
  })

  it('keeps bootstrap as the only place that names a sqlite repository', () => {
    expectNoViolations(sqliteRepositoryViolationsFor(files))
  })
})

/**
 * The rules themselves, checked against a synthetic file: a rule that stopped
 * matching — a pattern with a typo, an appliesTo list that lost its layer —
 * would otherwise pass every assertion above for the wrong reason.
 */
describe('package rules', () => {
  it('flags a package the layer may not name', () => {
    const file = syntheticFile(
      'src/application/example.ts',
      "import { invoke } from '@tauri-apps/api/core'",
    )
    expect(packageViolationsFor([file], PACKAGE_RULES)).toHaveLength(1)
  })

  it('allows the packages the layer is allowed to name', () => {
    const application = syntheticFile('src/application/example.ts', "import { z } from 'zod'")
    expect(packageViolationsFor([application], PACKAGE_RULES)).toEqual([])

    const exporter = syntheticFile(
      'src/infrastructure/exporter/react-pdf/document.tsx',
      "import { Document } from 'react'",
    )
    expect(packageViolationsFor([exporter], PACKAGE_RULES)).toEqual([])

    const otherInfrastructure = syntheticFile(
      'src/infrastructure/persistence/example.ts',
      "import { useState } from 'react'",
    )
    expect(packageViolationsFor([otherInfrastructure], PACKAGE_RULES)).toHaveLength(1)
  })

  it('flags a sqlite repository named outside bootstrap', () => {
    const user = syntheticFile(
      'src/infrastructure/persistence/settings/registry.ts',
      'export const settingsRepository = new SqliteAppSettingsRepository(database, clock)',
    )
    expect(sqliteRepositoryViolationsFor([user])).toHaveLength(1)

    const bootstrap = syntheticFile(
      'src/bootstrap/compositionRoot.ts',
      'new SqliteAppSettingsRepository(database, clock)',
    )
    expect(sqliteRepositoryViolationsFor([bootstrap])).toEqual([])

    // The file that declares the class is the implementation, not a use.
    const definition = syntheticFile(
      'src/infrastructure/persistence/settings/SqliteAppSettingsRepository.ts',
      'export class SqliteAppSettingsRepository {}',
    )
    expect(sqliteRepositoryViolationsFor([definition])).toEqual([])
  })
})
