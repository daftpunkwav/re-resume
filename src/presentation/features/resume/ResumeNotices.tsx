/**
 * @file ResumeNotices
 * @description The banner strip of the studio. Each notice decides whether it
 * applies and returns null otherwise, so this file is only the ordered list.
 *
 * Constraints:
 * - A notice never repeats a toast: something the user has to act on stays on
 *   screen until the action runs.
 * - Locating a missing reference goes through the store's section request, so
 *   the canvas decides where the section is.
 */

import {
  ActionErrorNotice,
  AgentBusyBar,
  EntryUpdatesNotice,
  FrozenNotice,
  LoadErrorNotice,
  MissingReferencesNotice,
} from './ResumeNoticeItems'

export function ResumeNotices() {
  return (
    <div className="studio-notices">
      <AgentBusyBar />
      <LoadErrorNotice />
      <ActionErrorNotice />
      <MissingReferencesNotice />
      <EntryUpdatesNotice />
      <FrozenNotice />
    </div>
  )
}
