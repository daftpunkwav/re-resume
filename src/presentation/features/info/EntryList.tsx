/**
 * @file EntryList
 * @description The entry column: local search with highlighted hits, the rows
 * themselves, drag and keyboard reordering, and the per-module empty states.
 *
 * Responsibilities:
 * - Filter the module's entries by the query and mark what matched
 * - Reorder through native HTML5 drag and drop or Alt+↑/↓, and only when the
 *   full order is on screen (a filtered list cannot express a position)
 * - Show what the agent just wrote as a two-second badge on the row
 *
 * Constraints:
 * - The list never reaches the services: selection, deletion and reordering
 *   are the panel's calls.
 * - No drag-and-drop library: the platform events carry the identifier.
 */

import { useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from 'react'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import { entrySubtitle } from './formatInfoValues'
import type { AgentTouchKind } from './stores/infoStore'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { EmptyState } from '../../app/components/EmptyState'
import { Icon } from '../../app/components/Icon'
import { IconButton } from '../../app/components/IconButton'
import { Kbd, primaryModifierLabel } from '../../app/components/Kbd'
import type { InfoEntryId } from '../../../domain/shared/branded-id'

export interface EntryListProps {
  readonly moduleKind: InfoModuleKind
  readonly moduleLabel: string
  readonly customModule: CustomModuleDefinition | null
  /** The module's entries in stored order. */
  readonly entries: readonly InfoEntry[]
  readonly selectedEntryId: InfoEntryId | null
  readonly query: string
  readonly onQueryChange: (query: string) => void
  readonly searchRef: RefObject<HTMLInputElement | null>
  /** The module header, or the collapsed module picker, above the search field. */
  readonly header: ReactNode
  /** A compact action rendered beside the search field at narrow widths. */
  readonly searchAction?: ReactNode
  /** Shows a chevron on each row where selecting opens the editor in place. */
  readonly showDisclosure?: boolean
  readonly loading: boolean
  readonly onSelect: (entry: InfoEntry) => void
  readonly onCreate: () => void
  readonly onDelete: (entry: InfoEntry) => void
  readonly onReorder: (orderedEntryIds: readonly InfoEntryId[]) => void
  readonly onAddToConversation?: (entry: InfoEntry) => void
  readonly agentTouched: Readonly<Record<string, AgentTouchKind>>
}

function normalizedQuery(query: string): string {
  return query.trim().toLowerCase()
}

function entryMatches(entry: InfoEntry, needle: string): boolean {
  if (entry.title.toLowerCase().includes(needle)) return true
  return Object.values(entry.fields).some(
    (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
  )
}

/** The text with each case-insensitive occurrence of the query marked. */
function HighlightedText({ text, query }: { readonly text: string; readonly query: string }) {
  const needle = normalizedQuery(query)
  if (needle === '') return <>{text}</>
  const haystack = text.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let foundAt = haystack.indexOf(needle)
  let key = 0
  while (foundAt !== -1) {
    if (foundAt > cursor) parts.push(text.slice(cursor, foundAt))
    parts.push(
      <mark className="info-mark" key={key}>
        {text.slice(foundAt, foundAt + needle.length)}
      </mark>,
    )
    key += 1
    cursor = foundAt + needle.length
    foundAt = haystack.indexOf(needle, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

function moveIdentifier(
  orderedIds: readonly InfoEntryId[],
  entryId: InfoEntryId,
  targetId: InfoEntryId,
  after: boolean,
): readonly InfoEntryId[] | null {
  const from = orderedIds.indexOf(entryId)
  if (from === -1) return null
  const without = orderedIds.filter((id) => id !== entryId)
  const targetIndex = without.indexOf(targetId)
  if (targetIndex === -1) return null
  const next = [...without]
  next.splice(targetIndex + (after ? 1 : 0), 0, entryId)
  return next
}

function swapped(
  orderedIds: readonly InfoEntryId[],
  index: number,
  direction: -1 | 1,
): readonly InfoEntryId[] | null {
  const target = index + direction
  const moved = orderedIds[index]
  const replaced = orderedIds[target]
  if (moved === undefined || replaced === undefined) return null
  const next = [...orderedIds]
  next[index] = replaced
  next[target] = moved
  return next
}

export function EntryList({
  moduleKind,
  moduleLabel,
  customModule,
  entries,
  selectedEntryId,
  query,
  onQueryChange,
  searchRef,
  header,
  searchAction,
  showDisclosure = false,
  loading,
  onSelect,
  onCreate,
  onDelete,
  onReorder,
  onAddToConversation,
  agentTouched,
}: EntryListProps) {
  const [searchFocused, setSearchFocused] = useState(false)
  const [dragEntryId, setDragEntryId] = useState<InfoEntryId | null>(null)
  const [dropHint, setDropHint] = useState<{ id: InfoEntryId; after: boolean } | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  const needle = normalizedQuery(query)
  const visible = needle === '' ? entries : entries.filter((entry) => entryMatches(entry, needle))
  const orderedIds = entries.map((entry) => entry.id)
  // A position in a filtered list is not a position in the module, so ordering
  // is offered only while every entry is visible.
  const canReorder = needle === '' && entries.length > 1

  const resetDrag = (): void => {
    setDragEntryId(null)
    setDropHint(null)
  }

  const reorderTo = (next: readonly InfoEntryId[] | null): void => {
    if (next === null) return
    onReorder(next)
  }

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, entry: InfoEntry): void => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      if (!canReorder) return
      const index = entries.findIndex((candidate) => candidate.id === entry.id)
      if (index === -1) return
      reorderTo(swapped(orderedIds, index, event.key === 'ArrowUp' ? -1 : 1))
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    // Move through the rows with the arrow keys the list role implies.
    event.preventDefault()
    const index = visible.findIndex((candidate) => candidate.id === entry.id)
    const next = visible[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (next === undefined) return
    rowRefs.current.get(next.id)?.focus()
  }

  const focusEntry = (id: InfoEntryId): void => {
    rowRefs.current.get(id)?.focus()
  }

  const onDragStart = (event: DragEvent<HTMLLIElement>, entry: InfoEntry): void => {
    if (!canReorder) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', entry.id)
    setDragEntryId(entry.id)
  }

  const onDragOver = (event: DragEvent<HTMLLIElement>, entry: InfoEntry): void => {
    if (dragEntryId === null || dragEntryId === entry.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    setDropHint({ id: entry.id, after: event.clientY > rect.top + rect.height / 2 })
  }

  const onDrop = (event: DragEvent<HTMLLIElement>, entry: InfoEntry): void => {
    event.preventDefault()
    const dragged = dragEntryId
    const rect = event.currentTarget.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    resetDrag()
    if (dragged === null || dragged === entry.id) return
    reorderTo(moveIdentifier(orderedIds, dragged, entry.id, after))
  }

  const clearSearch = (): void => {
    onQueryChange('')
    searchRef.current?.focus()
  }

  return (
    <div className="info-list-pane">
      {header}
      <div className="info-search" role="search" aria-label={`搜索${moduleLabel}`}>
        <div className="info-search-field">
          <input
            ref={searchRef}
            type="text"
            className="field-control info-search-input"
            placeholder={`搜索${moduleLabel}…`}
            aria-label={`搜索${moduleLabel}`}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault()
                onQueryChange('')
              }
              if (event.key === 'ArrowDown') {
                const first = visible[0]
                if (first === undefined) return
                event.preventDefault()
                focusEntry(first.id)
              }
            }}
          />
          {query === '' && !searchFocused ? (
            <span className="info-search-hint" aria-hidden="true">
              <Kbd>{primaryModifierLabel()}</Kbd>
              <Kbd>K</Kbd>
            </span>
          ) : null}
          {query === '' ? null : (
            <span className="info-search-clear">
              <IconButton icon="close" label="清除搜索" size="small" onClick={clearSearch} />
            </span>
          )}
        </div>
        {searchAction === undefined ? null : (
          <div className="info-search-action">{searchAction}</div>
        )}
      </div>

      {loading ? (
        <div className="info-list-scroll" aria-busy="true">
          <ul className="info-entry-list" aria-label={`${moduleLabel}正在加载`}>
            {[0, 1, 2, 3].map((index) => (
              <li className="info-entry info-skeleton-row" key={index}>
                <span className="info-skeleton info-skeleton-title" />
                <span className="info-skeleton info-skeleton-sub" />
              </li>
            ))}
          </ul>
        </div>
      ) : entries.length === 0 ? (
        <div className="info-list-scroll">
          <EmptyState
            compact
            icon="id-card"
            title={`还没有${moduleLabel}`}
            description={
              moduleKind === 'custom'
                ? '这个模块还没有条目。添加一条，写作简历时就能直接选用。'
                : `在这里记录${moduleLabel}，写简历时可以随时选用。`
            }
            action={
              <Button size="small" variant="secondary" icon="plus" onClick={onCreate}>
                新建{moduleLabel}
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="info-list-scroll">
          <EmptyState
            compact
            icon="id-card"
            title="没有匹配的信息"
            description={`没有找到包含「${query.trim()}」的${moduleLabel}。`}
            action={
              <Button size="small" variant="secondary" onClick={() => onQueryChange('')}>
                清除搜索
              </Button>
            }
          />
        </div>
      ) : (
        <div className="info-list-scroll">
          <ul className="info-entry-list" aria-label={`${moduleLabel}条目`}>
            {visible.map((entry) => {
              const selected = entry.id === selectedEntryId
              const touch = agentTouched[entry.id]
              const subtitle = entrySubtitle(moduleKind, entry.fields, customModule)
              const dropBefore = dropHint?.id === entry.id && !dropHint.after
              const dropAfter = dropHint?.id === entry.id && dropHint.after
              return (
                <li
                  key={entry.id}
                  className="info-entry"
                  data-entry-id={entry.id}
                  data-dragging={dragEntryId === entry.id ? 'true' : undefined}
                  data-drop={dropBefore ? 'before' : dropAfter ? 'after' : undefined}
                  data-agent-touched={touch === undefined ? undefined : touch}
                  draggable={canReorder}
                  onDragStart={(event) => onDragStart(event, entry)}
                  onDragOver={(event) => onDragOver(event, entry)}
                  onDrop={(event) => onDrop(event, entry)}
                  onDragEnd={resetDrag}
                >
                  <button
                    ref={(node) => {
                      if (node === null) rowRefs.current.delete(entry.id)
                      else rowRefs.current.set(entry.id, node)
                    }}
                    type="button"
                    className={
                      selected ? 'info-entry-button info-entry-active' : 'info-entry-button'
                    }
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(entry)}
                    onKeyDown={(event) => onRowKeyDown(event, entry)}
                  >
                    <span className="info-entry-title-line">
                      <span className="info-entry-title">
                        <HighlightedText text={entry.title} query={query} />
                      </span>
                      {touch === undefined ? null : (
                        <Badge tone="accent">{touch === 'created' ? '新增' : '已更新'}</Badge>
                      )}
                      {showDisclosure ? (
                        <span className="info-entry-disclosure" aria-hidden="true">
                          <Icon name="chevron-down" size={14} />
                        </span>
                      ) : null}
                    </span>
                    {subtitle === '' ? null : (
                      <span className="info-entry-sub">
                        <HighlightedText text={subtitle} query={query} />
                      </span>
                    )}
                  </button>
                  <div className="info-entry-actions">
                    {onAddToConversation === undefined ? null : (
                      <IconButton
                        icon="message-square"
                        label={`将「${entry.title}」加入对话`}
                        size="small"
                        showTooltip
                        onClick={() => onAddToConversation(entry)}
                      />
                    )}
                    <IconButton
                      icon="close"
                      label={`删除「${entry.title}」`}
                      size="small"
                      showTooltip
                      onClick={() => onDelete(entry)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="info-list-foot">
        <span>{needle === '' ? `${entries.length} 条` : `${visible.length} 条匹配`}</span>
        {canReorder ? <span>拖动 · Alt+↑ / ↓</span> : null}
      </div>
    </div>
  )
}
