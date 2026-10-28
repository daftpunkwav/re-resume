/**
 * @file TemplateGallery
 * @description The six bundled templates as a small gallery: a schematic of the
 * page each one produces, its name, its column count and its one-line idea.
 * Clicking a card switches the document; the materializer keeps the content, so
 * only the layout changes.
 *
 * Constraints:
 * - The schematic is drawn with CSS, not a rendered resume: a thumbnail must
 *   not cost a materialization or a canvas mount.
 * - The accent used by the schematic is the resume's own accent, so the cards
 *   preview the palette the user is actually running.
 */

import type { TemplateDefinition } from '../../../domain/resume/Template'
import { Badge } from '../../app/components/Badge'
import { useResumeStore, templateChoices } from './resumeStore'
import { accentHex } from './resumeFormat'

function TemplateSchematic({
  template,
  accent,
}: {
  readonly template: TemplateDefinition
  readonly accent: string
}) {
  const columns = template.supports.columns.includes(2) ? 2 : 1
  return (
    <div
      className="template-schematic"
      data-columns={columns}
      aria-hidden="true"
      style={{ ['--template-accent' as string]: accent }}
    >
      <div className="template-paper">
        <div
          className={
            template.tokens.headerLayout === 'centered'
              ? 'template-header template-header-centered'
              : 'template-header'
          }
        >
          <span className="template-name-line" />
          <span className="template-meta-line" />
        </div>
        {template.tokens.ruleAfterHeader ? <div className="template-rule" /> : null}
        <div className="template-body">
          {columns === 2 ? <div className="template-sidebar" /> : null}
          <div className="template-main">
            {[0, 1, 2].map((index) => (
              <div className="template-section" key={index}>
                <span className="template-section-title" />
                <span className="template-text-line" />
                <span className="template-text-line template-text-short" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export interface TemplateCardProps {
  readonly template: TemplateDefinition
  readonly selected: boolean
  readonly accent: string
  readonly disabled?: boolean
  readonly onSelect: (template: TemplateDefinition) => void
}

export function TemplateCard({
  template,
  selected,
  accent,
  disabled = false,
  onSelect,
}: TemplateCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={selected ? 'template-card template-card-selected' : 'template-card'}
      disabled={disabled}
      onClick={() => onSelect(template)}
    >
      <TemplateSchematic template={template} accent={accent} />
      <span className="template-card-copy">
        <span className="template-card-title">
          {template.name}
          <Badge tone={selected ? 'accent' : 'neutral'}>
            {template.supports.columns.includes(2) ? '双栏' : '单栏'}
          </Badge>
        </span>
        <span className="template-card-description">{template.description}</span>
      </span>
    </button>
  )
}

/** The gallery for the open document. */
export function TemplateGallery() {
  const resume = useResumeStore((state) => state.resume)
  const committing = useResumeStore((state) => state.committing)
  const setTemplate = useResumeStore((state) => state.setTemplate)
  const choices = templateChoices(resume)
  const frozen = resume?.status === 'frozen'
  const accent = accentHex(resume?.document.appearance.accentColor ?? 'ink')

  return (
    <div className="studio-stack">
      <div className="studio-section-head">
        <h3 className="studio-subtitle">模板</h3>
        <p className="studio-hint">切换模板不会改变已选内容，只改变排版。</p>
      </div>
      <div className="template-grid" role="radiogroup" aria-label="简历模板">
        {choices.map((choice) => (
          <TemplateCard
            key={choice.template.id}
            template={choice.template}
            selected={choice.selected}
            accent={accent}
            disabled={frozen || committing || choice.selected}
            onSelect={(template) => {
              void setTemplate(template.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}
