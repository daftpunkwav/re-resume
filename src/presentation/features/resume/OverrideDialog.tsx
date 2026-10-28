/**
 * @file OverrideDialog
 * @description Viewing and editing the resume-level rewrites: the summary or one
 * entry's body. Agent-authored text is marked until the user edits it, and an
 * entry rewrite can be written back into the shared library entry through the
 * application use case — the dialog only collects the choice.
 *
 * Constraints:
 * - The form (draft, counter, validation, save) is `useOverrideForm`; the text
 *   fields and the two secondary actions are their own components.
 * - Saving back to the library is never automatic: it needs an explicit click
 *   and a field to write into.
 */

import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import { Dialog } from '../../app/components/Dialog'
import { useResumeStore } from './resumeStore'
import { DeleteOverrideControl, WriteBackToLibrary } from './OverrideDialogSections'
import { OverrideDraftFields } from './OverrideDraftFields'
import type { OverrideTargetSelection } from './overrideTarget'
import { useOverrideForm } from './useOverrideForm'

export type { OverrideTargetSelection } from './overrideTarget'

export interface OverrideDialogProps {
  readonly target: OverrideTargetSelection
  readonly onClose: () => void
}

const SUMMARY_LIMIT = 4000
const ENTRY_LIMIT = 2000

function overrideOf(
  resume: ReturnType<typeof useResumeStore.getState>['resume'],
  target: OverrideTargetSelection,
): ResumeOverride | undefined {
  if (resume === null) return undefined
  return resume.document.overrides.find((override) => {
    if (override.target.kind === 'summary') return target.kind === 'summary'
    return target.kind === 'entry' && override.target.entryId === target.entryId
  })
}

function entryFor(
  target: OverrideTargetSelection,
  entries: readonly InfoEntry[],
): InfoEntry | null {
  if (target.kind !== 'entry') return null
  return entries.find((entry) => entry.id === target.entryId) ?? null
}

function customModuleFor(
  entry: InfoEntry | null,
  modules: readonly CustomModuleDefinition[],
): CustomModuleDefinition | null {
  if (entry === null || entry.customModuleId === null) return null
  return modules.find((module) => module.id === entry.customModuleId) ?? null
}

function dialogDescription(target: OverrideTargetSelection, entry: InfoEntry | null): string {
  if (target.kind === 'entry' && entry === null) {
    return '原条目已删除：这段改写不会渲染，可以删除。'
  }
  return '这段文案只作用于当前简历，不修改信息库条目。'
}

/**
 * The dialog is mounted per opening, so its draft starts from the stored text;
 * there is no open flag to synchronise and no draft from a previous target.
 */
export function OverrideDialog({ target, onClose }: OverrideDialogProps) {
  const resume = useResumeStore((state) => state.resume)
  const entries = useResumeStore((state) => state.entries)
  const customModules = useResumeStore((state) => state.customModules)
  const committing = useResumeStore((state) => state.committing)

  const entry = entryFor(target, entries)
  const customModule = customModuleFor(entry, customModules)
  const existing = overrideOf(resume, target)
  const limit = target.kind === 'summary' ? SUMMARY_LIMIT : ENTRY_LIMIT
  const frozen = resume?.status === 'frozen'
  const busy = committing
  const form = useOverrideForm({ target, existing, limit, onSaved: onClose })
  const title = target.kind === 'summary' ? '个人简介 / 总结' : '条目改写'

  return (
    <Dialog
      open
      title={title}
      description={dialogDescription(target, entry)}
      confirmLabel="保存这段文案"
      busy={busy}
      onConfirm={() => {
        void form.save()
      }}
      onClose={onClose}
    >
      <OverrideDraftFields
        existing={existing}
        text={form.text}
        count={form.count}
        limit={limit}
        tooLong={form.tooLong}
        error={form.error}
        disabled={frozen || busy}
        onChange={form.setText}
      />
      {existing !== undefined && target.kind === 'entry' ? (
        <WriteBackToLibrary
          overrideId={existing.id}
          entry={entry}
          customModule={customModule}
          disabled={frozen || busy}
          onDone={onClose}
          onError={form.setError}
        />
      ) : null}
      {existing === undefined ? null : (
        <DeleteOverrideControl
          overrideId={existing.id}
          disabled={frozen || busy}
          onDone={onClose}
          onError={form.setError}
        />
      )}
    </Dialog>
  )
}
