/**
 * @file info
 * @description Wires the information-library use cases to the repositories,
 * reference query, clock and identifier source they need. One file per area, so
 * the assembly of one area changes without touching the others.
 *
 * Constraints:
 * - This module only assembles: it constructs nothing and decides no rule.
 * - The service is declared in `capabilities.ts`; this file produces it.
 */

import { createCustomModule } from '../../application/info/createCustomModule'
import { createInfoEntry } from '../../application/info/createInfoEntry'
import { deleteCustomModule } from '../../application/info/deleteCustomModule'
import { deleteInfoEntry } from '../../application/info/deleteInfoEntry'
import { listInfoEntries } from '../../application/info/listInfoEntries'
import { reorderCustomModules } from '../../application/info/reorderCustomModules'
import { reorderInfoEntries } from '../../application/info/reorderInfoEntries'
import { searchInfoEntries } from '../../application/info/searchInfoEntries'
import { updateCustomModule } from '../../application/info/updateCustomModule'
import { updateInfoEntry } from '../../application/info/updateInfoEntry'
import type { InfoLibraryDeps } from '../../application/info/library'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryReferenceQuery } from '../../domain/info/ports/InfoEntryReferenceQuery'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { InfoService } from '../capabilities'

export interface InfoWiring {
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly references: InfoEntryReferenceQuery
  readonly clock: Clock
  readonly ids: IdGenerator
}

export function createInfoService(wiring: InfoWiring): InfoService {
  const deps: InfoLibraryDeps = {
    entries: wiring.entries,
    customModules: wiring.customModules,
    references: wiring.references,
    clock: wiring.clock,
    ids: wiring.ids,
  }
  return {
    listEntries: (input) => listInfoEntries(deps, input),
    searchEntries: (input) => searchInfoEntries(deps, input),
    createEntry: (input) => createInfoEntry(deps, input),
    updateEntry: (input) => updateInfoEntry(deps, input),
    deleteEntry: (input) => deleteInfoEntry(deps, input),
    listEntryReferences: (entryId) => deps.references.listEntryReferences(entryId),
    listModuleReferences: (moduleId) => deps.references.listModuleReferences(moduleId),
    reorderEntries: (input) => reorderInfoEntries(deps, input),
    createCustomModule: (input) => createCustomModule(deps, input),
    updateCustomModule: (input) => updateCustomModule(deps, input),
    deleteCustomModule: (input) => deleteCustomModule(deps, input),
    reorderCustomModules: (input) => reorderCustomModules(deps, input),
  }
}
