/**
 * @file useOverrideForm
 * @description The editable draft of an override dialog: its text, its visible
 * validation message, the character counter and the save transition through the
 * matching use case.
 *
 * Constraints:
 * - The text limit is the document's (summary 4000, entry 2000 code points);
 *   the domain re-validates, this counter is only the visible guard.
 */

import { useState } from 'react'

import { countCodePoints } from '../../../domain/info/codePoints'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import { showToast } from '../../app/stores/toastStore'
import { useResumeStore } from './resumeStore'
import type { OverrideTargetSelection } from './overrideTarget'

export interface OverrideFormState {
  readonly text: string
  readonly count: number
  readonly tooLong: boolean
  readonly error: string | null
  readonly setText: (text: string) => void
  readonly setError: (message: string) => void
  readonly save: () => Promise<void>
}

function draftProblem(text: string, limit: number): string | null {
  if (text.trim() === '') return '文案不能为空；删除请使用「删除这段文案」。'
  if (countCodePoints(text) > limit) return `最多 ${limit.toString()} 个字符。`
  return null
}

export function useOverrideForm(input: {
  readonly target: OverrideTargetSelection
  readonly existing: ResumeOverride | undefined
  readonly limit: number
  readonly onSaved: () => void
}): OverrideFormState {
  const { target, existing, limit, onSaved } = input
  const writeSummaryOverride = useResumeStore((state) => state.writeSummaryOverride)
  const writeEntryOverride = useResumeStore((state) => state.writeEntryOverride)
  const [text, setTextState] = useState(existing?.text ?? '')
  const [error, setError] = useState<string | null>(null)

  const setText = (next: string): void => {
    setTextState(next)
    setError(null)
  }

  const save = async (): Promise<void> => {
    const problem = draftProblem(text, limit)
    if (problem !== null) {
      setError(problem)
      return
    }
    const accepted =
      target.kind === 'summary'
        ? await writeSummaryOverride(text)
        : await writeEntryOverride(target.entryId, text)
    if (!accepted) {
      setError('这次修改没有保存，请重试。')
      return
    }
    showToast('success', target.kind === 'summary' ? '总结已保存' : '改写已保存')
    onSaved()
  }

  const count = countCodePoints(text)
  return { text, count, tooLong: count > limit, error, setText, setError, save }
}
