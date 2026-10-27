/**
 * @file SegmentedControl
 * @description A choice between two or three mutually exclusive values, shown
 * as one segmented track. Built as a radio group so it carries the same
 * keyboard contract: arrows move the selection, and only the selected segment
 * is in the tab order.
 */

import { useRef } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export interface SegmentedOption<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly icon?: IconName
}

export interface SegmentedControlProps<Id extends string> {
  /** Accessible name of the group. */
  readonly label: string
  readonly options: readonly SegmentedOption<Id>[]
  readonly value: Id
  readonly onChange: (id: Id) => void
}

export function SegmentedControl<Id extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<Id>) {
  const groupRef = useRef<HTMLDivElement>(null)

  const select = (id: Id): void => {
    onChange(id)
    const index = options.findIndex((option) => option.id === id)
    const element = groupRef.current?.children[index]
    if (element instanceof HTMLElement) element.focus()
  }

  const move = (from: number, delta: number): void => {
    const next = (from + delta + options.length) % options.length
    const option = options[next]
    if (option !== undefined) select(option.id)
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={label} ref={groupRef}>
      {options.map((option, index) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'segment segment-selected' : 'segment'}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                move(index, 1)
              }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                move(index, -1)
              }
              if (event.key === 'Home') {
                event.preventDefault()
                const first = options[0]
                if (first !== undefined) select(first.id)
              }
              if (event.key === 'End') {
                event.preventDefault()
                const last = options[options.length - 1]
                if (last !== undefined) select(last.id)
              }
            }}
          >
            {option.icon === undefined ? null : <Icon name={option.icon} size={14} />}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
