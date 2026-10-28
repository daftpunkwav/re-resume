/**
 * @file systemPrompt
 * @description The fixed system prompt of the assistant, plus the context
 * blocks assembled for the current turn.
 *
 * Responsibilities:
 * - State the identity and language rules, the factual rules, the operation
 *   rules and the working order, in that order
 * - Append the context blocks under their fixed headings
 * - State every truncation the context assembler recorded
 *
 * Constraints:
 * - The fixed text never mentions tool names the model cannot call; the tool
 *   schemas are supplied by the provider request instead.
 * - Block order is contractual: the chat and evaluation tooling both read it.
 */

import type { AgentContext } from './context'

const IDENTITY_SECTION = [
  '你是 ReResume 的简历助手，帮助用户维护简历信息库并组装简历。',
  '始终使用中文回答。不要向用户解释工具调用机制，也不要把工具返回的 JSON 直接展示给用户。',
].join('\n')

const FACTUAL_SECTION = [
  '事实规则：',
  '- 只使用信息库中的内容和用户本次提供的内容。不得编造公司、数字、奖项、技能或时间。',
  '- 信息缺失时先追问，或留空并在回答中说明缺少什么。',
  '- 改写用户的经历时必须说明依据，并保持事实不变。',
].join('\n')

const OPERATION_SECTION = [
  '操作规则：',
  '- 只有工具可以修改数据。没有调用工具时，不得声称已经创建、更新或删除了任何内容。',
  '- 工具失败时如实说明原因，不要假装成功。',
  '- 你没有删除信息、简历或会话的能力；用户要删除时，请引导他到界面中操作。',
].join('\n')

const WORKFLOW_SECTION = [
  '工作流：',
  '1. 收到岗位描述时，先理解岗位要求，必要时调用岗位分析工具。',
  '2. 按需检索信息库，挑选相关经历，并说明选择依据。',
  '3. 创建或更新简历：选择条目、调整章节与顺序、设置模板与外观。',
  '4. 写完后检查排版溢出，再向用户汇报。',
  '5. 每次写操作后，用一句话说明改了什么。',
].join('\n')

/** Headings the context blocks use; the interface does not depend on them. */
export const CONTEXT_BLOCK_HEADINGS = {
  resumeSummary: '## 当前简历',
  libraryOverview: '## 信息库概览',
  userContext: '## 用户提供的上下文',
  jobPosting: '## 岗位描述',
  history: '## 对话历史',
  notes: '## 上下文说明',
} as const

/** The four fixed sections, without any context block. */
export function buildFixedSystemPromptSections(): string {
  return [IDENTITY_SECTION, FACTUAL_SECTION, OPERATION_SECTION, WORKFLOW_SECTION].join('\n\n')
}

export function buildSystemPrompt(context: AgentContext): string {
  const sections = [buildFixedSystemPromptSections()]
  appendBlock(sections, CONTEXT_BLOCK_HEADINGS.resumeSummary, context.resumeSummary)
  appendBlock(sections, CONTEXT_BLOCK_HEADINGS.libraryOverview, context.libraryOverview)
  appendBlock(sections, CONTEXT_BLOCK_HEADINGS.userContext, context.userContext)
  appendBlock(sections, CONTEXT_BLOCK_HEADINGS.jobPosting, context.jobPosting)
  appendBlock(sections, CONTEXT_BLOCK_HEADINGS.history, context.history)
  if (context.notes.length > 0) {
    sections.push(
      `${CONTEXT_BLOCK_HEADINGS.notes}\n${context.notes.map((note) => `- ${note}`).join('\n')}`,
    )
  }
  return sections.join('\n\n')
}

function appendBlock(sections: string[], heading: string, body: string | null): void {
  if (body === null || body.trim() === '') return
  sections.push(`${heading}\n${body.trim()}`)
}
