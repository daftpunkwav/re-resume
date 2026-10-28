/**
 * @file infoLibrary
 * @description A ready information library for use-case tests: the memory
 * repositories, the change log, a fixed clock and a sequential identifier
 * source. Each call returns an independent library.
 */

import { InMemoryEntryReferenceQuery, InMemoryChangeLogRepository, InMemoryCustomModuleRepository, InMemoryInfoEntryRepository } from '../../src/infrastructure/preview/inMemoryInfoRepositories'
import type { InfoLibraryDeps } from '../../src/application/info/library'
import type { CustomModuleDefinition } from '../../src/domain/info/CustomModule'
import type { InfoEntry } from '../../src/domain/info/InfoEntry'
import type { InfoEntryReference } from '../../src/domain/info/ports/InfoEntryReferenceQuery'
import { FixedClock, SequentialIdGenerator } from './fakeEnvironment'

export interface TestInfoLibrary {
  readonly deps: InfoLibraryDeps
  readonly entries: InMemoryInfoEntryRepository
  readonly customModules: InMemoryCustomModuleRepository
  readonly changes: InMemoryChangeLogRepository
  readonly clock: FixedClock
  readonly ids: SequentialIdGenerator
}

export interface InfoLibraryOptions {
  readonly entries?: readonly InfoEntry[]
  readonly customModules?: readonly CustomModuleDefinition[]
  readonly entryReferences?: ReadonlyMap<string, readonly InfoEntryReference[]>
  readonly moduleReferences?: ReadonlyMap<string, readonly InfoEntryReference[]>
  /** Prefix of the generated identifiers; keeps failures readable. */
  readonly idPrefix?: string
}

export function newInfoLibrary(options: InfoLibraryOptions = {}): TestInfoLibrary {
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  if (options.entries !== undefined) entries.seed(options.entries)
  if (options.customModules !== undefined) customModules.seed(options.customModules)
  const clock = new FixedClock()
  const ids = new SequentialIdGenerator(options.idPrefix ?? 'id')
  return {
    deps: {
      entries,
      customModules,
      references: new InMemoryEntryReferenceQuery({
        byEntry: options.entryReferences,
        byModule: options.moduleReferences,
      }),
      clock,
      ids,
    },
    entries,
    customModules,
    changes,
    clock,
    ids,
  }
}

/** A reference list keyed for the in-memory query. */
export function referencesFor(
  entries: Readonly<Record<string, readonly InfoEntryReference[]>> = {},
  modules: Readonly<Record<string, readonly InfoEntryReference[]>> = {},
): {
  readonly byEntry: ReadonlyMap<string, readonly InfoEntryReference[]>
  readonly byModule: ReadonlyMap<string, readonly InfoEntryReference[]>
} {
  const keyed = <T>(record: Readonly<Record<string, readonly T[]>>): Map<string, readonly T[]> =>
    new Map(Object.entries(record))
  return {
    byEntry: keyed(entries),
    byModule: keyed(modules),
  }
}
