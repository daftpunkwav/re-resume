/**
 * @file Notice
 * @description Inline advisory for a region: staleness, unconfirmed drafts,
 * unparsed postings. Deliberately not a toast — anything the user must act on
 * stays on screen until they do.
 */

import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

const TONE_ICONS: Readonly<Record<NoticeTone, IconName>> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  danger: 'alert',
}

export interface NoticeProps {
  readonly tone?: NoticeTone
  readonly title: string
  readonly children?: ReactNode
  readonly actions?: ReactNode
}

export function Notice({ tone = 'info', title, children, actions }: NoticeProps) {
  return (
    <div className={`notice notice-${tone}`} role="status">
      <Icon name={TONE_ICONS[tone]} size={16} />
      <div className="notice-content">
        <p className="notice-title">{title}</p>
        {children === undefined ? null : <div className="notice-body">{children}</div>}
      </div>
      {actions === undefined ? null : <div className="notice-actions">{actions}</div>}
    </div>
  )
}
