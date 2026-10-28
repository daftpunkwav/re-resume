/**
 * @file ToolCard
 * @description The audit card of one agent tool call: what ran, whether it
 * succeeded, a collapsible redacted summary, and the per-write undo rows.
 *
 * Responsibilities:
 * - Render the running status from the live run, and the settled status from the
 *   stored message
 * - Keep a long summary readable without pushing the transcript apart
 * - Offer「撤销此项」for every write the call recorded
 *
 * Constraints:
 * - Read-only calls have no undo row: nothing was written.
 * - The detail is already redacted and truncated by the run loop; this card never
 *   reinterprets it.
 */

import { useId, useState } from 'react'
import { Badge } from '../../app/components/Badge'
import { Spinner } from '../../app/components/Spinner'
import { useRunStore } from './stores/runStore'
import { ChangeCard, RevisionCard } from './ChangeCard'
import { FeatureIcon } from './icons'
import type { Message } from '../../../domain/conversation/Message'
import type {
  ChangeRecordId,
  ResumeId,
  RevisionId,
} from '../../../domain/shared/branded-id'

const RISK_LABELS = {
  read: '读取',
  write: '修改',
  draft: '草稿',
} as const

/**
 * Tools whose write deliberately has no undo (a resume cannot be deleted from a
 * card; its metadata is not part of the revision history). The card says so
 * instead of offering an operation the use case would refuse.
 */
const IRREVERSIBLE_TOOLS: ReadonlySet<string> = new Set(['createResume', 'updateResume'])

type ToolStatus = 'running' | 'failed' | 'ok'

const STATUS_LABELS: Readonly<Record<ToolStatus, string>> = {
  running: '进行中',
  failed: '失败',
  ok: '成功',
}

interface ToolStatusLineProps {
  readonly status: ToolStatus
}

function ToolStatusLine({ status }: ToolStatusLineProps) {
  if (status === 'running') return <Spinner label={STATUS_LABELS.running} />
  return (
    <>
      <span className={`tool-status-dot tool-status-dot-${status}`} aria-hidden="true" />
      <span>{STATUS_LABELS[status]}</span>
    </>
  )
}

interface ToolCardHeadProps {
  readonly label: string
  readonly risk: 'read' | 'write' | 'draft'
  readonly status: ToolStatus
  readonly failed: boolean
  readonly expandable: boolean
  readonly expanded: boolean
  readonly bodyId: string
  readonly onToggle: () => void
}

function ToolCardHead({
  label,
  risk,
  status,
  failed,
  expandable,
  expanded,
  bodyId,
  onToggle,
}: ToolCardHeadProps) {
  return (
    <button
      type="button"
      className="tool-card-head"
      aria-expanded={expanded}
      aria-controls={bodyId}
      disabled={!expandable}
      onClick={onToggle}
    >
      <span className="tool-card-icon" aria-hidden="true">
        <FeatureIcon name={failed ? 'alert-circle' : 'wrench'} size={14} />
      </span>
      <span className="tool-card-label">{label}</span>
      <Badge tone={risk === 'read' ? 'neutral' : 'accent'}>{RISK_LABELS[risk]}</Badge>
      <span className="tool-card-status">
        <ToolStatusLine status={status} />
      </span>
      {expandable ? (
        <span className="tool-card-chevron" aria-hidden="true">
          <FeatureIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
        </span>
      ) : null}
    </button>
  )
}

interface ToolCardBodyProps {
  readonly bodyId: string
  readonly argsSummary: string
  readonly detail: string
  readonly changeIds: readonly ChangeRecordId[]
  readonly revisionId: RevisionId | null
  readonly resumeId: ResumeId | null
  readonly irreversible: boolean
}

function ToolCardBody({
  bodyId,
  argsSummary,
  detail,
  changeIds,
  revisionId,
  resumeId,
  irreversible,
}: ToolCardBodyProps) {
  const revisionUndoable = !irreversible && revisionId !== null && resumeId !== null
  const undoableCount = changeIds.length + (revisionUndoable ? 1 : 0)
  return (
    <div className="tool-card-body" id={bodyId}>
      {argsSummary === '' ? null : (
        <p className="tool-card-args">
          <span className="tool-card-meta-label">参数</span>
          {argsSummary}
        </p>
      )}
      {detail === '' ? (
        <p className="tool-card-empty">这次调用没有返回可展示的摘要。</p>
      ) : (
        <p className="tool-card-detail">{detail}</p>
      )}
      {irreversible ? (
        <p className="tool-card-empty">此操作不进入撤销历史，可在简历列表中调整或删除。</p>
      ) : null}
      {undoableCount === 0 ? null : (
        <div className="change-list">
          {changeIds.map((changeId, index) => (
            <ChangeCard
              key={changeId}
              changeId={changeId}
              label={changeLabel(undoableCount, index)}
            />
          ))}
          {revisionUndoable && revisionId !== null && resumeId !== null ? (
            <RevisionCard
              resumeId={resumeId}
              revisionId={revisionId}
              label={changeLabel(undoableCount, changeIds.length)}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

export interface ToolCardProps {
  readonly message: Message
}

export function ToolCard({ message }: ToolCardProps) {
  const payload = message.tool
  const live = useRunStore((state) =>
    payload?.invocationId === null || payload === null
      ? undefined
      : state.toolCards[payload.invocationId],
  )
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()

  if (payload === null) return null

  const running = live?.status === 'running' || message.status === 'running'
  const failed = live?.status === 'failed' || message.status === 'failed'
  const status: ToolStatus = running ? 'running' : failed ? 'failed' : 'ok'
  const detail = live !== undefined && live.summary !== '' ? live.summary : payload.detail
  const argsSummary = running && live !== undefined ? live.argsSummary : ''
  const irreversible = IRREVERSIBLE_TOOLS.has(payload.toolName)
  const revisionUndoable =
    !irreversible && payload.revisionId !== null && payload.resumeId !== null
  const undoable = payload.changeIds.length > 0 || revisionUndoable
  const expandable = detail !== '' || argsSummary !== '' || undoable || irreversible

  return (
    <article
      className={`tool-card tool-card-${status}`}
      aria-label={`工具调用：${payload.label}`}
      data-risk={payload.risk}
    >
      <ToolCardHead
        label={payload.label}
        risk={payload.risk}
        status={status}
        failed={failed}
        expandable={expandable}
        expanded={expanded}
        bodyId={bodyId}
        onToggle={() => setExpanded((current) => !current)}
      />
      {expanded ? (
        <ToolCardBody
          bodyId={bodyId}
          argsSummary={argsSummary}
          detail={detail}
          changeIds={payload.changeIds}
          revisionId={payload.revisionId}
          resumeId={payload.resumeId}
          irreversible={irreversible}
        />
      ) : null}
    </article>
  )
}

/** One recorded write; several writes from one call are numbered. */
function changeLabel(count: number, index: number): string {
  return count > 1 ? `可撤销的修改（${(index + 1).toString()}）` : '可撤销的修改'
}
