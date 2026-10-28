/**
 * @file EntryEditorArea
 * @description The editor column of the information panel: the form of the
 * entry being edited, the form of a new entry, or the placeholder that explains
 * why no form is shown.
 *
 * Responsibilities:
 * - Pick which form the selection and the create mode ask for
 * - Keep the form keyed so switching entries never carries a draft across
 * - Render the module-specific empty states
 *
 * Constraints:
 * - Presentation only: writes still go through the callbacks the panel builds
 *   from the use cases, and the panel owns the draft guard around them.
 * - The area returns its content; the panel decides which column wrapper the
 *   current layout tier needs.
 */

import type { ReactNode, RefObject } from 'react'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoEntryId } from '../../../domain/shared/branded-id'
import { Button } from '../../app/components/Button'
import { EmptyState } from '../../app/components/EmptyState'
import { EntryEditor } from './EntryEditor'
import type { EntryEditorHandle } from './EntryEditor'
import type { InfoLayoutTier } from './infoLayout'
import type { AgentTouchKind, ModuleSelection } from './stores/infoStore'

export interface EntryEditorAreaProps {
  readonly creating: boolean
  /** Bumped when a new entry form is opened; it remounts the empty form. */
  readonly createEpoch: number
  readonly selectedModule: ModuleSelection | null
  readonly selectedEntry: InfoEntry | null
  readonly selectedCustomModule: CustomModuleDefinition | null
  readonly moduleEntries: readonly InfoEntry[]
  readonly moduleLabel: string
  readonly tier: InfoLayoutTier
  readonly agentTouched: Readonly<Record<string, AgentTouchKind>>
  readonly editorRef: RefObject<EntryEditorHandle | null>
  readonly onBack: () => void
  readonly onStartCreate: () => void
  readonly onSaved: (entry: InfoEntry, created: boolean) => void
  readonly onCancel: () => void
  readonly onRequestDelete: (entry: InfoEntry) => void
  readonly onAddToConversation?: (entry: InfoEntry) => void
  readonly onCreateEntry: (
    fields: Readonly<Record<string, unknown>>,
  ) => Promise<InfoEntry>
  readonly onUpdateEntry: (
    entryId: InfoEntryId,
    fields: Readonly<Record<string, unknown>>,
  ) => Promise<InfoEntry>
}

export function EntryEditorArea({
  creating,
  createEpoch,
  selectedModule,
  selectedEntry,
  selectedCustomModule,
  moduleEntries,
  moduleLabel,
  tier,
  agentTouched,
  editorRef,
  onBack,
  onStartCreate,
  onSaved,
  onCancel,
  onRequestDelete,
  onAddToConversation,
  onCreateEntry,
  onUpdateEntry,
}: EntryEditorAreaProps): ReactNode {
  if (creating) {
    if (selectedModule === null) return null
    return (
      <EntryEditor
        key={`new-${String(createEpoch)}`}
        ref={editorRef}
        moduleKind={selectedModule.moduleKind}
        customModule={selectedCustomModule}
        entry={null}
        agentTouch={null}
        onSaved={onSaved}
        onCancel={onCancel}
        {...(tier === 'narrow' ? { onBack } : {})}
        onRequestDelete={onRequestDelete}
        {...(onAddToConversation === undefined ? {} : { onAddToConversation })}
        onCreate={onCreateEntry}
        onUpdate={onUpdateEntry}
      />
    )
  }

  if (selectedEntry !== null) {
    return (
      <EntryEditor
        key={selectedEntry.id}
        ref={editorRef}
        moduleKind={selectedEntry.moduleKind}
        customModule={selectedCustomModule}
        entry={selectedEntry}
        agentTouch={agentTouched[selectedEntry.id] ?? null}
        onSaved={onSaved}
        onCancel={onCancel}
        {...(tier === 'narrow' ? { onBack } : {})}
        onRequestDelete={onRequestDelete}
        {...(onAddToConversation === undefined ? {} : { onAddToConversation })}
        onCreate={onCreateEntry}
        onUpdate={onUpdateEntry}
      />
    )
  }

  if (moduleEntries.length === 0) {
    return (
      <div className="info-editor info-editor-empty">
        <EmptyState
          compact
          icon="id-card"
          title={`还没有可编辑的${moduleLabel}`}
          description="在左侧新建一条后，在这里填写字段。"
        />
      </div>
    )
  }

  return (
    <div className="info-editor info-editor-empty">
      <EmptyState
        compact
        icon="id-card"
        title="选择一条信息"
        description="在列表中选择要编辑的信息，或新建一条。"
        action={
          <Button size="small" variant="secondary" icon="plus" onClick={onStartCreate}>
            新建{moduleLabel}
          </Button>
        }
      />
    </div>
  )
}
