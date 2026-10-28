/**
 * @file context.test
 * @description The token estimator, the per-block budgets and truncation notes,
 * and the fixed sections of the system prompt.
 */

import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTEXT_TOKEN_BUDGET,
  CONTEXT_BLOCK_TOKEN_BUDGET,
  CONTEXT_HISTORY_MESSAGE_LIMIT,
  assembleAgentContext,
  estimateTokens,
  headTailToTokens,
  truncateToTokens,
} from '../../../src/application/generation/context'
import type { AgentContextSources } from '../../../src/application/generation/context'
import { buildSystemPrompt } from '../../../src/application/generation/systemPrompt'

function sources(overrides: Partial<AgentContextSources> = {}): AgentContextSources {
  return {
    preamble: '你是简历助手。',
    resumeSummary: null,
    libraryOverview: null,
    chips: [],
    jobPosting: null,
    history: [],
    hasEarlierMessages: false,
    summary: null,
    ...overrides,
  }
}

describe('estimateTokens', () => {
  it('counts CJK code points one each and Latin text four to a token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('你好')).toBe(2)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    expect(estimateTokens('你a')).toBe(2)
  })
})

describe('truncateToTokens', () => {
  it('leaves text within budget untouched and marks a cut otherwise', () => {
    expect(truncateToTokens('你好', 10)).toEqual({ text: '你好', truncated: false })
    const cut = truncateToTokens('你'.repeat(20), 10)
    expect(cut.truncated).toBe(true)
    expect(cut.text.endsWith('…')).toBe(true)
    expect(estimateTokens(cut.text)).toBeLessThanOrEqual(10)
  })

  it('keeps a head and a tail for the job description', () => {
    const excerpt = headTailToTokens('开头'.concat('中'.repeat(5000), '结尾'), 20, 20)
    expect(excerpt.truncated).toBe(true)
    expect(excerpt.text.startsWith('开头')).toBe(true)
    expect(excerpt.text.endsWith('结尾')).toBe(true)
    expect(excerpt.text).toContain('（截断）')
  })
})

describe('assembleAgentContext', () => {
  it('keeps every block that fits and reports no notes', () => {
    const result = assembleAgentContext(
      sources({
        resumeSummary: '简历摘要',
        libraryOverview: '信息库概览',
        chips: [{ kind: 'entry', refId: 'entry-1', text: '条目内容' }],
        jobPosting: '岗位描述',
        history: [{ role: 'user', text: '你好' }],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.notes).toEqual([])
    expect(result.value.resumeSummary).toBe('简历摘要')
    expect(result.value.jobPosting).toBe('岗位描述')
    expect(result.value.estimatedTokens).toBeLessThan(AGENT_CONTEXT_TOKEN_BUDGET)
  })

  it('truncates an over-budget block and says so', () => {
    const result = assembleAgentContext(
      sources({ resumeSummary: '摘'.repeat(CONTEXT_BLOCK_TOKEN_BUDGET.resumeSummary + 100) }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.notes).toEqual(['简历摘要因长度限制被截断。'])
    expect(estimateTokens(result.value.resumeSummary ?? '')).toBeLessThanOrEqual(
      CONTEXT_BLOCK_TOKEN_BUDGET.resumeSummary,
    )
  })

  it('drops context chips from the end and lists what was omitted', () => {
    const chips = Array.from({ length: 8 }, (_, index) => ({
      kind: 'entry' as const,
      refId: `entry-${index}`,
      text: '条'.repeat(900),
    }))
    const result = assembleAgentContext(sources({ chips }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.notes.join('')).toContain('以下上下文因长度限制被省略')
    expect(result.value.notes.join('')).toContain('entry-')
  })

  it('replaces messages before the window with the rolling summary', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `消息 ${index}`,
    }))
    const result = assembleAgentContext(
      sources({ history: messages, hasEarlierMessages: true, summary: '此前的摘要' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.history).toContain('对话摘要：')
    expect(result.value.history).toContain('此前的摘要')
    expect(result.value.history).not.toContain('消息 9\n')
    expect(result.value.history).toContain(`消息 ${30 - CONTEXT_HISTORY_MESSAGE_LIMIT}`)
  })

  it('cuts history first when the total budget is exceeded', () => {
    const result = assembleAgentContext(
      sources({
        preamble: '前'.repeat(7000),
        jobPosting: '岗'.repeat(2500),
        history: [{ role: 'user', text: '历'.repeat(3000) }],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.notes.join('')).toContain('历史消息因总长度限制被裁剪')
  })

  it('refuses a prompt that cannot be cut under the budget', () => {
    const result = assembleAgentContext(sources({ preamble: '前'.repeat(13_000) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('contextTooLarge')
    expect(result.error.budget).toBe(AGENT_CONTEXT_TOKEN_BUDGET)
  })
})

describe('buildSystemPrompt', () => {
  it('puts the fixed sections first and the blocks under their headings', () => {
    const result = assembleAgentContext(
      sources({
        resumeSummary: '简历摘要',
        libraryOverview: '信息库概览',
        chips: [{ kind: 'entry', refId: 'entry-1', text: '条目内容' }],
        jobPosting: '岗位描述',
        history: [{ role: 'user', text: '你好' }],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const prompt = buildSystemPrompt(result.value)
    expect(prompt).toContain('始终使用中文回答')
    expect(prompt.indexOf('始终使用中文回答')).toBeLessThan(prompt.indexOf('事实规则'))
    expect(prompt.indexOf('事实规则')).toBeLessThan(prompt.indexOf('操作规则'))
    expect(prompt.indexOf('操作规则')).toBeLessThan(prompt.indexOf('工作流'))
    expect(prompt.indexOf('工作流')).toBeLessThan(prompt.indexOf('## 当前简历'))
    expect(prompt.indexOf('## 当前简历')).toBeLessThan(prompt.indexOf('## 信息库概览'))
    expect(prompt.indexOf('## 信息库概览')).toBeLessThan(prompt.indexOf('## 用户提供的上下文'))
    expect(prompt.indexOf('## 用户提供的上下文')).toBeLessThan(prompt.indexOf('## 岗位描述'))
    expect(prompt.indexOf('## 岗位描述')).toBeLessThan(prompt.indexOf('## 对话历史'))
  })

  it('omits empty blocks and adds the truncation notes when present', () => {
    const result = assembleAgentContext(
      sources({ resumeSummary: '摘'.repeat(1000) }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const prompt = buildSystemPrompt(result.value)
    expect(prompt).not.toContain('## 岗位描述')
    expect(prompt).not.toContain('## 信息库概览')
    expect(prompt).toContain('## 上下文说明')
    expect(prompt).toContain('简历摘要因长度限制被截断')
  })
})
