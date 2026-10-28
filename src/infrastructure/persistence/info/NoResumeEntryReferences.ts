/**
 * @file NoResumeEntryReferences
 * @description The reference query the native composition root supplies while
 * the build has no resume store: no resume exists, so no resume section can
 * reference a library entry or a custom module.
 *
 * Constraints:
 * - This is an accurate answer for the current build, not a placeholder: the
 *   resume model is not part of the persisted schema yet, so the reference set is
 *   empty by construction.
 * - Delete-entry tests exercise the port with a real reference list; the preview
 *   assembly supplies an in-memory implementation. This class is the native
 *   root's implementation only.
 */

import type {
  InfoEntryReference,
  InfoEntryReferenceQuery,
} from '../../../domain/info/ports/InfoEntryReferenceQuery'
import type { CustomModuleId, InfoEntryId } from '../../../domain/shared/branded-id'

export class NoResumeEntryReferences implements InfoEntryReferenceQuery {
  async listEntryReferences(_entryId: InfoEntryId): Promise<readonly InfoEntryReference[]> {
    return []
  }

  async listModuleReferences(_moduleId: CustomModuleId): Promise<readonly InfoEntryReference[]> {
    return []
  }
}
