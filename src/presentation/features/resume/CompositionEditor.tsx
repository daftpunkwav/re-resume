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
import type { DragEvent } from 'react'

import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import { Button } from '../../app/components/Button'
import { Popover } from '../../app/components/Popover'
import { compositionModelOf } from './compositionModel'
import { CompositionEditorDialogs } from './CompositionEditorDialogs'
import { CompositionOverridesList } from './CompositionOverridesList'
import { CompositionSectionRow } from './CompositionSectionRow'
import type { OverrideTargetSelection } from './OverrideDialog'
import { reordered } from './compositionOrder'
import { useResumeStore } from './resumeStore'

/** The chapter list and the dialogs its rows open. */
export function CompositionEditor() {
  const resume = useResumeStore((state) => state.resume)
  const entries = useResumeStore((state) => state.entries)
  const customModules = useResumeStore((state) => state.customModules)
  const committing = useResumeStore((state) => state.committing)
  const entryUpdates = useResumeStore((state) => state.entryUpdates)
  const selection = useResumeStore((state) => state.selection)
  const setSectionOrder = useResumeStore((state) => state.setSectionOrder)
  const setSectionSelection = useResumeStore((state) => state.setSectionSelection)
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  const removeSection = useResumeStore((state) => state.removeSection)
  const deleteOverride = useResumeStore((state) => state.deleteOverride)

  const [draggingSection, setDraggingSection] = useState<string | null>(null)
  const [pickerSectionId, setPickerSectionId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ResumeSection | null>(null)
  const [overrideTarget, setOverrideTarget] = useState<OverrideTargetSelection | null>(null)
  const [deleteOverrideTarget, setDeleteOverrideTarget] = useState<ResumeOverride | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const model = useMemo(
    () =>
      compositionModelOf(resume, entries, customModules, selection, pickerSectionId, committing),
    [resume, entries, customModules, selection, pickerSectionId, committing],
  )

  if (resume === null) return null

  const commitOrder = (ids: readonly ResumeSection['id'][]): void => {
    void setSectionOrder(ids)
  }

  const moveSection = (section: ResumeSection, delta: -1 | 1): void => {
    const from = model.sections.findIndex((candidate) => candidate.id === section.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= model.sections.length) return
    commitOrder(reordered(model.sections, from, to).map((candidate) => candidate.id))
  }

  const dropSection = (event: DragEvent<HTMLLIElement>, target: ResumeSection): void => {
    event.preventDefault()
    if (draggingSection === null || draggingSection === target.id) return
    const from = model.sections.findIndex((section) => section.id === draggingSection)
    const to = model.sections.findIndex((section) => section.id === target.id)
    setDraggingSection(null)
    if (from < 0 || to < 0) return
    commitOrder(reordered(model.sections, from, to).map((section) => section.id))
  }

  const confirmRemove = (section: ResumeSection): void => {
    setRemoveTarget(null)
    void removeSection(section.id)
  }

  const confirmDeleteOverride = (override: ResumeOverride): void => {
    setDeleteOverrideTarget(null)
    void deleteOverride(override.id)
  }

  const editOverride = (override: ResumeOverride): void => {
    setOverrideTarget(
      override.target.kind === 'summary'
        ? { kind: 'summary' }
        : { kind: 'entry', entryId: override.target.entryId, sectionId: null },
    )
  }

  return (
    <div className="studio-stack composition-editor">
      <div className="studio-section-head">
        <h3 className="studio-subtitle">章节与条目</h3>
        <p className="studio-hint">拖动或 Alt+↑/↓ 调整顺序；点击章节名可定位到画布。</p>
      </div>

      <ol className="section-list" aria-label="简历章节">
        {model.sections.map((section) => (
          <CompositionSectionRow
            key={section.id}
            section={section}
            customModule={
              section.customModuleId === null
                ? null
                : (model.customModulesById.get(section.customModuleId) ?? null)
            }
            moduleMissing={
              section.moduleKind === 'custom' && !model.customModulesById.has(section.customModuleId ?? '')
            }
            selected={model.selectedSectionId === section.id}
            busy={model.busy}
            columns={resume.document.pageSetup.columns}
            entryUpdates={entryUpdates}
            entriesById={model.entriesById}
            resume={resume}
            onDragStart={setDraggingSection}
            onDrop={dropSection}
            onMove={(delta) => moveSection(section, delta)}
            onRemove={setRemoveTarget}
            onOpenPicker={setPickerSectionId}
            onOpenOverride={(entryId, sectionId) =>
              setOverrideTarget({ kind: 'entry', entryId, sectionId })
            }
          />
        ))}
      </ol>

      <div className="popover-anchor composition-add">
        <Button
          variant="secondary"
          size="small"
          icon="plus"
          disabled={model.busy || model.availableModules.length === 0}
          aria-haspopup="dialog"
          aria-expanded={addOpen}
          onClick={() => setAddOpen((open) => !open)}
        >
          添加章节
        </Button>
        <Popover open={addOpen} label="选择章节模块" align="start" onClose={() => setAddOpen(false)}>
          <p className="popover-title">添加一个模块章节</p>
          <ul className="add-module-list">
            {model.availableModules.map((module) => (
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

      <CompositionOverridesList
        overrides={model.overrides}
        entriesById={model.entriesById}
        canDelete={!model.busy}
        onEdit={editOverride}
        onDelete={setDeleteOverrideTarget}
      />

      <div className="composition-footnote">
        <Button variant="ghost" size="small" onClick={() => setActiveTab('appearance')}>
          去调整模板与外观
        </Button>
      </div>

      <CompositionEditorDialogs
        pickerSection={model.pickerSection}
        removeTarget={removeTarget}
        deleteOverrideTarget={deleteOverrideTarget}
        overrideTarget={overrideTarget}
        entriesById={model.entriesById}
        customModulesById={model.customModulesById}
        onClosePicker={() => setPickerSectionId(null)}
        onClearRemoveTarget={() => setRemoveTarget(null)}
        onConfirmRemove={confirmRemove}
        onClearDeleteOverride={() => setDeleteOverrideTarget(null)}
        onConfirmDeleteOverride={confirmDeleteOverride}
        onCloseOverride={() => setOverrideTarget(null)}
      />
    </div>
  )
}
