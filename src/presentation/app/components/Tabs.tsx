/**
 * @file Tabs
 * @description Horizontal section switcher. Arrow keys move between tabs, which
 * is the behaviour the tab role implies and a mouse-only switcher would omit.
 */

import { useRef } from 'react'
import type { ReactNode } from 'react'

export interface TabDescriptor<Id extends string> {
  readonly id: Id
  readonly label: string
}

export interface TabsProps<Id extends string> {
  readonly tabs: readonly TabDescriptor<Id>[]
  readonly active: Id
  readonly onChange: (id: Id) => void
  readonly children: ReactNode
}

export function Tabs<Id extends string>({ tabs, active, onChange, children }: TabsProps<Id>) {
  const listRef = useRef<HTMLDivElement>(null)

  const moveFocus = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length
    const target = tabs[next]
    if (target === undefined) return
    onChange(target.id)
    const element = listRef.current?.children[next]
    if (element instanceof HTMLElement) element.focus()
  }

  return (
    <div className="tabs">
      <div className="tabs-list" role="tablist" ref={listRef}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            className={tab.id === active ? 'tab tab-active' : 'tab'}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                moveFocus(index, 1)
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                moveFocus(index, -1)
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="tabs-panel"
        role="tabpanel"
        id={`tabpanel-${active}`}
        aria-labelledby={`tab-${active}`}
      >
        {children}
      </div>
    </div>
  )
}
