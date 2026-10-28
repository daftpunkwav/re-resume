/**
 * @file CompositionEditorDialogs
 * @description The dialogs the composition tab opens: the entry picker, the
 * chapter delete confirmation, the rewrite delete confirmation and the rewrite
 * editor. Keeping them out of the editor keeps its list path small.
 */

import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import { Dialog } from '../../app/components/Dialog'
import { EntryPicker } from './EntryPicker'
import { OverrideDialog } from './OverrideDialog'
import type { OverrideTargetSelection } from './OverrideDialog'
import { overrideDisplayTitle } from './CompositionOverridesList'
import { sectionHeading } from './resumeFormat'

export interface CompositionEditorDialogsProps {
  readonly pickerSection: ResumeSection | null
  readonly removeTarget: ResumeSection | null
  readonly deleteOverrideTarget: ResumeOverride | null
  readonly overrideTarget: OverrideTargetSelection | null
  readonly entriesById: ReadonlyMap<string, InfoEntry>
  readonly customModulesById: ReadonlyMap<string, CustomModuleDefinition>
  readonly onClosePicker: () => void
  readonly onClearRemoveTarget: () => void
  readonly onConfirmRemove: (section: ResumeSection) => void
  readonly onClearDeleteOverride: () => void
  readonly onConfirmDeleteOverride: (override: ResumeOverride) => void
  readonly onCloseOverride: () => void
}

function removeDescription(
  section: ResumeSection | null,
  modules: ReadonlyMap<string, CustomModuleDefinition>,
): string | undefined {
  if (section === null) return undefined
  const custom = section.customModuleId === null ? null : (modules.get(section.customModuleId) ?? null)
  return `删除「${sectionHeading(section, custom)}」及其条目选择？信息库中的条目不会被删除。`
}

function overrideDescription(
  override: ResumeOverride | null,
  entries: ReadonlyMap<string, InfoEntry>,
): string | undefined {
  if (override === null) return undefined
  return `删除「${overrideDisplayTitle(override, entries)}」？条目原文会重新显示。`
}

export function CompositionEditorDialogs({
  pickerSection,
  removeTarget,
  deleteOverrideTarget,
  overrideTarget,
  entriesById,
  customModulesById,
  onClosePicker,
  onClearRemoveTarget,
  onConfirmRemove,
  onClearDeleteOverride,
  onConfirmDeleteOverride,
  onCloseOverride,
}: CompositionEditorDialogsProps) {
  return (
    <>
      <EntryPicker open={pickerSection !== null} section={pickerSection} onClose={onClosePicker} />
      <Dialog
        open={removeTarget !== null}
        title="删除章节"
        description={removeDescription(removeTarget, customModulesById)}
        confirmLabel="删除章节"
        destructive
        onConfirm={() => {
          if (removeTarget !== null) onConfirmRemove(removeTarget)
        }}
        onClose={onClearRemoveTarget}
      />
      <Dialog
        open={deleteOverrideTarget !== null}
        title="删除定制文案"
        description={overrideDescription(deleteOverrideTarget, entriesById)}
        confirmLabel="删除文案"
        destructive
        onConfirm={() => {
          if (deleteOverrideTarget !== null) onConfirmDeleteOverride(deleteOverrideTarget)
        }}
        onClose={onClearDeleteOverride}
      />
      {overrideTarget === null ? null : (
        <OverrideDialog
          key={overrideTarget.kind === 'summary' ? 'summary' : `entry:${overrideTarget.entryId}`}
          target={overrideTarget}
          onClose={onCloseOverride}
        />
      )}
    </>
  )
}
