/**
 * @file infoErrors
 * @description Turns the field-validation refusals of the information domain
 * into the text a field shows, and classifies everything else as a form-level
 * failure.
 *
 * Responsibilities:
 * - Map a DomainError to the field it names, when it names one
 * - Word each field code for the control that produced it
 * - Keep a refusal that belongs to no single field at form level
 *
 * Constraints:
 * - The message is presentation copy; the rule itself stays in
 *   `validateFieldValues` and is never re-implemented here.
 * - A thrown value that is not a DomainError is unexpected and is reported as
 *   a failed operation rather than guessed at.
 */

import type { FieldDescriptor } from '../../../domain/info/InfoFieldValue'
import { isDomainError } from '../../../domain/shared/DomainError'

interface FieldViolation {
  /** The field key when the refusal names a field this form shows. */
  readonly fieldKey: string | null
  readonly message: string
}

/** Copy for one refused field, falling back to the type's general requirement. */
function messageForCode(
  code: string,
  descriptor: FieldDescriptor,
  maxLength: number | null,
): string {
  switch (code) {
    case 'blankRequiredField':
      return `请填写${descriptor.label}。`
    case 'fieldTooLong':
      return maxLength === null
        ? '内容超出长度上限。'
        : `最多 ${maxLength.toString()} 个字符。`
    case 'endBeforeStart':
      return '结束时间不能早于开始时间。'
    case 'invalidFieldValue':
      switch (descriptor.type) {
        case 'date':
        case 'dateOrPresent':
          return '日期格式应为 2024-06 或 2024。'
        case 'url':
          return '请输入以 http:// 或 https:// 开头的链接。'
        case 'email':
          return '请输入有效的邮箱地址。'
        case 'enum':
          return '请选择一个有效选项。'
        default:
          return '内容格式不正确。'
      }
    default:
      return '内容未通过校验。'
  }
}

/**
 * Reads a refusal as a field violation. `detail.id` is the field key the
 * validator names; a validator that reported a non-field entity is left to the
 * form-level notice.
 */
export function fieldViolationFor(
  thrown: unknown,
  descriptors: readonly FieldDescriptor[],
): FieldViolation | null {
  if (!isDomainError(thrown)) return null
  const candidates = [thrown.detail?.id, ...(thrown.detail?.blockers ?? [])]
  const descriptor = descriptors.find((candidate) =>
    candidates.some((named) => named === candidate.key),
  )
  if (descriptor === undefined) return null
  return {
    fieldKey: descriptor.key,
    message: messageForCode(thrown.code, descriptor, descriptor.maxLength),
  }
}
