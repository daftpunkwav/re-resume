/**
 * @file parseJobPosting.test
 * @description The standalone model use case: it reads a posting, extracts the
 * structured requirements, refuses output that does not fit or is not grounded
 * in the text, and records the run either way.
 */

import { describe, expect, it } from 'vitest'

import { parseJobPosting } from '../../../src/application/job/parseJobPosting'
import type { JobPosting } from '../../../src/domain/generation/JobPosting'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asJobPostingId } from '../../../src/domain/shared/branded-id'
import { createConversationBed } from '../../support/conversationBed'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

function aPosting(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: asJobPostingId('posting-1'),
    rawText: '负责前端页面开发。要求熟悉 TypeScript 与浏览器性能优化。',
    source: 'paste',
    imageAttachmentIds: [],
    conversationId: null,
    resumeId: null,
    parsed: null,
    parsedByRunId: null,
    parsedAt: null,
    createdAt: AT,
    ...overrides,
  }
}

function answer(text: string) {
  return { chunks: [{ type: 'text' as const, textDelta: text }] }
}

describe('parseJobPosting', () => {
  it('extracts a grounded parse and records the run', async () => {
    const bed = createConversationBed()
    await bed.jobPostings.insert(aPosting())
    bed.model.enqueue(
      answer(
        '```json\n{"title":"前端工程师","company":null,"responsibilities":["负责前端页面开发"],"requirements":["要求熟悉 TypeScript 与浏览器性能优化"],"keywords":["TypeScript"]}\n```',
      ),
    )

    const outcome = await parseJobPosting(
      { model: bed.model, jobPostings: bed.jobPostings, runs: bed.runs, clock: bed.clock, ids: bed.ids },
      { jobPostingId: asJobPostingId('posting-1') },
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.jobPosting.parsed?.title).toBe('前端工程师')
    expect(outcome.value.jobPosting.parsedByRunId).toBe(outcome.value.run.id)
    expect(outcome.value.run.status).toBe('completed')
    expect(outcome.value.run.jobPostingId).toBe('posting-1')
    expect(outcome.value.run.promptTokens).toBeNull()
    await expect(bed.jobPostings.findById(asJobPostingId('posting-1'))).resolves.toMatchObject({
      parsed: { title: '前端工程师' },
    })
  })

  it('reports an unknown posting without a model call', async () => {
    const bed = createConversationBed()
    const outcome = await parseJobPosting(
      { model: bed.model, jobPostings: bed.jobPostings, runs: bed.runs, clock: bed.clock, ids: bed.ids },
      { jobPostingId: asJobPostingId('missing') },
    )
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'unknownPosting' } })
    expect(bed.model.calls).toBe(0)
  })

  it('refuses a posting without text instead of sending an empty prompt', async () => {
    const bed = createConversationBed()
    await bed.jobPostings.insert(aPosting({ rawText: '' }))
    const outcome = await parseJobPosting(
      { model: bed.model, jobPostings: bed.jobPostings, runs: bed.runs, clock: bed.clock, ids: bed.ids },
      { jobPostingId: asJobPostingId('posting-1') },
    )
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'outputRejected' } })
    expect(bed.model.calls).toBe(0)
  })

  it('records a failed run when the model call fails', async () => {
    const bed = createConversationBed()
    await bed.jobPostings.insert(aPosting())
    bed.model.enqueue({ error: new Error('network down') })
    const outcome = await parseJobPosting(
      { model: bed.model, jobPostings: bed.jobPostings, runs: bed.runs, clock: bed.clock, ids: bed.ids },
      { jobPostingId: asJobPostingId('posting-1') },
    )
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'modelFailed' } })
    const [run] = await bed.runs.listRunning()
    expect(run).toBeUndefined()
    const stored = await bed.jobPostings.findById(asJobPostingId('posting-1'))
    expect(stored?.parsed).toBeNull()
  })

  it('rejects a reply without JSON and a reply that does not fit the schema', async () => {
    const bed = createConversationBed()
    await bed.jobPostings.insert(aPosting())
    bed.model.enqueue(answer('抱歉，我无法解析。'))
    const noJson = await parseJobPosting(
      { model: bed.model, jobPostings: bed.jobPostings, runs: bed.runs, clock: bed.clock, ids: bed.ids },
      { jobPostingId: asJobPostingId('posting-1') },
    )
    expect(noJson).toMatchObject({ ok: false, error: { kind: 'outputRejected' } })

    bed.model.enqueue(answer('{"title":42,"company":null}'))
    const badSchema = await parseJobPosting(
      { model: bed.model, jobPostings: bed.jobPostings, runs: bed.runs, clock: bed.clock, ids: bed.ids },
      { jobPostingId: asJobPostingId('posting-1') },
    )
    expect(badSchema).toMatchObject({ ok: false, error: { kind: 'outputRejected' } })
  })

  it('refuses a requirement the description does not contain', async () => {
    const bed = createConversationBed()
    await bed.jobPostings.insert(aPosting())
    bed.model.enqueue(
      answer(
        '{"title":"前端工程师","company":"某公司","responsibilities":[],"requirements":["要求会 Rust 并发编程"],"keywords":[]}',
      ),
    )
    const outcome = await parseJobPosting(
      { model: bed.model, jobPostings: bed.jobPostings, runs: bed.runs, clock: bed.clock, ids: bed.ids },
      { jobPostingId: asJobPostingId('posting-1') },
    )
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'outputRejected' } })
    if (outcome.ok) return
    expect(outcome.error.detail).toContain('Rust')
  })
})
