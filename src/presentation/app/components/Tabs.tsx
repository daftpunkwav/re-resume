/**
 * @file Tabs
 * @description Horizontal section switcher. Arrow keys move between tabs, which
 * is the behaviour the tab role implies and a mouse-only switcher would omit.
 *
 * The list is available on its own so a region that already renders its own
 * panel chrome (the dock header) can use the tabs without a second wrapper.
 */

import { useRef } from 'react'
import type { ReactNode } from 'react'

export interface TabDescriptor<Id extends string> {
  readonly id: Id
  readonly label: string
}

export interface TabListProps<Id extends string> {
  readonly tabs: readonly TabDescriptor<Id>[]
  readonly active: Id
  readonly onChange: (id: Id) => void
  /** Accessible name of the tab list. */
  readonly label: string
  readonly className?: string
}

export function TabList<Id extends string>({
  tabs,
  active,
  onChange,
  label,
  className,
}: TabListProps<Id>) {
  const listRef = useRef<HTMLDivElement>(null)

  const moveFocus = (from: number, delta: number): void => {
    const next = (from + delta + tabs.length) % tabs.length
    const target = tabs[next]
    if (target === undefined) return
    onChange(target.id)
    const element = listRef.current?.children[next]
    if (element instanceof HTMLElement) element.focus()
  }

  return (
    <div
      className={className === undefined ? 'tabs-list' : `tabs-list ${className}`}
      role="tablist"
      aria-label={label}
      ref={listRef}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            // Only the rendered panel exists under the tabs; pointing an
            // inactive tab at a missing panel is an invalid IDREF. The active
            // tab names the panel it controls.
            aria-controls={selected ? `tabpanel-${tab.id}` : undefined}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'tab tab-active' : 'tab'}
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
              if (event.key === 'Home') {
                event.preventDefault()
                moveFocus(index, -index)
              }
              if (event.key === 'End') {
                event.preventDefault()
                moveFocus(index, tabs.length - 1 - index)
              }
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export interface TabsProps<Id extends string> extends TabListProps<Id> {
  readonly children: ReactNode
}

export function Tabs<Id extends string>({
  tabs,
  active,
  onChange,
  label,
  className,
  children,
}: TabsProps<Id>) {
  return (
    <div className="tabs">
      <TabList tabs={tabs} active={active} onChange={onChange} label={label} className={className} />
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
