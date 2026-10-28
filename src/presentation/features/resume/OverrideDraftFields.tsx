/**
 * @file OverrideDraftFields
 * @description The textarea and its counter inside the override dialog. It only
 * renders the draft; validation and saving belong to `useOverrideForm`.
 */

import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import { TextAreaField } from '../../app/components/TextAreaField'
import { ProvenanceBadges } from './OverrideDialogSections'

export interface OverrideDraftFieldsProps {
  readonly existing: ResumeOverride | undefined
  readonly text: string
  readonly count: number
  readonly limit: number
  readonly tooLong: boolean
  readonly error: string | null
  readonly disabled: boolean
  readonly onChange: (text: string) => void
}

export function OverrideDraftFields({
  existing,
  text,
  count,
  limit,
  tooLong,
  error,
  disabled,
  onChange,
}: OverrideDraftFieldsProps) {
  return (
    <>
      <ProvenanceBadges existing={existing} />
      <TextAreaField
        label="文案"
        value={text}
        rows={7}
        disabled={disabled}
        hint={`${count.toString()} / ${limit.toString()} 字`}
        error={tooLong ? `超出 ${limit.toString()} 字上限` : null}
        onChange={(event) => onChange(event.target.value)}
      />
      {error === null ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
