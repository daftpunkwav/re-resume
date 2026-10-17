/**
 * @file Spinner
 * @description Indeterminate progress. Announced politely so a screen reader
 * hears that work is happening rather than only seeing motion.
 */

export interface SpinnerProps {
  readonly label: string
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <span className="spinner-ring" aria-hidden="true" />
      <span className="spinner-label">{label}</span>
    </span>
  )
}
