/**
 * @file CompositionSectionTitle
 * @description The title row of one chapter: visibility, name (and inline
 * rename), badges, column choice, expand and delete. Small subcomponents carry
 * the per-control wording so the row itself stays an ordered composition.
 */

import { useState } from 'react'

import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import { Badge } from '../../app/components/Badge'
import { ResumeIcon } from './resumeIcons'
import { sectionHeading, sectionModuleLabel } from './resumeFormat'
import { useResumeStore } from './resumeStore'

function SectionBadges({
  section,
  customModule,
  moduleMissing,
  missingEntries,
  updated,
}: {
  readonly section: ResumeSection
  readonly customModule: CustomModuleDefinition | null
  readonly moduleMissing: boolean
  readonly missingEntries: number
  readonly updated: boolean
}) {
  return (
    <>
      {section.moduleKind === 'custom' && !moduleMissing ? (
        <Badge tone="neutral">{sectionModuleLabel(section, customModule)}</Badge>
      ) : null}
      {!section.visible ? <Badge tone="warning">已隐藏</Badge> : null}
      {moduleMissing ? <Badge tone="danger">模块已删除</Badge> : null}
      {missingEntries > 0 ? (
        <Badge tone="danger">{missingEntries.toString()} 条已删除</Badge>
      ) : null}
      {updated ? (
        <span className="section-update-dot" title="信息库中的条目已更新，简历不会自动同步" />
      ) : null}
    </>
  )
}

function VisibilityButton({
  section,
  busy,
}: {
  readonly section: ResumeSection
  readonly busy: boolean
}) {
  const setSectionDisplay = useResumeStore((state) => state.setSectionDisplay)
  const label = section.visible ? '隐藏这一章' : '显示这一章'
  return (
    <button
      type="button"
      className="section-action"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => {
        void setSectionDisplay(section.id, { visible: !section.visible })
      }}
    >
      <ResumeIcon name={section.visible ? 'eye' : 'eyeOff'} />
    </button>
  )
}

function ColumnChoice({
  section,
  busy,
}: {
  readonly section: ResumeSection
  readonly busy: boolean
}) {
  const setSectionDisplay = useResumeStore((state) => state.setSectionDisplay)
  return (
    <span className="section-columns" role="group" aria-label="章节所在栏">
      {[1, 2].map((column) => (
        <button
          key={column}
          type="button"
          className={
            section.column === column ? 'column-chip column-chip-selected' : 'column-chip'
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
  )
}

function SectionName({ section, heading }: { readonly section: ResumeSection; readonly heading: string }) {
  const [renaming, setRenaming] = useState(false)
  const [value, setValue] = useState('')
  const setSectionDisplay = useResumeStore((state) => state.setSectionDisplay)
  const selectSection = useResumeStore((state) => state.selectSection)
  const requestSection = useResumeStore((state) => state.requestSection)

  const commitRename = (): void => {
    const trimmed = value.trim()
    setRenaming(false)
    void setSectionDisplay(section.id, { displayName: trimmed === '' ? null : trimmed })
  }

  if (renaming) {
    return (
      <input
        className="section-rename-input"
        aria-label="章节名称"
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onBlur={commitRename}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setRenaming(false)
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className={section.visible ? 'section-title' : 'section-title section-title-hidden'}
      title="点击定位到画布，双击重命名"
      onClick={() => {
        selectSection(section.id)
        requestSection(section.id)
      }}
      onDoubleClick={() => {
        setRenaming(true)
        setValue(section.displayName ?? '')
      }}
    >
      {heading}
    </button>
  )
}

export interface CompositionSectionTitleProps {
  readonly section: ResumeSection
  readonly customModule: CustomModuleDefinition | null
  readonly moduleMissing: boolean
  readonly missingEntries: number
  readonly updated: boolean
  readonly busy: boolean
  readonly columns: 1 | 2
  readonly expanded: boolean
  readonly onToggleExpanded: () => void
  readonly onRemove: (section: ResumeSection) => void
}

export function CompositionSectionTitle({
  section,
  customModule,
  moduleMissing,
  missingEntries,
  updated,
  busy,
  columns,
  expanded,
  onToggleExpanded,
  onRemove,
}: CompositionSectionTitleProps) {
  const heading = sectionHeading(section, customModule)
  return (
    <div className="section-title-row">
      <VisibilityButton section={section} busy={busy} />
      <SectionName section={section} heading={heading} />
      <SectionBadges
        section={section}
        customModule={customModule}
        moduleMissing={moduleMissing}
        missingEntries={missingEntries}
        updated={updated}
      />
      {columns === 2 ? <ColumnChoice section={section} busy={busy} /> : null}
      <button
        type="button"
        className="section-action section-expand"
        aria-label={expanded ? '收起条目' : '展开条目'}
        aria-expanded={expanded}
        onClick={onToggleExpanded}
      >
        <ResumeIcon name="chevron" />
      </button>
      <button
        type="button"
        className="section-action section-action-danger"
        aria-label={`删除章节 ${heading}`}
        disabled={busy}
        onClick={() => onRemove(section)}
      >
        <ResumeIcon name="trash" />
      </button>
    </div>
  )
}
