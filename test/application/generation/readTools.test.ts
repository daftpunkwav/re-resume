/**
 * @file readTools
 * @description The read risk level: every tool answers from stored state,
 * writes nothing, and says so in its outcome when what it was asked for is not
 * there.
 */

import { describe, expect, it } from 'vitest'
import { searchExperiences } from '../../../src/application/generation/tools/searchExperiences'
import { getExperienceDetails } from '../../../src/application/generation/tools/getExperienceDetails'
import { buildAnalyzeJobDescriptionTool } from '../../../src/application/generation/tools/analyzeJobDescription'
import { buildMatchExperiencesTool } from '../../../src/application/generation/tools/matchExperiences'
import { buildCheckResumeLayoutTool } from '../../../src/application/generation/tools/checkResumeLayout'
import { compareResumeVersions } from '../../../src/application/generation/tools/compareResumeVersions'
import type { JobPostingRepository } from '../../../src/application/generation/ParseJobPosting'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { materializeBlocks } from '../../../src/application/resume/materializeBlocks'
import { loadResumeExperiences } from '../../../src/application/resume/loadResumeExperiences'
import { describeChange } from '../../../src/domain/resume/DocumentChange'
import { layout } from '../../../src/application/layout/layout'
import { FixtureTextMeasurer } from '../../../src/infrastructure/measurement/FixtureTextMeasurer'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume, setDocument } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import type { JobPosting } from '../../../src/domain/generation/JobPosting'
import { addClaim, addVariant, createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asAgentRunId,
  asBlockId,
  asClaimId,
  asExperienceId,
  asJobPostingId,
  asResumeId,
  asRevisionId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import type { ToolContext } from '../../../src/domain/generation/ports/ToolRegistry'
import type { AgentRunRepository } from '../../../src/domain/generation/ports/AgentRunRepository'
import { FixedClock } from '../../support/fakeEnvironment'
import {
  InMemoryExperienceRepository,
  InMemoryProfileRepository,
} from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('resume-1')
const INITIAL_REVISION_ID = asRevisionId('revision-initial')

class InMemoryJobPostings implements JobPostingRepository {
  private readonly rows = new Map<JobPosting['id'], JobPosting>()

  constructor(postings: readonly JobPosting[] = []) {
    for (const posting of postings) this.rows.set(posting.id, posting)
  }

  async findById(id: JobPosting['id']): Promise<JobPosting | null> {
    return this.rows.get(id) ?? null
  }

  async listAll(): Promise<readonly JobPosting[]> {
    return [...this.rows.values()]
  }

  async save(jobPosting: JobPosting): Promise<void> {
    this.rows.set(jobPosting.id, jobPosting)
  }
}

/** One payment role with a confirmed wording and a rejected assertion. */
function paymentExperience(): Experience {
  const created = createExperience(
    {
      id: asExperienceId('exp-payment'),
      kind: 'work',
      title: '支付平台工程师',
      organization: 'ACME 支付',
      detail: { company: 'ACME 支付', role: '工程师', technologies: ['Java', 'PostgreSQL'], highlights: [] },
    },
    NOW,
  )
  const withVariant = addVariant(
    created,
    {
      id: asVariantId('var-payment'),
      label: '架构导向',
      content: '重构支付网关，把结算延迟从 800ms 降到 120ms。',
      emphasis: null,
      draftedByRunId: null,
      confirmedAt: NOW,
    },
    NOW,
  )
  const withConfirmed = addClaim(
    withVariant,
    {
      id: asClaimId('clm-latency'),
      kind: 'metric',
      statement: '结算延迟从 800ms 降到 120ms',
      sourceField: 'detail.highlights',
      status: 'confirmed',
    },
    NOW,
  )
  return addClaim(
    withConfirmed,
    { id: asClaimId('clm-wrong'), kind: 'metric', statement: '日均千万笔', sourceField: null, status: 'rejected' },
    NOW,
  )
}

function unparsedPosting(): JobPosting {
  return {
    id: asJobPostingId('posting-1'),
    rawText: '负责支付网关的演进。',
    source: '招聘网站',
    parsed: null,
    parsedByRunId: null,
    parsedAt: null,
    createdAt: NOW,
  }
}

function parsedPosting(): JobPosting {
  return {
    ...unparsedPosting(),
    parsed: {
      title: '后端工程师',
      company: 'ACME',
      responsibilities: ['负责支付网关的演进'],
      requirements: ['熟悉 Java 与 PostgreSQL'],
      keywords: ['支付', 'Java'],
    },
    parsedByRunId: asAgentRunId('run-parse'),
    parsedAt: NOW,
  }
}

function textBlock(id: string, text: string): Block {
  return { id: asBlockId(id), content: { type: 'text', text }, layout: DEFAULT_FLOW_LAYOUT, textStyle: null }
}

async function resumeContext(blocks: readonly Block[]): Promise<{
  readonly ctx: ToolContext
  readonly resumes: InMemoryResumeRepository
  readonly experiences: InMemoryExperienceRepository
}> {
  const clock = new FixedClock(NOW)
  const experiences = new InMemoryExperienceRepository()
  experiences.seed(paymentExperience())
  const resumes = new InMemoryResumeRepository(() => clock.now())
  const state = { blocks, pageSetup: A4_PAGE_SETUP }
  await resumes.insertWithInitialRevision(
    setDocument(
      createResume(
        {
          id: RESUME_ID,
          title: '简历',
          targetRole: null,
          pageSetup: A4_PAGE_SETUP,
          initialRevisionId: INITIAL_REVISION_ID,
        },
        NOW,
      ),
      state,
      INITIAL_REVISION_ID,
      NOW,
    ),
    initialRevision(RESUME_ID, INITIAL_REVISION_ID, state, NOW),
  )
  const runs: AgentRunRepository = {
    create: async () => {},
    save: async () => {},
    findById: async () => null,
  }
  const measurer = new FixtureTextMeasurer()
  return {
    resumes,
    experiences,
    ctx: {
      resumes,
      experiences,
      profiles: InMemoryProfileRepository.seeded(NOW),
      runs,
      clock,
      layout: (input) => layout({ ...input, measurer }),
    },
  }
}

describe('read tools', () => {
  it('searches the catalog by keyword and explains each hit', async () => {
    const { ctx } = await resumeContext([])
    const parsed = searchExperiences.parse({ keyword: '支付' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const hits = await searchExperiences.execute(parsed.value, ctx)

    expect(hits).toHaveLength(1)
    expect(hits[0]?.experienceId).toBe('exp-payment')
    expect(hits[0]?.matchedOn).toContain('title')
  })

  it('reports a missing experience instead of throwing', async () => {
    const { ctx } = await resumeContext([])
    const parsed = getExperienceDetails.parse({ experienceId: 'exp-nope' })
    if (!parsed.ok) throw new Error('the argument should parse')

    expect(await getExperienceDetails.execute(parsed.value, ctx)).toEqual({
      kind: 'notFound',
      experienceId: 'exp-nope',
    })
  })

  it('carries the confirmation state of each variant to the model', async () => {
    const { ctx } = await resumeContext([])
    const result = await getExperienceDetails.execute({ experienceId: 'exp-payment' }, ctx)

    expect(result.kind).toBe('found')
    if (result.kind !== 'found') return
    expect(result.experience.variants[0]?.confirmed).toBe(true)
    expect(result.experience.claims.map((claim) => claim.status)).toEqual(['confirmed', 'rejected'])
  })

  it('returns an explicit not-parsed result for an unparsed posting', async () => {
    const postings = new InMemoryJobPostings([unparsedPosting()])
    const tool = buildAnalyzeJobDescriptionTool(postings)
    const { ctx } = await resumeContext([])

    const result = await tool.execute({ jobPostingId: 'posting-1' }, ctx)

    expect(result.kind).toBe('notParsed')
    if (result.kind !== 'notParsed') return
    expect(result.reason).toContain('has not been parsed')
  })

  it('reports the parse and its provenance for a parsed posting', async () => {
    const postings = new InMemoryJobPostings([parsedPosting()])
    const tool = buildAnalyzeJobDescriptionTool(postings)
    const { ctx } = await resumeContext([])

    const result = await tool.execute({ jobPostingId: 'posting-1' }, ctx)

    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.parsed.title).toBe('后端工程师')
    expect(result.parsedByRunId).toBe('run-parse')
  })

  it('refuses to match against a posting that was never parsed', async () => {
    const tool = buildMatchExperiencesTool(new InMemoryJobPostings([unparsedPosting()]))
    const { ctx } = await resumeContext([])

    expect(await tool.execute({ jobPostingId: 'posting-1' }, ctx)).toMatchObject({
      kind: 'noParsedRequirements',
    })
  })

  it('ranks catalog rows against the parsed requirements', async () => {
    const tool = buildMatchExperiencesTool(new InMemoryJobPostings([parsedPosting()]))
    const { ctx } = await resumeContext([])

    const result = await tool.execute({ jobPostingId: 'posting-1', limit: 3 }, ctx)

    expect(result.kind).toBe('matched')
    if (result.kind !== 'matched') return
    expect(result.matches[0]?.experienceId).toBe('exp-payment')
    expect(result.matches[0]?.matchedTerms).toContain('支付')
  })

  it('reports the page count a draft lays out to', async () => {
    const lines = Array.from({ length: 30 }, (_unused, index) => `第 ${index} 行`).join('\n')
    const { ctx } = await resumeContext([textBlock('block-1', lines), textBlock('block-2', lines)])
    const tool = buildCheckResumeLayoutTool(new FixtureTextMeasurer())

    const report = await tool.execute({ resumeId: RESUME_ID }, ctx)

    expect(report.kind).toBe('checked')
    if (report.kind !== 'checked') return
    expect(report.pageCount).toBe(2)
    expect(report.blockCount).toBe(2)
    expect(report.overflows).toEqual([])
  })

  it('reports a block that cannot fit on one page as an overflow', async () => {
    const tallLines = Array.from({ length: 200 }, (_unused, index) => `第 ${index} 行`).join('\n')
    const { ctx } = await resumeContext([textBlock('block-1', tallLines)])
    const tool = buildCheckResumeLayoutTool(new FixtureTextMeasurer())

    const report = await tool.execute({ resumeId: RESUME_ID }, ctx)

    expect(report.kind).toBe('checked')
    if (report.kind !== 'checked') return
    expect(report.overflows).toEqual([{ blockId: 'block-1', reason: 'block-taller-than-page' }])
  })

  it('materializes before laying out, so an experience block carries text', async () => {
    const { ctx, experiences, resumes } = await resumeContext([
      {
        id: asBlockId('block-exp'),
        content: {
          type: 'experience',
          experienceId: asExperienceId('exp-payment'),
          variantId: asVariantId('var-payment'),
          refVersion: 1,
          claimIds: [asClaimId('clm-latency')],
        },
        layout: DEFAULT_FLOW_LAYOUT,
        textStyle: null,
      },
    ])
    const resume = await resumes.findById(RESUME_ID)
    if (resume === null) throw new Error('the seeded resume should exist')

    const loaded = await loadResumeExperiences(experiences, resume.id, resume.blocks)
    const blocks = materializeBlocks(loaded, resume.blocks)
    const laidOut = ctx.layout({ blocks, page: A4_PAGE_SETUP, measurer: new FixtureTextMeasurer() })

    expect(blocks[0]?.content.type).toBe('experience')
    expect(laidOut.blocks[0]?.lines.map((line) => line.text)).toContain('120ms。')
  })

  it('diffs two revisions of one resume by identifier', async () => {
    const { ctx, resumes, experiences } = await resumeContext([textBlock('block-1', '第一段')])
    await commitDocumentChange(
      resumes,
      experiences,
      RESUME_ID,
      describeChange({ label: '追加', origin: 'user', runId: null }, () => ({
        blocks: [textBlock('block-1', '第一段'), textBlock('block-2', '第二段')],
        pageSetup: A4_PAGE_SETUP,
      })),
    )
    const history = resumes.historyOf(RESUME_ID)
    const from = history[0]
    const to = history[history.length - 1]
    if (from === undefined || to === undefined) throw new Error('the history should have two revisions')

    const result = await compareResumeVersions.execute(
      { resumeId: RESUME_ID, from: from.id, to: to.id },
      ctx,
    )

    expect(result.kind).toBe('compared')
    if (result.kind !== 'compared') return
    expect(result.diff.changes).toContainEqual(
      expect.objectContaining({ kind: 'added', blockId: 'block-2' }),
    )
  })
})
