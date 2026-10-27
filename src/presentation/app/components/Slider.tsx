/**
 * @file Slider
 * @description A labelled range control with its current value spelled out
 * next to the label. The native range input is kept for its keyboard and
 * accessibility behaviour and restyled through theme tokens.
 */

import { useId } from 'react'

export interface SliderProps {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly onChange: (value: number) => void
  /** Turns the numeric value into the words shown next to the label. */
  readonly formatValue: (value: number) => string
  readonly description?: string
  readonly disabled?: boolean
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  description,
  disabled = false,
}: SliderProps) {
  const inputId = useId()
  const descriptionId = useId()

  return (
    <div className="slider-field">
      <div className="slider-head">
        <label className="slider-label" htmlFor={inputId}>
          {label}
        </label>
        <span className="slider-value">{formatValue(value)}</span>
      </div>
      <input
        id={inputId}
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={formatValue(value)}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {description === undefined ? null : (
        <p className="slider-description" id={descriptionId}>
          {description}
        </p>
      )}
    </div>
  )
}
