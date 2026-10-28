/**
 * @file infoReveal
 * @description Turns the workspace reveal request into the selection the
 * information panel shows: the module that owns the changed value and, when the
 * change names an entry, the entry itself.
 *
 * Constraints:
 * - Pure resolution over the library the store already read; no service call.
 * - A custom module change selects the module without selecting an entry, which
 *   is the panel's own empty state for that module.
 */

import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { CustomModuleId, InfoEntryId } from '../../../domain/shared/branded-id'
import type { InfoRevealRequest, ModuleSelection } from './stores/infoStore'

export interface RevealSelection {
  readonly selection: ModuleSelection
  readonly entryId: InfoEntryId | null
}

/** Resolves the selection and entry a reveal request points at, or null. */
export function resolveRevealSelection(
  entries: readonly InfoEntry[],
  request: InfoRevealRequest,
): RevealSelection | null {
  const entry = request.entryIds
    .map((entryId) => entries.find((candidate) => candidate.id === entryId))
    .find((candidate): candidate is InfoEntry => candidate !== undefined)
  if (entry !== undefined) {
    return {
      selection: { moduleKind: entry.moduleKind, customModuleId: entry.customModuleId },
      entryId: entry.id,
    }
  }
  if (request.customModuleId !== null) {
    return {
      selection: { moduleKind: 'custom', customModuleId: request.customModuleId },
      entryId: null,
    }
  }
  if (request.moduleKind !== null) {
    return { selection: { moduleKind: request.moduleKind, customModuleId: null }, entryId: null }
  }
  return null
}

/** The selection a custom module reveal asks for. */
export function customModuleSelection(
  customModuleId: CustomModuleId,
): { readonly selection: ModuleSelection; readonly entryId: null } {
  return { selection: { moduleKind: 'custom', customModuleId }, entryId: null }
}
