/**
 * @file CompositionEntryRow
 * @description One selected entry inside an expanded chapter: its order, its
 * title, its rewrite badge and the row actions (reorder, rewrite, remove).
 * The row is presentational; the chapter component owns the selection write.
 */

import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { InfoEntryId } from '../../../domain/shared/branded-id'
import { Badge } from '../../app/components/Badge'
import { Icon } from '../../app/components/Icon'
import { isAgentAuthored } from './resumeFormat'
import { ResumeIcon } from './resumeIcons'

export interface CompositionEntryRowProps {
  readonly entry: InfoEntry | null
  readonly entryId: InfoEntryId
  readonly index: number
  readonly total: number
  readonly busy: boolean
  readonly override: ResumeOverride | null
  readonly onMove: (from: number, to: number) => void
  readonly onRemove: (entryId: InfoEntryId) => void
  readonly onOpenOverride: (entryId: InfoEntryId) => void
}

export function CompositionEntryRow({
  entry,
  entryId,
  index,
  total,
  busy,
  override,
  onMove,
  onRemove,
  onOpenOverride,
}: CompositionEntryRowProps) {
  return (
    <li
      className="entry-row"
      onKeyDown={(event) => {
        if (!event.altKey || busy) return
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          onMove(index, index - 1)
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          onMove(index, index + 1)
        }
      }}
    >
      <span className="entry-order">{index + 1}</span>
      {entry === null ? (
        <span className="entry-title entry-title-missing">条目已删除</span>
      ) : (
        <span className="entry-title">{entry.title}</span>
      )}
      {override === null ? null : isAgentAuthored(override) ? (
        <Badge tone="accent">Agent 改写</Badge>
      ) : (
        <Badge tone="neutral">已改写</Badge>
      )}
      <span className="entry-actions">
        <button
          type="button"
          className="entry-action"
          aria-label="上移条目"
          disabled={busy || index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="entry-action"
          aria-label="下移条目"
          disabled={busy || index === total - 1}
          onClick={() => onMove(index, index + 1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="entry-action"
          aria-label={override === null ? '添加条目改写' : '编辑条目改写'}
          disabled={busy || entry === null}
          onClick={() => onOpenOverride(entryId)}
        >
          <ResumeIcon name="edit" size={12} />
        </button>
        <button
          type="button"
          className="entry-action"
          aria-label="从章节移除条目"
          disabled={busy}
          onClick={() => onRemove(entryId)}
        >
          <Icon name="close" size={12} />
        </button>
      </span>
    </li>
  )
}
