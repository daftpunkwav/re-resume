/**
 * @file library
 * @description Wires the information service and the library change log as one
 * pair: the change log reads the entries and modules the service writes, and
 * the service's updates feed the resume side's reference query. Both
 * composition roots assemble this pair over their own repositories, so a
 * dependency added to either service is wired once here.
 *
 * Constraints:
 * - This module only assembles what both roots share: it constructs the
 *   reference adapter over the resume port and decides no rule.
 * - The resume capability is bound by each root separately: the native root
 *   opens the database and the preview root uses the in-memory store, so the
 *   pair above is the part they genuinely share.
 */

import type { CompositionRoot } from '../capabilities'
import type { ChangeLogRepository } from '../../domain/changes/ports/ChangeLogRepository'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import { ResumeEntryReferences } from '../../infrastructure/persistence/resume/ResumeEntryReferences'
import { createLibraryChangesService } from './changes'
import { createInfoService } from './info'

export function createLibraryCore(input: {
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly resumes: ResumeRepository
  readonly changes: ChangeLogRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}): Pick<CompositionRoot, 'info' | 'libraryChanges'> {
  const info = createInfoService({
    entries: input.entries,
    customModules: input.customModules,
    references: new ResumeEntryReferences(input.resumes),
    clock: input.clock,
    ids: input.ids,
  })
  return {
    info,
    libraryChanges: createLibraryChangesService({
      changes: input.changes,
      entries: input.entries,
      customModules: input.customModules,
      resumes: input.resumes,
      clock: input.clock,
    }),
  }
}
