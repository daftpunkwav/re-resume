/**
 * @file Badge
 * @description Compact status label. Tone maps to the semantic roles, so a
 * pending claim reads the same in every palette.
 */

import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps {
  readonly tone?: BadgeTone
  readonly children: ReactNode
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
