/**
 * @file ContextChip
 * @description One reference attached to a turn — an information entry, a resume
 * or a job posting. It shows what the assistant will look at, and in the
 * composer it can be removed before sending.
 */

import { Icon } from '../../app/components/Icon'
import type { FeatureIconName } from './icons'
import { FeatureIcon } from './icons'

export interface ContextChipKindIcons {
  readonly entry: FeatureIconName
  readonly resume: FeatureIconName
  readonly jobPosting: FeatureIconName
}

const KIND_ICONS: ContextChipKindIcons = {
  entry: 'clipboard',
  resume: 'quote',
  jobPosting: 'clock',
}

export interface ContextChipProps {
  readonly kind: 'entry' | 'resume' | 'jobPosting'
  readonly label: string
  readonly onRemove?: () => void
}

export function ContextChip({ kind, label, onRemove }: ContextChipProps) {
  return (
    <span className="context-chip" title={label}>
      <FeatureIcon name={KIND_ICONS[kind]} size={12} />
      <span className="context-chip-label">{label}</span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          className="context-chip-remove"
          aria-label={`移除上下文：${label}`}
          onClick={onRemove}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  )
}
