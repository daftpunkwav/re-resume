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
import { ChangeCard } from './ChangeCard'
import { FeatureIcon } from './icons'
import type { Message } from '../../../domain/conversation/Message'

const RISK_LABELS = {
  read: '读取',
  write: '修改',
  draft: '草稿',
} as const

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
  const status = running ? 'running' : failed ? 'failed' : 'ok'
  const statusLabel = running ? '进行中' : failed ? '失败' : '成功'
  const detail = live !== undefined && live.summary !== '' ? live.summary : payload.detail
  const argsSummary = running && live !== undefined ? live.argsSummary : ''
  const hasBody = detail !== '' || argsSummary !== '' || payload.changeIds.length > 0

  return (
    <article
      className={`tool-card tool-card-${status}`}
      aria-label={`工具调用：${payload.label}`}
      data-risk={payload.risk}
    >
      <button
        type="button"
        className="tool-card-head"
        aria-expanded={expanded}
        aria-controls={bodyId}
        disabled={!hasBody}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="tool-card-icon" aria-hidden="true">
          <FeatureIcon name={failed ? 'alert-circle' : 'wrench'} size={14} />
        </span>
        <span className="tool-card-label">{payload.label}</span>
        <Badge tone={payload.risk === 'read' ? 'neutral' : 'accent'}>{RISK_LABELS[payload.risk]}</Badge>
        <span className="tool-card-status">
          {running ? (
            <Spinner label={statusLabel} />
          ) : (
            <>
              <span className={`tool-status-dot tool-status-dot-${status}`} aria-hidden="true" />
              <span>{statusLabel}</span>
            </>
          )}
        </span>
        {hasBody ? (
          <span className="tool-card-chevron" aria-hidden="true">
            <FeatureIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
          </span>
        ) : null}
      </button>
      {expanded ? (
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
          {payload.changeIds.length > 0 ? (
            <div className="change-list">
              {payload.changeIds.map((changeId, index) => (
                <ChangeCard
                  key={changeId}
                  changeId={changeId}
                  label={changeLabel(payload.changeIds.length, index)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/** One recorded write; several writes from one call are numbered. */
function changeLabel(count: number, index: number): string {
  return count > 1 ? `可撤销的修改（${(index + 1).toString()}）` : '可撤销的修改'
}
