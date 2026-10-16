/**
 * @file errorMessages
 * @description Turns a thrown value into a sentence a user can act on. Domain
 * violations arrive as coded errors with the identifiers that blocked them;
 * anything else is unexpected and is reported as such rather than guessed at.
 */

import { isDomainError } from '../../domain/shared/DomainError'
import type { DomainErrorCode } from '../../domain/shared/DomainError'

const DOMAIN_MESSAGES: Readonly<Record<DomainErrorCode, string>> = {
  emptyTitle: '标题不能为空。',
  currentWithEndDate: '标记为「至今」的经历不能同时填写结束日期。',
  endBeforeStart: '结束日期不能早于开始日期。',
  duplicateVariantLabel: '同一经历下的表述名称不能重复。',
  duplicateClaimStatement: '这条断言已经在当前经历中存在。',
  duplicateBlockId: '简历中出现了重复的区块。',
  multipleProfileBlocks: '每份简历最多只能有一个个人资料区块。',
  emptyResume: '简历还没有可展示的内容，先添加经历、文字或姓名。',
  frozenWithoutSnapshot: '已定稿的简历缺少定稿快照。',
  frozenResumeImmutable: '这份简历已定稿，复制一份新的草稿再继续修改。',
  cursorNotOnLiveChain: '这个版本已不在修改链上，无法回到它。',
  variantNotInExperience: '这条表述不属于所选经历。',
  variantUnconfirmed: '这条表述还没确认，确认后才能放进简历。',
  claimRejected: '有断言已被拒绝，需要先更换或移除。',
  claimNotFound: '找不到这条断言，它不属于当前经历。',
  claimPending: '存在待确认的断言，定稿前请先确认或拒绝它们。',
  referencedByBlocks: '仍被简历引用，请先在这些简历中解除引用。',
  invalidClaimTransition: '这条断言当前的状态不允许这个操作。',
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
