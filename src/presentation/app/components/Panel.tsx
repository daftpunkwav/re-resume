/**
 * @file Panel
 * @description Bordered content surface with an optional header row. The base
 * of every grouped region in the interface.
 */

import type { ReactNode } from 'react'

export interface PanelProps {
  readonly title?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  /** Removes the inner padding for panels that hold their own list chrome. */
  readonly flush?: boolean
}

export function Panel({ title, actions, children, flush = false }: PanelProps) {
  const hasHeader = title !== undefined || actions !== undefined

  return (
    <section className="panel">
      {hasHeader ? (
        <header className="panel-head">
          <h2 className="panel-title">{title}</h2>
          {actions === undefined ? null : <div className="panel-actions">{actions}</div>}
        </header>
      ) : null}
      <div className={flush ? 'panel-body panel-body-flush' : 'panel-body'}>{children}</div>
    </section>
  )
}
