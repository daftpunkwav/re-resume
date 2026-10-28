/**
 * @file errorMessages
 * @description Turns a thrown value into a sentence a user can act on. Domain
 * violations arrive as coded errors with the identifiers that blocked them;
 * anything else is unexpected and is reported as such rather than guessed at.
 * A failed boot is the one case where the interface can only show the reason:
 * its rejection comes from a native plugin, so it has its own reader below
 * instead of the generic sentence used for an operation that failed.
 *
 * Constraints:
 * - Every code in the closed set has a message; a code without one would reach
 *   the interface as `undefined`.
 * - Messages for refused operations describe what was refused and what to do
 *   next, not which module threw. A boot reason is the exception: the native
 *   rejection is the only diagnostic the user can pass on.
 */

import { isDomainError } from '../../domain/shared/DomainError'
import type { DomainErrorCode } from '../../domain/shared/DomainError'

const DOMAIN_MESSAGES: Readonly<Record<DomainErrorCode, string>> = {
  // Field validation.
  blankRequiredField: '必填项不能为空。',
  fieldTooLong: '内容超出长度上限，请精简后再保存。',
  unknownField: '包含这个模块不认识的字段。',
  invalidFieldValue: '字段格式不正确，请检查后重试。',
  endBeforeStart: '结束时间不能早于开始时间。',
  moduleKindMismatch: '条目与模块类型不匹配。',
  // Information library.
  entryNotFound: '找不到这条信息，它可能已被删除。',
  entryReferenced: '这条信息仍被简历引用，需要先确认或解除引用。',
  customModuleNotFound: '找不到这个自定义模块。',
  customModuleLimit: '自定义模块数量已达上限。',
  customFieldLimit: '自定义字段数量已达上限。',
  duplicateFieldKey: '字段标识重复，请换一个名称。',
  fieldRemovalBlocked: '字段仍有内容，删除前需要确认。',
  // Resume document.
  resumeNotFound: '找不到这份简历，它可能已被删除。',
  resumeFrozen: '这份简历已定稿，复制一份草稿后再修改。',
  emptyResume: '简历还没有可展示的内容。',
  sectionNotFound: '找不到这个章节。',
  duplicateSection: '同一模块的章节不能重复。',
  sectionLimitExceeded: '章节中的条目数量超出上限。',
  overrideNotFound: '找不到这段定制文案。',
  overrideLimit: '定制文案数量超出上限。',
  templateNotFound: '找不到这个模板。',
  invalidPageSetup: '页面设置超出允许范围。',
  canvasBlockNotFound: '找不到这个画布元素。',
  canvasBlockOutOfBounds: '画布元素超出页面范围。',
  missingReference: '存在失效的引用，请先处理。',
  frozenWithoutSnapshot: '已定稿的简历缺少定稿快照。',
  // Revision chain.
  cursorNotOnLiveChain: '这个版本已不在修改链上，无法回到它。',
  revisionMismatch: '简历已被其他修改更新，请重新加载后再操作。',
  // Conversation.
  conversationNotFound: '找不到这个会话。',
  messageNotFound: '找不到这条消息。',
  messageNotRetryable: '这条消息不能重试。',
  // Attachments.
  attachmentNotFound: '找不到这个附件。',
  attachmentTooLarge: '附件超出大小限制。',
  unsupportedImageType: '不支持这种图片格式。',
  // Change log.
  changeNotFound: '找不到这条变更记录。',
  changeAlreadyUndone: '这条变更已经撤销。',
  changeOutOfOrder: '需要先撤销更新的变更。',
  // Settings and model access.
  invalidSettings: '设置值不合法。',
  providerNotFound: '找不到这个模型服务配置。',
  providerNotConfigured: '模型服务尚未配置，请先在设置中填写。',
  modelCallFailed: '模型调用失败，请稍后重试。',
}

export interface ReadableError {
  readonly message: string
  /** Identifiers that caused the refusal, shown as secondary detail. */
  readonly blockers: readonly string[]
}

export function describeError(error: unknown): ReadableError {
  if (isDomainError(error)) {
    return {
      message: DOMAIN_MESSAGES[error.code],
      blockers: error.detail?.blockers ?? [],
    }
  }
  if (error instanceof Error && error.message.length > 0) {
    return { message: error.message, blockers: [] }
  }
  return { message: '操作没有完成，请重试。', blockers: [] }
}

/**
 * The reason a boot failed, read from the value the native container rejected
 * with. Native plugins reject with a string or a plain `{ message }` /
 * `{ error }` object rather than an `Error`, so a reader that understands only
 * `Error` reports an unknown cause for the failures a user most needs to read.
 * Nothing is translated here: the plugin's message is the only diagnostic
 * available, and the failure screen shows it as it is.
 */
export function describeBootFailure(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message
  if (typeof thrown === 'string') return thrown
  if (typeof thrown === 'object' && thrown !== null) {
    const rejection = thrown as Record<string, unknown>
    if (typeof rejection.message === 'string') return rejection.message
    if (typeof rejection.error === 'string') return rejection.error
  }
  try {
    const serialised = JSON.stringify(thrown)
    // JSON.stringify returns undefined for the values JSON cannot represent
    // (undefined, functions, symbols); String is the last resort for those.
    return typeof serialised === 'string' ? serialised : String(thrown)
  } catch {
    // Cycles and BigInt values make the serialisation itself throw.
    return String(thrown)
  }
}
