/**
 * @file EntryListArea
 * @description The list column of the information panel: the column header, the
 * search field with its create action, and the entry rows. The wide tier names
 * the module in a column header; the folded tiers replace it with a picker.
 *
 * Responsibilities:
 * - Render the header that fits the current layout tier
 * - Connect the list to the panel's selection, query, deletion, ordering and
 *   conversation callbacks
 * - Render the module picker where the navigation column is folded away
 *
 * Constraints:
 * - Presentation only: no service access and no store writes that are not
 *   query edits; the panel owns selection, ordering and dialogue flows.
 */

import type { ReactNode, RefObject } from 'react'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoEntryId } from '../../../domain/shared/branded-id'
import { Button } from '../../app/components/Button'
import { IconButton } from '../../app/components/IconButton'
import { EntryList } from './EntryList'
import type { InfoLayoutTier } from './infoLayout'
import { ModulePicker } from './ModuleNav'
import type { AgentTouchKind, ModuleSelection } from './stores/infoStore'
import type { InfoModuleSummary } from '../../../application/info/listInfoEntries'

export interface EntryListAreaProps {
  readonly tier: InfoLayoutTier
  readonly moduleLabel: string
  readonly selectedModule: ModuleSelection | null
  readonly selectedCustomModule: CustomModuleDefinition | null
  readonly summaries: readonly InfoModuleSummary[]
  readonly moduleEntries: readonly InfoEntry[]
  readonly selectedEntryId: InfoEntryId | null
  readonly query: string
  readonly loading: boolean
  readonly agentTouched: Readonly<Record<string, AgentTouchKind>>
  readonly searchRef: RefObject<HTMLInputElement | null>
  readonly onSelectModule: (selection: ModuleSelection) => void
  readonly onCreateModule: () => void
  readonly onOpenModuleSettings: (module: CustomModuleDefinition) => void
  readonly onCreateEntry: () => void
  readonly onSelectEntry: (entry: InfoEntry) => void
  readonly onDeleteEntry: (entry: InfoEntry) => void
  readonly onReorder: (orderedEntryIds: readonly InfoEntryId[]) => void
  readonly onQueryChange: (query: string) => void
  readonly onAddToConversation?: (entry: InfoEntry) => void
}

export function EntryListArea({
  tier,
  moduleLabel,
  selectedModule,
  selectedCustomModule,
  summaries,
  moduleEntries,
  selectedEntryId,
  query,
  loading,
  agentTouched,
  searchRef,
  onSelectModule,
  onCreateModule,
  onOpenModuleSettings,
  onCreateEntry,
  onSelectEntry,
  onDeleteEntry,
  onReorder,
  onQueryChange,
  onAddToConversation,
}: EntryListAreaProps): ReactNode {
  const count = moduleEntries.length

  const wideHeader = (
    <div className="info-list-head">
      <div className="info-list-heading">
        <h3 className="info-list-title" title={moduleLabel}>
          {moduleLabel}
        </h3>
        <span className="info-list-count">{count} 条</span>
      </div>
      <div className="info-list-head-actions">
        {selectedCustomModule === null ? null : (
          <IconButton
            icon="settings"
            label={`管理「${moduleLabel}」模块`}
            size="small"
            onClick={() => onOpenModuleSettings(selectedCustomModule)}
          />
        )}
        <Button size="small" variant="secondary" icon="plus" onClick={onCreateEntry}>
          新建
        </Button>
      </div>
    </div>
  )

  const compactHeader = (
    <div className="info-compact-head">
      <ModulePicker
        summaries={summaries}
        selectedModule={selectedModule}
        onSelect={onSelectModule}
        onCreateModule={onCreateModule}
      />
      {selectedCustomModule === null ? null : (
        <IconButton
          icon="settings"
          label={`管理「${moduleLabel}」模块`}
          onClick={() => onOpenModuleSettings(selectedCustomModule)}
        />
      )}
    </div>
  )

  const compactCreate = (
    <Button variant="secondary" icon="plus" onClick={onCreateEntry}>
      新建
    </Button>
  )

  return (
    <EntryList
      moduleKind={selectedModule?.moduleKind ?? 'personal'}
      moduleLabel={moduleLabel}
      customModule={selectedCustomModule}
      entries={moduleEntries}
      selectedEntryId={selectedEntryId}
      query={query}
      onQueryChange={onQueryChange}
      searchRef={searchRef}
      header={tier === 'wide' ? wideHeader : compactHeader}
      {...(tier === 'wide' ? {} : { searchAction: compactCreate })}
      showDisclosure={tier === 'narrow'}
      loading={loading}
      onSelect={onSelectEntry}
      onCreate={onCreateEntry}
      onDelete={onDeleteEntry}
      onReorder={onReorder}
      {...(onAddToConversation === undefined ? {} : { onAddToConversation })}
      agentTouched={agentTouched}
    />
  )
}
