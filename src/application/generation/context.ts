/**
 * @file context
 * @description Token budget and context assembly for one agent turn.
 *
 * Responsibilities:
 * - Own the token estimator the whole assistant workflow shares
 * - Fit the resume summary, library overview, context chips, job description
 *   and conversation history into their per-block budgets
 * - Cut blocks in the documented order when the total budget is exceeded
 * - Record every truncation, so the system prompt can say what was omitted
 *
 * Constraints:
 * - Truncation is never silent: a shortened or dropped block produces a note
 *   that ends up in the prompt.
 * - The assembler receives already rendered text. It does not query a
 *   repository, read a file or call a model, which is what keeps the budget
 *   arithmetic testable without any of those.
 */

import type { Result } from '../../domain/shared/Result'
import { err, ok } from '../../domain/shared/Result'
import type { MessageContextKind } from '../../domain/conversation/MessageContext'

/** Total prompt budget for one model request, in estimated tokens. */
export const AGENT_CONTEXT_TOKEN_BUDGET = 12_000

/** Per-block budgets, from the technical contract. */
export const CONTEXT_BLOCK_TOKEN_BUDGET = {
  preamble: 400,
  resumeSummary: 800,
  libraryOverview: 1200,
  contextChips: 2000,
  jobPosting: 3000,
  history: 4000,
} as const

/** How many of the most recent messages the history block may carry. */
export const CONTEXT_HISTORY_MESSAGE_LIMIT = 20

/** Head and tail sizes used when the job description does not fit. */
const JOB_POSTING_HEAD_TOKENS = 2000
const JOB_POSTING_TAIL_TOKENS = 1000

/** Marker appended to any text the assembler shortened. */
export const TRUNCATION_MARKER = '…'

export interface ContextChip {
  readonly kind: MessageContextKind
  readonly refId: string
  /** Already rendered chip content, or a reference description. */
  readonly text: string
}

export interface ContextHistoryMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export interface AgentContextSources {
  /** Fixed instruction text; it is measured but never truncated. */
  readonly preamble: string
  readonly resumeSummary: string | null
  readonly libraryOverview: string | null
  readonly chips: readonly ContextChip[]
  readonly jobPosting: string | null
  /** Messages in sequence order; the assembler keeps the most recent limit. */
  readonly history: readonly ContextHistoryMessage[]
  /** True when the conversation has messages older than the loaded window. */
  readonly hasEarlierMessages: boolean
  /** Rolling summary that stands in for the earlier messages, when one exists. */
  readonly summary: string | null
}

export interface AgentContext {
  readonly resumeSummary: string | null
  readonly libraryOverview: string | null
  readonly userContext: string | null
  readonly jobPosting: string | null
  readonly history: string | null
  /** Truncation notes, in the order they were decided. */
  readonly notes: readonly string[]
  readonly estimatedTokens: number
}

export interface ContextAssemblyFailure {
  readonly kind: 'contextTooLarge'
  readonly estimatedTokens: number
  readonly budget: number
}

export interface TruncatedText {
  readonly text: string
  readonly truncated: boolean
}

/**
 * `cjkCodePoints + ceil(latinCodePoints / 4)`. The estimator counts code points,
 * not bytes: CJK glyphs are roughly one token each in the models this
 * application talks to, while Latin text averages four characters per token.
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let latin = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (isCjkCodePoint(codePoint)) cjk += 1
    else latin += 1
  }
  return cjk + Math.ceil(latin / 4)
}

/** Shortens text to at most `maxTokens`, appending the truncation marker. */
export function truncateToTokens(text: string, maxTokens: number): TruncatedText {
  if (maxTokens <= 0) return { text: '', truncated: text.length > 0 }
  if (estimateTokens(text) <= maxTokens) return { text, truncated: false }
  const limit = Math.max(1, maxTokens - 1)
  let cjk = 0
  let latin = 0
  let consumed = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    const nextCjk = cjk + (isCjkCodePoint(codePoint) ? 1 : 0)
    const nextLatin = latin + (isCjkCodePoint(codePoint) ? 0 : 1)
    if (nextCjk + Math.ceil(nextLatin / 4) > limit) break
    cjk = nextCjk
    latin = nextLatin
    consumed += character.length
  }
  return { text: `${text.slice(0, consumed)}${TRUNCATION_MARKER}`, truncated: true }
}

/** A head-and-tail excerpt, used for the job description. */
export function headTailToTokens(
  text: string,
  headTokens: number,
  tailTokens: number,
): TruncatedText {
  if (estimateTokens(text) <= headTokens + tailTokens) return { text, truncated: false }
  const head = truncateToTokens(text, headTokens).text.replace(
    new RegExp(`${TRUNCATION_MARKER}$`, 'u'),
    '',
  )
  let tailCjk = 0
  let tailLatin = 0
  let tailLength = 0
  for (const character of [...text].reverse()) {
    const codePoint = character.codePointAt(0) ?? 0
    const nextCjk = tailCjk + (isCjkCodePoint(codePoint) ? 1 : 0)
    const nextLatin = tailLatin + (isCjkCodePoint(codePoint) ? 0 : 1)
    if (nextCjk + Math.ceil(nextLatin / 4) > tailTokens) break
    tailCjk = nextCjk
    tailLatin = nextLatin
    tailLength += character.length
  }
  const tail = tailLength === 0 ? '' : text.slice(text.length - tailLength)
  return {
    text: `${head}\n${TRUNCATION_MARKER}（截断）\n${tail}`,
    truncated: true,
  }
}

/** Assembles the context blocks and enforces the total budget. */
export function assembleAgentContext(
  sources: AgentContextSources,
): Result<AgentContext, ContextAssemblyFailure> {
  const notes: string[] = []
  const preambleTokens = estimateTokens(sources.preamble)

  const resumeSummary = fitBlock(
    sources.resumeSummary,
    CONTEXT_BLOCK_TOKEN_BUDGET.resumeSummary,
    '简历摘要',
    notes,
  )
  const libraryOverview = fitBlock(
    sources.libraryOverview,
    CONTEXT_BLOCK_TOKEN_BUDGET.libraryOverview,
    '信息库概览',
    notes,
  )
  const userContext = fitChips(sources.chips, notes)
  const jobPosting = fitJobPosting(sources.jobPosting, notes)
  const history = fitHistory(sources, notes)

  const reduced = applyTotalBudget(
    { preambleTokens, resumeSummary, libraryOverview, userContext, jobPosting, history },
    notes,
  )
  if (reduced.overBudget) {
    return err({
      kind: 'contextTooLarge',
      estimatedTokens: reduced.estimatedTokens,
      budget: AGENT_CONTEXT_TOKEN_BUDGET,
    })
  }
  return ok({
    resumeSummary: reduced.resumeSummary,
    libraryOverview: reduced.libraryOverview,
    userContext: reduced.userContext,
    jobPosting: reduced.jobPosting,
    history: reduced.history,
    notes,
    estimatedTokens: reduced.estimatedTokens,
  })
}

interface Blocks {
  readonly preambleTokens: number
  readonly resumeSummary: string | null
  readonly libraryOverview: string | null
  readonly userContext: string | null
  readonly jobPosting: string | null
  readonly history: string | null
}

interface ReducedBlocks extends Blocks {
  readonly overBudget: boolean
  readonly estimatedTokens: number
}

/**
 * The budget order is the contract: history first, then the job description,
 * then the library overview. The preamble, resume summary and chips are
 * structural and survive.
 */
/** Blocks are given up in this order when the whole prompt is too long. */
const TOTAL_BUDGET_REDUCTIONS = [
  { block: 'history', note: '历史消息因总长度限制被裁剪。' },
  { block: 'jobPosting', note: '岗位描述因总长度限制被裁剪。' },
  { block: 'libraryOverview', note: '信息库概览因总长度限制被裁剪。' },
] as const

type ReducibleBlock = (typeof TOTAL_BUDGET_REDUCTIONS)[number]['block']

function totalTokensOf(blocks: Blocks): number {
  return (
    blocks.preambleTokens +
    tokensOf(blocks.resumeSummary) +
    tokensOf(blocks.libraryOverview) +
    tokensOf(blocks.userContext) +
    tokensOf(blocks.jobPosting) +
    tokensOf(blocks.history)
  )
}

/** Cuts a block by the tokens the prompt is over, or null when nothing is left. */
function shrinkBlock(block: string, over: number): string | null {
  const keep = Math.max(0, tokensOf(block) - over)
  const truncated = truncateToTokens(block, keep)
  return truncated.text === '' ? null : truncated.text
}

function applyTotalBudget(blocks: Blocks, notes: string[]): ReducedBlocks {
  let current = blocks
  let over = totalTokensOf(current) - AGENT_CONTEXT_TOKEN_BUDGET
  for (const reduction of TOTAL_BUDGET_REDUCTIONS) {
    if (over <= 0) break
    const block = current[reduction.block as ReducibleBlock]
    if (block === null) continue
    const next = shrinkBlock(block, over)
    if (next === block) continue
    notes.push(reduction.note)
    current = { ...current, [reduction.block]: next }
    over = totalTokensOf(current) - AGENT_CONTEXT_TOKEN_BUDGET
  }
  return { ...current, overBudget: over > 0, estimatedTokens: totalTokensOf(current) }
}

function fitBlock(
  text: string | null,
  budget: number,
  label: string,
  notes: string[],
): string | null {
  if (text === null || text.trim() === '') return null
  const truncated = truncateToTokens(text, budget)
  if (truncated.truncated) notes.push(`${label}因长度限制被截断。`)
  return truncated.text
}

function fitChips(chips: readonly ContextChip[], notes: string[]): string | null {
  if (chips.length === 0) return null
  const kept = [...chips]
  const omitted: ContextChip[] = []
  const render = (entries: readonly ContextChip[]): string =>
    entries
      .map((chip) => {
        const prefix = `${contextKindLabel(chip.kind)} ${chip.refId}`
        return chip.text.trim() === '' ? prefix : `${prefix}：\n${chip.text}`
      })
      .join('\n\n')
  while (
    kept.length > 0 &&
    estimateTokens(render(kept)) > CONTEXT_BLOCK_TOKEN_BUDGET.contextChips
  ) {
    const removed = kept.pop()
    if (removed !== undefined) omitted.unshift(removed)
  }
  if (omitted.length > 0) {
    notes.push(
      `以下上下文因长度限制被省略：${omitted.map((chip) => chip.refId).join('、')}。`,
    )
  }
  if (kept.length === 0) return null
  const text = render(kept)
  const truncated = truncateToTokens(text, CONTEXT_BLOCK_TOKEN_BUDGET.contextChips)
  if (truncated.truncated) notes.push('用户提供的上下文因长度限制被截断。')
  return truncated.text
}

function fitJobPosting(text: string | null, notes: string[]): string | null {
  if (text === null || text.trim() === '') return null
  const excerpt = headTailToTokens(text, JOB_POSTING_HEAD_TOKENS, JOB_POSTING_TAIL_TOKENS)
  if (excerpt.truncated) notes.push('岗位描述已截断，保留开头与结尾。')
  return excerpt.text
}

function fitHistory(sources: AgentContextSources, notes: string[]): string | null {
  const window = sources.history.slice(-CONTEXT_HISTORY_MESSAGE_LIMIT)
  const omittedForWindow = sources.history.length - window.length
  const hasEarlier = sources.hasEarlierMessages || omittedForWindow > 0
  const lines: string[] = []
  if (hasEarlier) {
    if (sources.summary !== null && sources.summary.trim() !== '') {
      lines.push(`对话摘要：\n${sources.summary.trim()}`)
    } else {
      notes.push('还有更早的对话消息未包含在上下文中。')
    }
  }
  for (const message of window) {
    const speaker = message.role === 'user' ? '用户' : '助手'
    lines.push(`${speaker}：${message.text}`)
  }
  if (lines.length === 0) return null
  let kept = lines
  let dropped = 0
  while (
    kept.length > 0 &&
    estimateTokens(kept.join('\n')) > CONTEXT_BLOCK_TOKEN_BUDGET.history
  ) {
    kept = kept.slice(1)
    dropped += 1
  }
  if (dropped > 0) {
    notes.push(`历史消息因长度限制被裁剪，省略最早的 ${dropped} 条。`)
  }
  return kept.length === 0 ? null : kept.join('\n')
}

function contextKindLabel(kind: MessageContextKind): string {
  switch (kind) {
    case 'entry':
      return '信息条目'
    case 'resume':
      return '简历'
    case 'jobPosting':
      return '岗位描述'
  }
}

function tokensOf(text: string | null): number {
  return text === null ? 0 : estimateTokens(text)
}

function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  )
}
