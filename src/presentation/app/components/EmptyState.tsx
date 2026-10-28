/**
 * @file EmptyState
 * @description Shown where content would be. It states what is missing and
 * offers the one action that creates it, rather than rendering a blank region.
 */

import type { ReactNode } from 'react'
import type { IconName } from './Icon'
import { Icon } from './Icon'

export interface EmptyStateProps {
  readonly icon: IconName
  readonly title: string
  readonly description: string
  /** A second, quieter line: the next step that needs no control of its own. */
  readonly footnote?: string
  readonly action?: ReactNode
  /** Tighter spacing for a dense container such as a side panel. */
  readonly compact?: boolean
}

export function EmptyState({
  icon,
  title,
  description,
  footnote,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={compact ? 'empty-state empty-state-compact' : 'empty-state'}>
      <span className="empty-icon">
        <Icon name={icon} size={compact ? 18 : 22} />
      </span>
      <p className="empty-title">{title}</p>
      <p className="empty-description">{description}</p>
      {footnote === undefined ? null : <p className="empty-footnote">{footnote}</p>}
      {action === undefined ? null : <div className="empty-action">{action}</div>}
    </div>
  )
}
