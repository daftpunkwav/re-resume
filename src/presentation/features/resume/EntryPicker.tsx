/**
 * @file EntryPicker
 * @description Choosing the information-library entries one chapter shows. The
 * picker is a multi-select with an explicit order, because the chapter renders
 * the entries in the order the selection states; entries the library no longer
 * has stay visible so the user can remove the dangling reference.
 *
 * Constraints:
 * - The selection limit comes from the module descriptor (personal and intent
 *   hold one entry); a single-entry module replaces on click.
 * - The write happens on confirm through `setSectionSelection`, so cancelling
 *   leaves the document untouched.
 */

import { useState } from 'react'

import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import { moduleDescriptor } from '../../../domain/info/InfoModuleKind'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { useResumeStore } from './resumeStore'
import { sectionEntryLimit } from './resumeFormat'
import type { InfoEntryId } from '../../../domain/shared/branded-id'

export interface EntryPickerProps {
  readonly open: boolean
  readonly section: ResumeSection | null
  readonly onClose: () => void
}

function entriesOfModule(
  entries: readonly InfoEntry[],
  section: ResumeSection,
): readonly InfoEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.moduleKind === section.moduleKind &&
        entry.customModuleId === section.customModuleId,
    )
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

export function EntryPicker({ open, section, onClose }: EntryPickerProps) {
  if (!open || section === null) return null
  // Mounting the body fresh per chapter is what seeds the selection; the
  // dialog has no long-lived form that needs to survive a different chapter.
  return <EntryPickerBody key={section.id} section={section} onClose={onClose} />
}

function EntryPickerBody({
  section,
  onClose,
}: {
  readonly section: ResumeSection
  readonly onClose: () => void
}) {
  const entries = useResumeStore((state) => state.entries)
  const customModules = useResumeStore((state) => state.customModules)
  const committing = useResumeStore((state) => state.committing)
  const resume = useResumeStore((state) => state.resume)
  const setSectionSelection = useResumeStore((state) => state.setSectionSelection)
  const [selected, setSelected] = useState<readonly InfoEntryId[]>(section.entryIds)
  const [error, setError] = useState<string | null>(null)

  const custom = customModules.find((module) => module.id === section.customModuleId) ?? null
  const limit = sectionEntryLimit(section, custom)
  const available = entriesOfModule(entries, section)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const frozen = resume?.status === 'frozen'
  const busy = committing
  const title = `选择${moduleDescriptor(section.moduleKind, custom).label}条目`

  const toggle = (entryId: InfoEntryId): void => {
    setError(null)
    if (selected.includes(entryId)) {
      setSelected(selected.filter((id) => id !== entryId))
      return
    }
    if (limit !== null && selected.length >= limit) {
      if (limit === 1) {
        setSelected([entryId])
        return
      }
      setError(`这一章最多选择 ${limit.toString()} 条。`)
      return
    }
    setSelected([...selected, entryId])
  }

  const confirm = async (): Promise<void> => {
    if (section === null) return
    const accepted = await setSectionSelection(
      section.moduleKind,
      section.customModuleId,
      selected,
    )
    if (accepted) onClose()
    else setError('这次修改没有保存，请重试。')
  }

  return (
    <Dialog
      open
      title={title}
      description={
        limit === null
          ? '顺序即渲染顺序；点击可加入或移出。'
          : `这一章最多 ${limit.toString()} 条，按选择顺序渲染。`
      }
      confirmLabel="应用选择"
      busy={busy}
      onConfirm={() => {
        void confirm()
      }}
      onClose={onClose}
    >
      {selected.length === 0 ? null : (
        <div className="picker-selection" aria-label="已选条目">
          <span className="picker-selection-label">已选 {selected.length} 条</span>
          <ol className="picker-selected-list">
            {selected.map((entryId, index) => {
              const entry = byId.get(entryId)
              return (
                <li key={entryId} className="picker-selected-row">
                  <span className="picker-order">{index + 1}</span>
                  <span className="picker-selected-title">
                    {entry === undefined ? '条目已删除' : entry.title}
                  </span>
                  <Button
                    variant="ghost"
                    size="small"
                    aria-label={`移除 ${entry?.title ?? '已删除条目'}`}
                    onClick={() => toggle(entryId)}
                    disabled={frozen || busy}
                  >
                    移除
                  </Button>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {available.length === 0 ? (
        <p className="studio-hint">
          信息库中还没有这个模块的条目。先到「简历信息」面板添加，回来再选择。
        </p>
      ) : (
        <ul className="picker-list" aria-label="可选择的条目">
          {available.map((entry) => {
            const order = selected.indexOf(entry.id)
            const checked = order >= 0
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={checked ? 'picker-item picker-item-selected' : 'picker-item'}
                  aria-pressed={checked}
                  disabled={frozen || busy}
                  onClick={() => toggle(entry.id)}
                >
                  <span className="picker-item-check" aria-hidden="true">
                    {checked ? '✓' : ''}
                  </span>
                  <span className="picker-item-title">{entry.title}</span>
                  {checked ? <span className="picker-order">{order + 1}</span> : null}
                  {entry.origin === 'agent' ? <Badge tone="accent">Agent</Badge> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error === null ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
