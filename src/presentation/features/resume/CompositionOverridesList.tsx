/**
 * @file CompositionOverridesList
 * @description The resume-level rewrites below the chapter list: target, a
 * short preview, provenance badges and the edit/delete actions. It only lists
 * them; the dialog and the delete confirmation live in the composition editor.
 */

import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { isAgentAuthored, overrideTargetLabel } from './resumeFormat'

function overrideTitle(
  override: ResumeOverride,
  entriesById: ReadonlyMap<string, InfoEntry>,
): string {
  if (override.target.kind === 'summary') return '个人简介 / 总结'
  const entry = entriesById.get(override.target.entryId)
  return entry === undefined ? '条目已删除' : `改写：${entry.title}`
}

export interface CompositionOverridesListProps {
  readonly overrides: readonly ResumeOverride[]
  readonly entriesById: ReadonlyMap<string, InfoEntry>
  readonly canDelete: boolean
  readonly onEdit: (override: ResumeOverride) => void
  readonly onDelete: (override: ResumeOverride) => void
}

export function CompositionOverridesList({
  overrides,
  entriesById,
  canDelete,
  onEdit,
  onDelete,
}: CompositionOverridesListProps) {
  if (overrides.length === 0) {
    return <p className="studio-hint">还没有定制文案。双击画布上的条目或使用条目行的改写按钮。</p>
  }
  return (
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
            <Button variant="ghost" size="small" onClick={() => onEdit(override)}>
              编辑
            </Button>
            <Button
              variant="ghost"
              size="small"
              disabled={!canDelete}
              onClick={() => onDelete(override)}
            >
              删除
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The label one override is listed under; shared with the delete dialog. */
export function overrideDisplayTitle(
  override: ResumeOverride,
  entriesById: ReadonlyMap<string, InfoEntry>,
): string {
  return overrideTitle(override, entriesById)
}
