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
  readonly action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <p className="empty-title">{title}</p>
      <p className="empty-description">{description}</p>
      {action === undefined ? null : <div className="empty-action">{action}</div>}
    </div>
  )
}
