/**
 * @file InfoPanel
 * @description The information library panel: module navigation, the entry
 * list and the entry form, plus the dialogs that guard destructive actions. It
 * is the only component of the feature that talks to the shell-facing services,
 * the store and the keyboard.
 *
 * Responsibilities:
 * - Open the library, keep the selection coherent and repair it after a write
 * - Guard a dirty draft when the module, the entry or the whole panel changes
 * - Fold the three regions as the dock width changes
 *
 * Constraints:
 * - Presentation only: every rule that decides whether a write is legal lives
 *   in the domain and application layers. The deletion and authoring flows live
 *   in their own hooks so this file stays the panel's layout and selection.
 * - The "add to conversation" action is passed in by the shell once the
 *   assistant feature exists; with no handler the action is not rendered, so
 *   the panel never shows a control that cannot do anything.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoEntryId } from '../../../domain/shared/branded-id'
import { describeError } from '../../app/errorMessages'
import { useServices } from '../../app/ApplicationServicesProvider'
import { Button } from '../../app/components/Button'
import { EmptyState } from '../../app/components/EmptyState'
import { IconButton } from '../../app/components/IconButton'
import { Notice } from '../../app/components/Notice'
import { showToast } from '../../app/stores/toastStore'
import { moduleSelectionLabel } from './formatInfoValues'
import { useInfoLayoutTier } from './infoLayout'
import { EntryEditor } from './EntryEditor'
import type { EntryEditorHandle } from './EntryEditor'
import { EntryList } from './EntryList'
import { ModuleNav, ModulePicker } from './ModuleNav'
import { bindInfoPanel, consumePendingInfoSearchFocus } from './panelBridge'
import { useInfoStore } from './stores/infoStore'
import type { ModuleSelection } from './stores/infoStore'
import { useCustomModuleAuthoring } from './useCustomModuleAuthoring'
import { useDraftGuard } from './useDraftGuard'
import { useEntryDeletion } from './useEntryDeletion'
import { useModuleDeletion } from './useModuleDeletion'
import './info.css'

export interface InfoPanelProps {
  /**
   * Adds one entry as context to the assistant. Wired by the shell once the
   * conversation feature exists; until then no control is rendered.
   */
  readonly onAddEntryToConversation?: (entry: InfoEntry) => void
}

function LoadingSkeleton() {
  return (
    <div className="info-panel-body" aria-busy="true" aria-label="正在加载简历信息">
      <div className="info-nav">
        <p className="info-nav-head">模块</p>
        <div className="info-nav-scroll">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <span className="info-skeleton info-skeleton-nav-row" key={index} />
          ))}
        </div>
      </div>
      <div className="info-list-pane">
        <div className="info-skeleton info-skeleton-toolbar" />
        <div className="info-skeleton info-skeleton-search" />
        <div className="info-skeleton-list">
          {[0, 1, 2, 3, 4].map((index) => (
            <div className="info-skeleton-row" key={index}>
              <span className="info-skeleton info-skeleton-title" />
              <span className="info-skeleton info-skeleton-sub" />
            </div>
          ))}
        </div>
      </div>
      <div className="info-editor-pane info-skeleton-editor">
        <span className="info-skeleton info-skeleton-heading" />
        <span className="info-skeleton info-skeleton-field" />
        <span className="info-skeleton info-skeleton-field" />
        <span className="info-skeleton info-skeleton-field-tall" />
      </div>
    </div>
  )
}

export function InfoPanel({ onAddEntryToConversation }: InfoPanelProps) {
  const service = useServices().info
  const entries = useInfoStore((state) => state.entries)
  const customModules = useInfoStore((state) => state.customModules)
  const summaries = useInfoStore((state) => state.summaries)
  const selectedModule = useInfoStore((state) => state.selectedModule)
  const selectedEntryId = useInfoStore((state) => state.selectedEntryId)
  const query = useInfoStore((state) => state.query)
  const loading = useInfoStore((state) => state.loading)
  const busy = useInfoStore((state) => state.busy)
  const error = useInfoStore((state) => state.error)
  const agentTouched = useInfoStore((state) => state.agentTouched)

  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<EntryEditorHandle>(null)
  const tier = useInfoLayoutTier(panelRef)

  const [creating, setCreating] = useState(false)
  const [createEpoch, setCreateEpoch] = useState(0)

  useEffect(() => {
    const store = useInfoStore.getState()
    store.connect(service)
    void store.refresh()
    return () => {
      useInfoStore.getState().clearAgentTouches()
    }
  }, [service])

  const selectedCustomModule = useMemo(
    () =>
      selectedModule?.moduleKind === 'custom'
        ? (customModules.find((module) => module.id === selectedModule.customModuleId) ?? null)
        : null,
    [customModules, selectedModule],
  )
  const moduleLabel =
    selectedModule === null
      ? '信息'
      : moduleSelectionLabel(selectedModule.moduleKind, selectedCustomModule)

  const moduleEntries = useMemo(() => {
    if (selectedModule === null) return []
    return entries.filter((entry) => {
      if (entry.moduleKind !== selectedModule.moduleKind) return false
      if (selectedModule.moduleKind !== 'custom') return true
      return entry.customModuleId === selectedModule.customModuleId
    })
  }, [entries, selectedModule])

  const selectedEntry = useMemo(() => {
    if (selectedEntryId === null) return null
    return moduleEntries.find((entry) => entry.id === selectedEntryId) ?? null
  }, [moduleEntries, selectedEntryId])

  const draftGuard = useDraftGuard(editorRef)
  const requestNavigation = draftGuard.requestNavigation

  const entryDeletion = useEntryDeletion(moduleEntries, (neighbour) => {
    // Deleting a row while a new entry is being written must not discard the
    // draft: the create form keeps its draft and stays open.
    if (creating) return
    setCreating(false)
    useInfoStore.getState().selectEntry(neighbour === null ? null : neighbour.id)
  })

  const moduleDeletion = useModuleDeletion(() => {
    setCreating(false)
  })

  const authoring = useCustomModuleAuthoring(
    (created) => {
      setCreating(false)
      useInfoStore
        .getState()
        .selectModule({ moduleKind: 'custom', customModuleId: created.id })
    },
    (module) => {
      moduleDeletion.request(module)
    },
  )

  // The shell's close request goes through the same draft guard as an in-panel
  // navigation, so the bridge has to read the newest guard function.
  const guardRef = useRef(requestNavigation)
  useEffect(() => {
    guardRef.current = requestNavigation
  })
  useEffect(
    () =>
      bindInfoPanel({
        focusSearch: () => {
          const input = searchRef.current
          if (input === null) return false
          input.focus()
          input.select()
          return true
        },
        requestClose: (close) => guardRef.current(close),
      }),
    [],
  )

  // A focus request can arrive while the panel is still loading; the search
  // field only renders after the library read settles, so it is delivered here.
  useEffect(() => {
    const input = searchRef.current
    if (input === null) return
    if (!consumePendingInfoSearchFocus()) return
    input.focus()
    input.select()
  })

  // In the two-pane layouts the inspector is always populated: choosing a
  // module opens its first entry instead of an empty editor.
  useEffect(() => {
    if (tier === 'narrow' || creating || selectedModule === null) return
    if (selectedEntryId !== null) return
    const first = moduleEntries[0]
    if (first === undefined) return
    useInfoStore.getState().selectEntry(first.id)
  }, [tier, creating, selectedModule, selectedEntryId, moduleEntries])

  const selectModule = (selection: ModuleSelection): void => {
    requestNavigation(() => {
      setCreating(false)
      useInfoStore.getState().selectModule(selection)
    })
  }

  const selectEntry = (entry: InfoEntry): void => {
    if (entry.id === selectedEntryId && !creating) return
    requestNavigation(() => {
      setCreating(false)
      useInfoStore.getState().selectEntry(entry.id)
    })
  }

  const backToList = (): void => {
    requestNavigation(() => {
      setCreating(false)
      useInfoStore.getState().selectEntry(null)
    })
  }

  const startCreate = (): void => {
    requestNavigation(() => {
      setCreating(true)
      setCreateEpoch((epoch) => epoch + 1)
      useInfoStore.getState().selectEntry(null)
    })
  }

  const cancelEditor = (): void => {
    if (creating) {
      setCreating(false)
      useInfoStore.getState().selectEntry(null)
      return
    }
    editorRef.current?.discard()
  }

  const handleEntrySaved = (entry: InfoEntry, created: boolean): void => {
    setCreating(false)
    useInfoStore.getState().selectEntry(entry.id)
    showToast('success', created ? `已添加「${entry.title}」` : '已保存修改')
  }

  const handleReorder = (orderedEntryIds: readonly InfoEntryId[]): void => {
    const selection = useInfoStore.getState().selectedModule
    if (selection === null) return
    void useInfoStore
      .getState()
      .reorderEntries({
        moduleKind: selection.moduleKind,
        customModuleId: selection.customModuleId,
        orderedEntryIds,
      })
      .catch((thrown: unknown) => {
        showToast('danger', describeError(thrown).message)
      })
  }

  const openEditModule = (): void => {
    if (selectedCustomModule === null) return
    authoring.openEdit(selectedCustomModule)
  }

  const editorNode: ReactNode = creating ? (
    selectedModule === null ? null : (
      <EntryEditor
        key={`new-${String(createEpoch)}`}
        ref={editorRef}
        moduleKind={selectedModule.moduleKind}
        customModule={selectedCustomModule}
        entry={null}
        agentTouch={null}
        onSaved={handleEntrySaved}
        onCancel={cancelEditor}
        {...(tier === 'narrow' ? { onBack: backToList } : {})}
        onRequestDelete={entryDeletion.request}
        {...(onAddEntryToConversation === undefined
          ? {}
          : { onAddToConversation: onAddEntryToConversation })}
        onCreate={async (fields) => {
          const output = await useInfoStore.getState().createEntry({
            moduleKind: selectedModule.moduleKind,
            customModuleId: selectedModule.customModuleId,
            fields,
          })
          return output.entry
        }}
        onUpdate={async (entryId, fields) => {
          const output = await useInfoStore.getState().updateEntry({ entryId, fields })
          return output.entry
        }}
      />
    )
  ) : selectedEntry === null ? null : (
    <EntryEditor
      key={selectedEntry.id}
      ref={editorRef}
      moduleKind={selectedEntry.moduleKind}
      customModule={selectedCustomModule}
      entry={selectedEntry}
      agentTouch={agentTouched[selectedEntry.id] ?? null}
      onSaved={handleEntrySaved}
      onCancel={cancelEditor}
      {...(tier === 'narrow' ? { onBack: backToList } : {})}
      onRequestDelete={entryDeletion.request}
      {...(onAddEntryToConversation === undefined
        ? {}
        : { onAddToConversation: onAddEntryToConversation })}
      onCreate={async (fields) => {
        const output = await useInfoStore.getState().createEntry({
          moduleKind: selectedEntry.moduleKind,
          customModuleId: selectedEntry.customModuleId,
          fields,
        })
        return output.entry
      }}
      onUpdate={async (entryId, fields) => {
        const output = await useInfoStore.getState().updateEntry({ entryId, fields })
        return output.entry
      }}
    />
  )

  const editorPlaceholder =
    moduleEntries.length === 0 ? (
      <div className="info-editor info-editor-empty">
        <EmptyState
          compact
          icon="id-card"
          title={`还没有可编辑的${moduleLabel}`}
          description="在左侧新建一条后，在这里填写字段。"
        />
      </div>
    ) : (
      <div className="info-editor info-editor-empty">
        <EmptyState
          compact
          icon="id-card"
          title="选择一条信息"
          description="在列表中选择要编辑的信息，或新建一条。"
          action={
            <Button size="small" variant="secondary" icon="plus" onClick={startCreate}>
              新建{moduleLabel}
            </Button>
          }
        />
      </div>
    )

  /** The three-column layout has room for a named list column. */
  const wideHeader = (
    <div className="info-list-head">
      <div className="info-list-heading">
        <h3 className="info-list-title" title={moduleLabel}>
          {moduleLabel}
        </h3>
        <span className="info-list-count">{moduleEntries.length} 条</span>
      </div>
      <div className="info-list-head-actions">
        {selectedModule?.moduleKind === 'custom' ? (
          <IconButton
            icon="settings"
            label={`管理「${moduleLabel}」模块`}
            size="small"
            onClick={openEditModule}
          />
        ) : null}
        <Button size="small" variant="secondary" icon="plus" onClick={startCreate}>
          新建
        </Button>
      </div>
    </div>
  )

  /**
   * The folded layouts keep one compact bar: the module picker and module
   * management on top, the search field and the create button below. The named
   * column header would repeat what the picker already says.
   */
  const compactHeader = (
    <div className="info-compact-head">
      <ModulePicker
        summaries={summaries}
        selectedModule={selectedModule}
        onSelect={selectModule}
        onCreateModule={authoring.openCreate}
      />
      {selectedModule?.moduleKind === 'custom' ? (
        <IconButton
          icon="settings"
          label={`管理「${moduleLabel}」模块`}
          onClick={openEditModule}
        />
      ) : null}
    </div>
  )

  const compactCreate = (
    <Button variant="secondary" icon="plus" onClick={startCreate}>
      新建
    </Button>
  )

  const listNode = (
    <EntryList
      moduleKind={selectedModule?.moduleKind ?? 'personal'}
      moduleLabel={moduleLabel}
      customModule={selectedCustomModule}
      entries={moduleEntries}
      selectedEntryId={selectedEntryId}
      query={query}
      onQueryChange={(next) => useInfoStore.getState().setQuery(next)}
      searchRef={searchRef}
      header={tier === 'wide' ? wideHeader : compactHeader}
      {...(tier === 'wide' ? {} : { searchAction: compactCreate })}
      showDisclosure={tier === 'narrow'}
      loading={loading}
      onSelect={selectEntry}
      onCreate={startCreate}
      onDelete={entryDeletion.request}
      onReorder={handleReorder}
      {...(onAddEntryToConversation === undefined
        ? {}
        : { onAddToConversation: onAddEntryToConversation })}
      agentTouched={agentTouched}
    />
  )

  const editorOpen = creating || selectedEntry !== null
  const errorState = !loading && error !== null && entries.length === 0
  const staleBanner = error !== null && entries.length > 0

  return (
    <div className="info-panel" ref={panelRef} data-info-tier={tier}>
      {staleBanner ? (
        <div className="info-banner">
          <Notice
            tone="warning"
            title="列表没有刷新"
            actions={
              <Button
                size="small"
                variant="secondary"
                onClick={() => void useInfoStore.getState().refresh()}
              >
                重试
              </Button>
            }
          >
            <p>{error.message}</p>
          </Notice>
        </div>
      ) : null}

      {loading && entries.length === 0 ? (
        <LoadingSkeleton />
      ) : errorState ? (
        <div className="info-panel-state">
          <Notice
            tone="danger"
            title="信息库没有加载出来"
            actions={
              <Button
                size="small"
                variant="secondary"
                onClick={() => void useInfoStore.getState().refresh()}
              >
                重试
              </Button>
            }
          >
            <p>{error?.message ?? '请重试。'}</p>
          </Notice>
        </div>
      ) : (
        <div className="info-panel-body" data-busy={busy ? 'true' : undefined}>
          {tier === 'wide' ? (
            <ModuleNav
              summaries={summaries}
              selectedModule={selectedModule}
              onSelect={selectModule}
              onCreateModule={authoring.openCreate}
            />
          ) : null}
          {tier === 'narrow' ? (
            editorOpen ? (
              <div className="info-narrow-detail">{editorNode ?? editorPlaceholder}</div>
            ) : (
              listNode
            )
          ) : (
            <>
              {listNode}
              <div className="info-editor-pane">{editorNode ?? editorPlaceholder}</div>
            </>
          )}
        </div>
      )}

      {draftGuard.dialog}
      {authoring.dialog}
      {entryDeletion.dialog}
      {moduleDeletion.dialog}
    </div>
  )
}
