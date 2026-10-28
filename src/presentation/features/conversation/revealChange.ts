/**
 * @file revealChange
 * @description Navigation from a transcript card to the place the write landed:
 * the panel that owns the changed value is opened, or kept open, and the panel
 * is asked to select and flash the changed object.
 *
 * Responsibilities:
 * - Read the recorded change through the capability facade and turn its entity
 *   into an information-panel reveal request
 * - Ask the resume panel to reload a resume revision and highlight the sections
 *   that revision changed
 * - Keep both panels usable when one is already open
 *
 * Constraints:
 * - This module names no repository and reads no row directly: the change
 *   record comes through `LibraryChangesService`.
 * - A target that does not exist (a deleted entry, a missing record) is reported
 *   as a toast; the panels are not opened onto nothing.
 */

import type { CompositionRoot } from '../../../bootstrap/capabilities'
import type { CustomModuleId, InfoEntryId } from '../../../domain/shared/branded-id'
import { showToast } from '../../app/stores/toastStore'
import { useShellStore } from '../../app/stores/shellStore'
import { useInfoStore } from '../info/stores/infoStore'
import { useResumeStore } from '../resume/resumeStore'
import { messageOf } from '../../app/settings/settingsErrors'

export type WorkspacePanel = 'info' | 'resume'

/**
 * Opens one panel without closing the other. Opening an already visible panel
 * keeps the current combination, so a locate never collapses a two-pane dock.
 */
export function showPanel(panel: WorkspacePanel): void {
  const shell = useShellStore.getState()
  if (shell.rightPanel === 'none') {
    shell.setRightPanel(panel)
    return
  }
  if (shell.rightPanel === panel || shell.rightPanel === 'both') return
  shell.setRightPanel('both')
}

/** Opens the information panel and asks it to select the recorded entry. */
export async function revealLibraryChange(
  services: CompositionRoot,
  changeId: Parameters<CompositionRoot['libraryChanges']['readChange']>[0],
): Promise<void> {
  let record
  try {
    record = await services.libraryChanges.readChange(changeId)
  } catch (failure) {
    showToast('danger', messageOf(failure))
    return
  }
  if (record === null) {
    showToast('info', '这条修改的详情已经不可用')
    return
  }
  if (record.entity === 'infoEntry') {
    showPanel('info')
    useInfoStore.getState().requestReveal({ entryIds: [record.entityId as InfoEntryId] })
    return
  }
  if (record.entity === 'customModule') {
    showPanel('info')
    useInfoStore
      .getState()
      .requestReveal({ customModuleId: record.entityId as CustomModuleId })
    return
  }
  showToast('info', '这次修改发生在对话或岗位描述中，没有独立面板可以定位')
}

/** Opens the resume studio on the revision the assistant wrote and flashes it. */
export function revealResumeRevision(
  resumeId: Parameters<CompositionRoot['libraryChanges']['undoRevision']>[0]['resumeId'],
  revisionId: Parameters<CompositionRoot['libraryChanges']['undoRevision']>[0]['revisionId'],
): void {
  showPanel('resume')
  useResumeStore.getState().requestAgentReveal({ resumeId, revisionId })
}
