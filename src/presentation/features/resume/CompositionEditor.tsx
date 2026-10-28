/**
 * @file CompositionEditor
 * @description The composition tab: the chapter list with visibility, order,
 * column and per-chapter entry selection, plus the resume-level rewrites. Every
 * interaction is one document change through the studio store, so it lands in
 * the same revision chain as the canvas and undo restores it.
 *
 * Responsibilities:
 * - Chapter order (drag, Alt+arrow), visibility, rename, column, delete
 * - Per-chapter entry selection through the picker, order inside a chapter
 * - The override list with its Agent / user-edited provenance and its actions
 * - Locate a chapter on the canvas when the user picks it
 *
 * Constraints:
 * - Selection is a write: it validates against the library and can refuse, in
 *   which case the picker stays open with the reason.
 * - The editor never touches a frozen resume: buttons are disabled and the
 *   store refuses a write that slips through.
 */

import { useMemo, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'

import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { Icon } from '../../app/components/Icon'
import { Popover } from '../../app/components/Popover'
import { ResumeIcon } from './resumeIcons'
import {
  isAgentAuthored,
  overrideTargetLabel,
  resolvedSectionEntries,
  sectionEntryLimit,
  sectionHeading,
  sectionModuleLabel,
  selectableModules,
} from './resumeFormat'
import { useResumeStore, overrideOfTarget } from './resumeStore'
import type { OverrideTargetSelection } from './OverrideDialog'
import { OverrideDialog } from './OverrideDialog'
import { EntryPicker } from './EntryPicker'

function reordered<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return items
  next.splice(to, 0, moved)
  return next
}

function overrideTitle(override: ResumeOverride, entriesById: ReadonlyMap<string, InfoEntry>): string {
  if (override.target.kind === 'summary') return '个人简介 / 总结'
  const entry = entriesById.get(override.target.entryId)
  return entry === undefined ? '条目已删除' : `改写：${entry.title}`
}

/** The chapter list. */
export function CompositionEditor() {
  const resume = useResumeStore((state) => state.resume)
  const entries = useResumeStore((state) => state.entries)
  const customModules = useResumeStore((state) => state.customModules)
  const committing = useResumeStore((state) => state.committing)
  const entryUpdates = useResumeStore((state) => state.entryUpdates)
  const selection = useResumeStore((state) => state.selection)
  const setSectionOrder = useResumeStore((state) => state.setSectionOrder)
  const setSectionDisplay = useResumeStore((state) => state.setSectionDisplay)
  const removeSection = useResumeStore((state) => state.removeSection)
  const setSectionSelection = useResumeStore((state) => state.setSectionSelection)
  const requestSection = useResumeStore((state) => state.requestSection)
  const selectSection = useResumeStore((state) => state.selectSection)
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  const deleteOverride = useResumeStore((state) => state.deleteOverride)

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [draggingSection, setDraggingSection] = useState<string | null>(null)
  const [pickerSectionId, setPickerSectionId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ResumeSection | null>(null)
  const [overrideTarget, setOverrideTarget] = useState<OverrideTargetSelection | null>(null)
  const [deleteOverrideTarget, setDeleteOverrideTarget] = useState<ResumeOverride | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  const customModulesById = useMemo(
    () => new Map(customModules.map((module) => [module.id, module])),
    [customModules],
  )
  const sections = useMemo(
    () => (resume === null ? [] : [...resume.document.sections].sort((a, b) => a.sortOrder - b.sortOrder)),
    [resume],
  )
  const existingKeys = useMemo(
    () =>
      new Set(
        sections.map(
          (section) => `${section.moduleKind}:${section.customModuleId ?? ''}`,
        ),
      ),
    [sections],
  )
  const availableModules = selectableModules(customModules).filter(
    (module) => !existingKeys.has(`${module.moduleKind}:${module.customModuleId ?? ''}`),
  )
  const overrides = resume?.document.overrides ?? []
  const frozen = resume?.status === 'frozen'
  const busy = frozen || committing
  const pickerSection =
    pickerSectionId === null ? null : (sections.find((section) => section.id === pickerSectionId) ?? null)
  const selectedSectionId = selection.kind === 'section' ? selection.sectionId : null

  if (resume === null) return null

  const commitOrder = (ids: readonly ResumeSection['id'][]): void => {
    void setSectionOrder(ids)
  }

  const moveSection = (section: ResumeSection, delta: -1 | 1): void => {
    const from = sections.findIndex((candidate) => candidate.id === section.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= sections.length) return
    commitOrder(reordered(sections, from, to).map((candidate) => candidate.id))
  }

  const moveEntry = (section: ResumeSection, from: number, to: number): void => {
    if (to < 0 || to >= section.entryIds.length) return
    const next = reordered(section.entryIds, from, to)
    void setSectionSelection(section.moduleKind, section.customModuleId, next)
  }

  const onSectionKeyDown = (event: KeyboardEvent<HTMLLIElement>, section: ResumeSection): void => {
    if (!event.altKey || busy) return
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSection(section, -1)
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSection(section, 1)
    }
  }

  const onDropSection = (event: DragEvent<HTMLLIElement>, target: ResumeSection): void => {
    event.preventDefault()
    if (draggingSection === null || draggingSection === target.id) return
    const from = sections.findIndex((section) => section.id === draggingSection)
    const to = sections.findIndex((section) => section.id === target.id)
    setDraggingSection(null)
    if (from < 0 || to < 0) return
    commitOrder(reordered(sections, from, to).map((section) => section.id))
  }

  return (
    <div className="studio-stack composition-editor">
      <div className="studio-section-head">
        <h3 className="studio-subtitle">章节与条目</h3>
        <p className="studio-hint">拖动或 Alt+↑/↓ 调整顺序；点击章节名可定位到画布。</p>
      </div>

      <ol className="section-list" aria-label="简历章节">
        {sections.map((section) => {
          const customModule =
            section.customModuleId === null
              ? null
              : (customModulesById.get(section.customModuleId) ?? null)
          const moduleMissing = section.moduleKind === 'custom' && customModule === null
          const resolved = resolvedSectionEntries(section, entriesById)
          const missingEntries = resolved.filter((entry) => entry === null).length
          const updatedEntries = section.entryIds.some((entryId) => entryUpdates.has(entryId))
          const isExpanded = expanded.has(section.id)
          const limit = sectionEntryLimit(section, customModule)
          return (
            <li
              key={section.id}
              className={
                selectedSectionId === section.id
                  ? 'section-row section-row-selected'
                  : 'section-row'
              }
              draggable={!busy}
              onDragStart={() => setDraggingSection(section.id)}
              onDragOver={(event) => {
                event.preventDefault()
              }}
              onDrop={(event) => onDropSection(event, section)}
              onKeyDown={(event) => onSectionKeyDown(event, section)}
            >
              <span className="section-grip" aria-hidden="true">
                <ResumeIcon name="grip" />
              </span>
              <div className="section-main">
                <div className="section-title-row">
                  <button
                    type="button"
                    className="section-action"
                    aria-label={section.visible ? '隐藏这一章' : '显示这一章'}
                    title={section.visible ? '隐藏这一章' : '显示这一章'}
                    disabled={busy}
                    onClick={() => {
                      void setSectionDisplay(section.id, { visible: !section.visible })
                    }}
                  >
                    <ResumeIcon name={section.visible ? 'eye' : 'eyeOff'} />
                  </button>
                  {renaming === section.id ? (
                    <input
                      className="section-rename-input"
                      aria-label="章节名称"
                      value={renameValue}
                      autoFocus
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => {
                        const value = renameValue.trim()
                        setRenaming(null)
                        void setSectionDisplay(section.id, {
                          displayName: value === '' ? null : value,
                        })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setRenaming(null)
                        }
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={
                        section.visible
                          ? 'section-title'
                          : 'section-title section-title-hidden'
                      }
                      title="点击定位到画布，双击重命名"
                      onClick={() => {
                        selectSection(section.id)
                        requestSection(section.id)
                      }}
                      onDoubleClick={() => {
                        setRenaming(section.id)
                        setRenameValue(section.displayName ?? '')
                      }}
                    >
                      {sectionHeading(section, customModule)}
                    </button>
                  )}
                  {section.moduleKind === 'custom' && !moduleMissing ? (
                    <Badge tone="neutral">{sectionModuleLabel(section, customModule)}</Badge>
                  ) : null}
                  {!section.visible ? <Badge tone="warning">已隐藏</Badge> : null}
                  {moduleMissing ? <Badge tone="danger">模块已删除</Badge> : null}
                  {missingEntries > 0 ? (
                    <Badge tone="danger">{missingEntries.toString()} 条已删除</Badge>
                  ) : null}
                  {updatedEntries ? (
                    <span
                      className="section-update-dot"
                      title="信息库中的条目已更新，简历不会自动同步"
                    />
                  ) : null}
                  {resume.document.pageSetup.columns === 2 ? (
                    <span className="section-columns" role="group" aria-label="章节所在栏">
                      {[1, 2].map((column) => (
                        <button
                          key={column}
                          type="button"
                          className={
                            section.column === column
                              ? 'column-chip column-chip-selected'
                              : 'column-chip'
                          }
                          aria-pressed={section.column === column}
                          disabled={busy}
                          onClick={() => {
                            void setSectionDisplay(section.id, { column: column as 1 | 2 })
                          }}
                        >
                          {column === 1 ? '左栏' : '右栏'}
                        </button>
                      ))}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="section-action section-expand"
                    aria-label={isExpanded ? '收起条目' : '展开条目'}
                    aria-expanded={isExpanded}
                    disabled={false}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (next.has(section.id)) next.delete(section.id)
                        else next.add(section.id)
                        return next
                      })
                    }
                  >
                    <ResumeIcon name="chevron" />
                  </button>
                  <button
                    type="button"
                    className="section-action section-action-danger"
                    aria-label={`删除章节 ${sectionHeading(section, customModule)}`}
                    disabled={busy}
                    onClick={() => setRemoveTarget(section)}
                  >
                    <ResumeIcon name="trash" />
                  </button>
                </div>

                {isExpanded ? (
                  <div className="section-entries">
                    {resolved.length === 0 ? (
                      <p className="studio-hint">这一章还没有选择条目。</p>
                    ) : (
                      <ol className="entry-rows" aria-label={`${sectionHeading(section, customModule)}的条目`}>
                        {resolved.map((entry, index) => {
                          const entryId = section.entryIds[index]
                          if (entryId === undefined) return null
                          const entryOverride = overrideOfTarget(resume, {
                            kind: 'entry',
                            entryId,
                          })
                          return (
                            <li
                              key={entryId}
                              className="entry-row"
                              onKeyDown={(event) => {
                                if (!event.altKey || busy) return
                                if (event.key === 'ArrowUp') {
                                  event.preventDefault()
                                  moveEntry(section, index, index - 1)
                                }
                                if (event.key === 'ArrowDown') {
                                  event.preventDefault()
                                  moveEntry(section, index, index + 1)
                                }
                              }}
                            >
                              <span className="entry-order">{index + 1}</span>
                              {entry === null ? (
                                <span className="entry-title entry-title-missing">
                                  条目已删除
                                </span>
                              ) : (
                                <span className="entry-title">{entry.title}</span>
                              )}
                              {entryOverride !== null ? (
                                isAgentAuthored(entryOverride) ? (
                                  <Badge tone="accent">Agent 改写</Badge>
                                ) : (
                                  <Badge tone="neutral">已改写</Badge>
                                )
                              ) : null}
                              <span className="entry-actions">
                                <button
                                  type="button"
                                  className="entry-action"
                                  aria-label="上移条目"
                                  disabled={busy || index === 0}
                                  onClick={() => moveEntry(section, index, index - 1)}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="entry-action"
                                  aria-label="下移条目"
                                  disabled={busy || index === resolved.length - 1}
                                  onClick={() => moveEntry(section, index, index + 1)}
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  className="entry-action"
                                  aria-label={entryOverride === null ? '添加条目改写' : '编辑条目改写'}
                                  disabled={busy || entry === null}
                                  onClick={() =>
                                    setOverrideTarget({
                                      kind: 'entry',
                                      entryId,
                                      sectionId: section.id,
                                    })
                                  }
                                >
                                  <ResumeIcon name="edit" size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="entry-action"
                                  aria-label="从章节移除条目"
                                  disabled={busy}
                                  onClick={() => {
                                    void setSectionSelection(
                                      section.moduleKind,
                                      section.customModuleId,
                                      section.entryIds.filter((id) => id !== entryId),
                                    )
                                  }}
                                >
                                  <Icon name="close" size={12} />
                                </button>
                              </span>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy}
                      onClick={() => setPickerSectionId(section.id)}
                    >
                      {limit === null
                        ? '选择条目'
                        : `选择条目（最多 ${limit.toString()} 条）`}
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="popover-anchor composition-add">
        <Button
          variant="secondary"
          size="small"
          icon="plus"
          disabled={busy || availableModules.length === 0}
          aria-haspopup="dialog"
          aria-expanded={addOpen}
          onClick={() => setAddOpen((open) => !open)}
        >
          添加章节
        </Button>
        <Popover open={addOpen} label="选择章节模块" align="start" onClose={() => setAddOpen(false)}>
          <p className="popover-title">添加一个模块章节</p>
          <ul className="add-module-list">
            {availableModules.map((module) => (
              <li key={`${module.moduleKind}:${module.customModuleId ?? ''}`}>
                <button
                  type="button"
                  className="add-module-item"
                  onClick={() => {
                    setAddOpen(false)
                    void setSectionSelection(module.moduleKind, module.customModuleId, [])
                  }}
                >
                  {module.label}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      </div>

      <div className="studio-divider" />

      <div className="studio-section-head">
        <h3 className="studio-subtitle">定制文案</h3>
        <p className="studio-hint">
          面向岗位的总结与条目改写只作用于这份简历；Agent 生成且未被你编辑的文案带徽标。
        </p>
      </div>

      {overrides.length === 0 ? (
        <p className="studio-hint">还没有定制文案。双击画布上的条目或使用条目行的改写按钮。</p>
      ) : (
        <ul className="override-list">
          {overrides.map((override) => (
            <li key={override.id} className="override-row">
              <div className="override-copy">
                <span className="override-title">{overrideTitle(override, entriesById)}</span>
                <span className="override-preview">{override.text.slice(0, 80)}</span>
                <span className="override-badges">
                  <Badge tone={override.target.kind === 'summary' ? 'info' : 'neutral'}>
                    {overrideTargetLabel(override)}
                  </Badge>
                  {isAgentAuthored(override) ? <Badge tone="accent">Agent 生成</Badge> : null}
                  {override.editedByUser ? <Badge tone="neutral">已编辑</Badge> : null}
                </span>
              </div>
              <div className="override-actions">
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    setOverrideTarget(
                      override.target.kind === 'summary'
                        ? { kind: 'summary' }
                        : {
                            kind: 'entry',
                            entryId: override.target.entryId,
                            sectionId: null,
                          },
                    )
                  }
                >
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={frozen || committing}
                  onClick={() => setDeleteOverrideTarget(override)}
                >
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="composition-footnote">
        <Button variant="ghost" size="small" onClick={() => setActiveTab('appearance')}>
          去调整模板与外观
        </Button>
      </div>

      <EntryPicker
        open={pickerSection !== null}
        section={pickerSection}
        onClose={() => setPickerSectionId(null)}
      />

      <Dialog
        open={removeTarget !== null}
        title="删除章节"
        description={
          removeTarget === null
            ? undefined
            : `删除「${sectionHeading(
                removeTarget,
                removeTarget.customModuleId === null
                  ? null
                  : (customModulesById.get(removeTarget.customModuleId) ?? null),
              )}」及其条目选择？信息库中的条目不会被删除。`
        }
        confirmLabel="删除章节"
        destructive
        onConfirm={() => {
          const target = removeTarget
          setRemoveTarget(null)
          if (target !== null) void removeSection(target.id)
        }}
        onClose={() => setRemoveTarget(null)}
      />

      <Dialog
        open={deleteOverrideTarget !== null}
        title="删除定制文案"
        description={
          deleteOverrideTarget === null
            ? undefined
            : `删除「${overrideTitle(deleteOverrideTarget, entriesById)}」？条目原文会重新显示。`
        }
        confirmLabel="删除文案"
        destructive
        onConfirm={() => {
          const target = deleteOverrideTarget
          setDeleteOverrideTarget(null)
          if (target !== null) void deleteOverride(target.id)
        }}
        onClose={() => setDeleteOverrideTarget(null)}
      />

      {overrideTarget === null ? null : (
        <OverrideDialog
          key={overrideTarget.kind === 'summary' ? 'summary' : `entry:${overrideTarget.entryId}`}
          target={overrideTarget}
          onClose={() => setOverrideTarget(null)}
        />
      )}
    </div>
  )
}
