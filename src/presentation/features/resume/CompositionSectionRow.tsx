/**
 * @file CompositionSectionRow
 * @description One chapter in the composition list: its title row, drag and
 * keyboard reordering, and (when expanded) its selected entries. The title row
 * is its own component; this one keeps the row state and the entry list.
 */

import { useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'

import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { Resume } from '../../../domain/resume/Resume'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import type { InfoEntryId } from '../../../domain/shared/branded-id'
import { Button } from '../../app/components/Button'
import { CompositionEntryRow } from './CompositionEntryRow'
import { CompositionSectionTitle } from './CompositionSectionTitle'
import { ResumeIcon } from './resumeIcons'
import { reordered } from './compositionOrder'
import {
  resolvedSectionEntries,
  sectionEntryLimit,
  sectionHeading,
} from './resumeFormat'
import { overrideOfTarget, useResumeStore } from './resumeStore'

export interface CompositionSectionRowProps {
  readonly section: ResumeSection
  readonly customModule: CustomModuleDefinition | null
  readonly moduleMissing: boolean
  readonly selected: boolean
  readonly busy: boolean
  readonly columns: 1 | 2
  readonly entryUpdates: ReadonlySet<string>
  readonly entriesById: ReadonlyMap<string, InfoEntry>
  readonly resume: Resume
  readonly onDragStart: (sectionId: ResumeSection['id']) => void
  readonly onDrop: (event: DragEvent<HTMLLIElement>, section: ResumeSection) => void
  readonly onMove: (delta: -1 | 1) => void
  readonly onRemove: (section: ResumeSection) => void
  readonly onOpenPicker: (sectionId: ResumeSection['id']) => void
  readonly onOpenOverride: (entryId: InfoEntryId, sectionId: ResumeSection['id']) => void
}

export function CompositionSectionRow({
  section,
  customModule,
  moduleMissing,
  selected,
  busy,
  columns,
  entryUpdates,
  entriesById,
  resume,
  onDragStart,
  onDrop,
  onMove,
  onRemove,
  onOpenPicker,
  onOpenOverride,
}: CompositionSectionRowProps) {
  const setSectionSelection = useResumeStore((state) => state.setSectionSelection)
  const [expanded, setExpanded] = useState(false)

  const resolvedEntries = resolvedSectionEntries(section, entriesById)
  const missingEntries = resolvedEntries.filter((entry) => entry === null).length
  const updated = section.entryIds.some((entryId) => entryUpdates.has(entryId))
  const limit = sectionEntryLimit(section, customModule)
  const heading = sectionHeading(section, customModule)

  const moveEntry = (from: number, to: number): void => {
    if (to < 0 || to >= section.entryIds.length) return
    void setSectionSelection(
      section.moduleKind,
      section.customModuleId,
      reordered(section.entryIds, from, to),
    )
  }

  const removeEntry = (entryId: InfoEntryId): void => {
    void setSectionSelection(
      section.moduleKind,
      section.customModuleId,
      section.entryIds.filter((id) => id !== entryId),
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (!event.altKey || busy) return
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onMove(-1)
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onMove(1)
    }
  }

  return (
    <li
      className={selected ? 'section-row section-row-selected' : 'section-row'}
      draggable={!busy}
      onDragStart={() => onDragStart(section.id)}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={(event) => onDrop(event, section)}
      onKeyDown={onKeyDown}
    >
      <span className="section-grip" aria-hidden="true">
        <ResumeIcon name="grip" />
      </span>
      <div className="section-main">
        <CompositionSectionTitle
          section={section}
          customModule={customModule}
          moduleMissing={moduleMissing}
          missingEntries={missingEntries}
          updated={updated}
          busy={busy}
          columns={columns}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((current) => !current)}
          onRemove={onRemove}
        />
        {expanded ? (
          <div className="section-entries">
            {resolvedEntries.length === 0 ? (
              <p className="studio-hint">这一章还没有选择条目。</p>
            ) : (
              <ol className="entry-rows" aria-label={`${heading}的条目`}>
                {resolvedEntries.map((entry, index) => {
                  const entryId = section.entryIds[index]
                  if (entryId === undefined) return null
                  return (
                    <CompositionEntryRow
                      key={entryId}
                      entry={entry}
                      entryId={entryId}
                      index={index}
                      total={resolvedEntries.length}
                      busy={busy}
                      override={overrideOfTarget(resume, { kind: 'entry', entryId })}
                      onMove={moveEntry}
                      onRemove={removeEntry}
                      onOpenOverride={(targetEntryId) => onOpenOverride(targetEntryId, section.id)}
                    />
                  )
                })}
              </ol>
            )}
            <Button
              variant="secondary"
              size="small"
              disabled={busy}
              onClick={() => onOpenPicker(section.id)}
            >
              {limit === null ? '选择条目' : `选择条目（最多 ${limit.toString()} 条）`}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  )
}
