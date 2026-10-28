/**
 * @file changes wiring
 * @description Assembles the library undo service: the change log, the inverse
 * writer that replays a recorded write, and the use case that enforces the four
 * undo rules.
 *
 * Constraints:
 * - Only assembly: the ordering rules live in `undoLibraryChange`, the inverse
 *   operations in the application-level writer.
 */

import type { LibraryChangesService } from '../capabilities'
import type { ChangeLogRepository } from '../../domain/changes/ports/ChangeLogRepository'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { Clock } from '../../domain/shared/Clock'
import { createLibraryChangeInverseWriter } from '../../application/changes/libraryChangeInverseWriter'
import { undoLibraryChange } from '../../application/changes/undoLibraryChange'

export interface LibraryChangesWiring {
  readonly changes: ChangeLogRepository
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly clock: Clock
}

export function createLibraryChangesService(
  wiring: LibraryChangesWiring,
): LibraryChangesService {
  const inverse = createLibraryChangeInverseWriter(wiring)
  return {
    undo: (input) => undoLibraryChange({ changes: wiring.changes, inverse, clock: wiring.clock }, input),
  }
}
