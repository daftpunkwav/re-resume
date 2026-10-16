/**
 * @file writeTools
 * @description The write risk level: a tool may only reference rows that
 * already exist, its arguments are closed to body text, and every change it
 * makes is one revision that undo can take back.
 */

import { describe, expect, it } from 'vitest'
import { buildSelectExperienceVariantTool } from '../../../src/application/generation/tools/selectExperienceVariant'
import { buildCreateResumeDraftTool } from '../../../src/application/generation/tools/createResumeDraft'
import { buildAddBlockTool } from '../../../src/application/generation/tools/addBlock'
import { buildMoveBlockTool } from '../../../src/application/generation/tools/moveBlock'
import { buildReorderResumeSectionsTool } from '../../../src/application/generation/tools/reorderResumeSections'
import type { JobPostingRepository } from '../../../src/application/generation/ParseJobPosting'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume, setDocument } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import type { Resume } from '../../../src/domain/resume/Resume'
import { DomainError } from '../../../src/domain/shared/DomainError'
import type { JobPosting } from '../../../src/domain/generation/JobPosting'
import type { AgentRunRepository } from '../../../src/domain/generation/ports/AgentRunRepository'
import { addClaim, addVariant, createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { PROFILE_SEED_ID } from '../../../src/domain/catalog/Profile'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import type { ResumeId } from '../../../src/domain/shared/branded-id'
import {
  asAgentRunId,
  asBlockId,
  asClaimId,
  asExperienceId,
  asJobPostingId,
  asProfileId,
  asResumeId,
  asRevisionId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import {
  InMemoryExperienceRepository,
  InMemoryProfileRepository,
} from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const SOURCE_RESUME_ID = asResumeId('resume-source')
const INITIAL_REVISION_ID = asRevisionId('revision-initial')
const RUN_ID = asAgentRunId('run-1')

class InMemoryJobPostings implements JobPostingRepository {
  constructor(private readonly posting: JobPosting) {}

  async findById(id: JobPosting['id']): Promise<JobPosting | null> {
    return id === this.posting.id ? this.posting : null
  }

  async listAll(): Promise<readonly JobPosting[]> {
    return [this.posting]
  }

  async save(jobPosting: JobPosting): Promise<void> {
    throw new Error(`The write tools must not save a job posting; got "${jobPosting.id}".`)
  }
}

const POSTING: JobPosting = {
  id: asJobPostingId('posting-1'),
  rawText: '负责支付网关的演进。',
  source: null,
  parsed: {
    title: '支付平台工程师',
    company: 'ACME',
    responsibilities: ['负责支付网关的演进'],
    requirements: ['熟悉 Java'],
    keywords: ['支付'],
  },
  parsedByRunId: RUN_ID,
  parsedAt: NOW,
  createdAt: NOW,
}

/** Two confirmed wordings, one rejected assertion and one unconfirmed draft. */
function catalogExperience(): Experience {
  const created = createExperience(
    { id: asExperienceId('exp-1'), kind: 'work', title: '支付平台工程师', organization: 'ACME' },
    NOW,
  )
  const withFirst = addVariant(
    created,
    { id: asVariantId('var-1'), label: '架构', content: '重构支付网关。', emphasis: null, draftedByRunId: null, confirmedAt: NOW },
    NOW,
  )
  const withSecond = addVariant(
    withFirst,
    { id: asVariantId('var-2'), label: '业务', content: '提升支付成功率。', emphasis: null, draftedByRunId: null, confirmedAt: NOW },
    NOW,
  )
  const withDraft = addVariant(
    withSecond,
    { id: asVariantId('var-draft'), label: '草稿', content: '未确认的表述。', emphasis: null, draftedByRunId: RUN_ID, confirmedAt: null },
    NOW,
  )
  const withConfirmed = addClaim(
    withDraft,
    { id: asClaimId('clm-ok'), kind: 'responsibility', statement: '重构支付网关', sourceField: null, status: 'confirmed' },
    NOW,
  )
  return addClaim(
    withConfirmed,
    { id: asClaimId('clm-bad'), kind: 'metric', statement: '日均千万笔', sourceField: null, status: 'rejected' },
    NOW,
  )
}

function experienceBlock(variantId: string): Block {
  return {
    id: asBlockId('block-exp'),
    content: {
      type: 'experience',
      experienceId: asExperienceId('exp-1'),
      variantId: asVariantId(variantId),
      refVersion: 1,
      claimIds: [asClaimId('clm-ok')],
    },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

function textBlock(id: string, text: string): Block {
  return { id: asBlockId(id), content: { type: 'text', text }, layout: DEFAULT_FLOW_LAYOUT, textStyle: null }
}

interface Fixture {
  readonly ctx: Parameters<ReturnType<typeof buildAddBlockTool>['execute']>[1]
  readonly resumes: InMemoryResumeRepository
  readonly experiences: InMemoryExperienceRepository
  readonly ids: SequentialIdGenerator
  readonly source: Resume
}

async function newFixture(blocks: readonly Block[]): Promise<Fixture> {
  const clock = new FixedClock(NOW)
  const experiences = new InMemoryExperienceRepository()
  experiences.seed(catalogExperience())
  const resumes = new InMemoryResumeRepository(() => clock.now())
  const state = { blocks, pageSetup: A4_PAGE_SETUP }
  await resumes.insertWithInitialRevision(
    setDocument(
      createResume(
        {
          id: SOURCE_RESUME_ID,
          title: '旧简历',
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
    initialRevision(SOURCE_RESUME_ID, INITIAL_REVISION_ID, state, NOW),
  )
  const runs: AgentRunRepository = {
    create: async () => {},
    save: async () => {},
    findById: async () => null,
  }
  const source = await resumes.findById(SOURCE_RESUME_ID)
  if (source === null) throw new Error('the seeded resume should exist')
  return {
    resumes,
    experiences,
    ids: new SequentialIdGenerator('block'),
    source,
    ctx: {
      resumes,
      experiences,
      profiles: profileRepository(),
      runs,
      clock,
      layout: () => {
        throw new Error('A write tool must not lay out a document.')
      },
    },
  }
}

function profileRepository(displayName = '李四'): InMemoryProfileRepository {
  return new InMemoryProfileRepository({
    id: asProfileId(PROFILE_SEED_ID),
    displayName,
    email: 'li@example.com',
    phone: null,
    links: [],
    version: 3,
    updatedAt: NOW,
  })
}

function draftTool(fixture: Fixture) {
  return buildCreateResumeDraftTool({
    jobPostings: new InMemoryJobPostings(POSTING),
    ids: fixture.ids,
    resumeCreation: fixture.resumes,
    runId: RUN_ID,
  })
}

async function loadResume(resumes: InMemoryResumeRepository, resumeId: ResumeId): Promise<Resume> {
  const resume = await resumes.findById(resumeId)
  if (resume === null) throw new Error(`no resume ${resumeId}`)
  return resume
}

describe('write tools', () => {
  it('refuses body text in a write tool argument', () => {
    const select = buildSelectExperienceVariantTool({ runId: RUN_ID })
    const add = buildAddBlockTool({ ids: new SequentialIdGenerator(), runId: RUN_ID })

    expect(
      select.parse({
        resumeId: SOURCE_RESUME_ID,
        blockId: 'block-exp',
        variantId: 'var-2',
        content: '我把这段话重写了',
      }).ok,
    ).toBe(false)
    expect(
      add.parse({
        resumeId: SOURCE_RESUME_ID,
        experienceId: 'exp-1',
        variantId: 'var-1',
        claimIds: [],
        text: '凭空多出来的正文',
      }).ok,
    ).toBe(false)
  })

  it('switches a block to another confirmed variant and records one revision', async () => {
    const fixture = await newFixture([experienceBlock('var-1')])
    const tool = buildSelectExperienceVariantTool({ runId: RUN_ID })

    const result = await tool.execute(
      { resumeId: SOURCE_RESUME_ID, blockId: 'block-exp', variantId: 'var-2' },
      fixture.ctx,
    )

    expect(result.kind).toBe('updated')
    const resume = await loadResume(fixture.resumes, SOURCE_RESUME_ID)
    const content = resume.blocks[0]?.content
    expect(content?.type).toBe('experience')
    if (content?.type !== 'experience') return
    expect(content.variantId).toBe('var-2')
    const history = fixture.resumes.historyOf(SOURCE_RESUME_ID)
    expect(history.at(-1)?.origin).toBe('agent')
    expect(history.at(-1)?.runId).toBe(RUN_ID)
  })

  it('refuses to select an unconfirmed variant', async () => {
    const fixture = await newFixture([experienceBlock('var-1')])
    const tool = buildSelectExperienceVariantTool({ runId: RUN_ID })

    await expect(
      tool.execute(
        { resumeId: SOURCE_RESUME_ID, blockId: 'block-exp', variantId: 'var-draft' },
        fixture.ctx,
      ),
    ).rejects.toThrow(DomainError)
    expect(fixture.resumes.historyOf(SOURCE_RESUME_ID)).toHaveLength(1)
  })

  it('reports a block that is not in the resume instead of committing nothing silently', async () => {
    const fixture = await newFixture([textBlock('block-1', '正文')])
    const tool = buildMoveBlockTool({ runId: RUN_ID })

    expect(await tool.execute({ resumeId: SOURCE_RESUME_ID, blockId: 'nope', index: 0 }, fixture.ctx)).toEqual({
      kind: 'blockNotFound',
      blockId: 'nope',
    })
  })

  it('moves a block to the requested position', async () => {
    const fixture = await newFixture([textBlock('a', '一'), textBlock('b', '二'), textBlock('c', '三')])
    const tool = buildMoveBlockTool({ runId: RUN_ID })

    const result = await tool.execute(
      { resumeId: SOURCE_RESUME_ID, blockId: 'c', index: 0 },
      fixture.ctx,
    )

    expect(result.kind).toBe('moved')
    const resume = await loadResume(fixture.resumes, SOURCE_RESUME_ID)
    expect(resume.blocks.map((block) => block.id)).toEqual(['c', 'a', 'b'])
  })

  it('refuses a reorder that does not list every block', async () => {
    const fixture = await newFixture([textBlock('a', '一'), textBlock('b', '二')])
    const tool = buildReorderResumeSectionsTool({ runId: RUN_ID })

    expect(await tool.execute({ resumeId: SOURCE_RESUME_ID, order: ['b'] }, fixture.ctx)).toMatchObject({
      kind: 'notAPermutation',
      missingBlockIds: ['a'],
    })
    expect(fixture.resumes.historyOf(SOURCE_RESUME_ID)).toHaveLength(1)
  })

  it('reorders every block of the resume', async () => {
    const fixture = await newFixture([textBlock('a', '一'), textBlock('b', '二'), textBlock('c', '三')])
    const tool = buildReorderResumeSectionsTool({ runId: RUN_ID })

    const result = await tool.execute(
      { resumeId: SOURCE_RESUME_ID, order: ['c', 'a', 'b'] },
      fixture.ctx,
    )

    expect(result.kind).toBe('reordered')
    const resume = await loadResume(fixture.resumes, SOURCE_RESUME_ID)
    expect(resume.blocks.map((block) => block.id)).toEqual(['c', 'a', 'b'])
  })

  it('appends an experience block that references existing rows', async () => {
    const fixture = await newFixture([textBlock('a', '一')])
    const tool = buildAddBlockTool({ ids: fixture.ids, runId: RUN_ID })

    const result = await tool.execute(
      {
        resumeId: SOURCE_RESUME_ID,
        experienceId: 'exp-1',
        variantId: 'var-1',
        claimIds: ['clm-ok'],
      },
      fixture.ctx,
    )

    expect(result.kind).toBe('added')
    const resume = await loadResume(fixture.resumes, SOURCE_RESUME_ID)
    const added = resume.blocks[1]
    expect(added?.content.type).toBe('experience')
    if (added?.content.type !== 'experience') return
    expect(added.content.refVersion).toBe(4)
    expect(added.content.claimIds).toEqual(['clm-ok'])
  })

  it('refuses a block that rests on a rejected claim', async () => {
    const fixture = await newFixture([textBlock('a', '一')])
    const tool = buildAddBlockTool({ ids: fixture.ids, runId: RUN_ID })

    await expect(
      tool.execute(
        {
          resumeId: SOURCE_RESUME_ID,
          experienceId: 'exp-1',
          variantId: 'var-1',
          claimIds: ['clm-bad'],
        },
        fixture.ctx,
      ),
    ).rejects.toThrow(DomainError)
    expect(fixture.resumes.historyOf(SOURCE_RESUME_ID)).toHaveLength(1)
  })

  it('refuses a block that names a claim which does not exist', async () => {
    const fixture = await newFixture([textBlock('a', '一')])
    const tool = buildAddBlockTool({ ids: fixture.ids, runId: RUN_ID })

    await expect(
      tool.execute(
        {
          resumeId: SOURCE_RESUME_ID,
          experienceId: 'exp-1',
          variantId: 'var-1',
          claimIds: ['clm-missing'],
        },
        fixture.ctx,
      ),
    ).rejects.toThrow(DomainError)
  })

  it('prepends a profile block even when no block is selected', async () => {
    const fixture = await newFixture([textBlock('a', '一')])
    const tool = draftTool(fixture)

    const result = await tool.execute(
      { jobPostingId: POSTING.id, sourceResumeId: SOURCE_RESUME_ID, blockIds: [] },
      fixture.ctx,
    )

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return
    const draft = await loadResume(fixture.resumes, asResumeId(result.resumeId))
    expect(draft.title).toBe('支付平台工程师')
    expect(draft.blocks).toHaveLength(1)
    expect(draft.blocks[0]?.content.type).toBe('profile')
    if (draft.blocks[0]?.content.type !== 'profile') return
    expect(draft.blocks[0].content.displayName).toBe('李四')
    expect(draft.blocks[0].content.refVersion).toBe(3)
  })

  it('replaces the source profile copy instead of carrying it over', async () => {
    const staleProfileBlock: Block = {
      id: asBlockId('block-profile'),
      content: {
        type: 'profile',
        displayName: '旧名字',
        email: null,
        phone: null,
        links: [],
        refVersion: 1,
      },
      layout: DEFAULT_FLOW_LAYOUT,
      textStyle: null,
    }
    const fixture = await newFixture([staleProfileBlock, textBlock('a', '一')])
    const tool = draftTool(fixture)

    const result = await tool.execute(
      { jobPostingId: POSTING.id, sourceResumeId: SOURCE_RESUME_ID, blockIds: ['block-profile', 'a'] },
      fixture.ctx,
    )

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return
    const draft = await loadResume(fixture.resumes, asResumeId(result.resumeId))
    const profileBlocks = draft.blocks.filter((block) => block.content.type === 'profile')
    expect(profileBlocks).toHaveLength(1)
    if (profileBlocks[0]?.content.type !== 'profile') return
    expect(profileBlocks[0].content.displayName).toBe('李四')
    expect(draft.blocks[0]?.id).toBe(profileBlocks[0].id)
    expect(draft.blocks.map((block) => block.id)).not.toContain('a')
  })

  it('copies the selected blocks under fresh ids', async () => {
    const fixture = await newFixture([experienceBlock('var-1'), textBlock('a', '一')])
    const tool = draftTool(fixture)

    const result = await tool.execute(
      { jobPostingId: POSTING.id, sourceResumeId: SOURCE_RESUME_ID, blockIds: ['block-exp', 'a'] },
      fixture.ctx,
    )

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return
    const draft = await loadResume(fixture.resumes, asResumeId(result.resumeId))
    expect(draft.blocks).toHaveLength(3)
    expect(draft.blocks.map((block) => block.id)).not.toContain('block-exp')
    expect(draft.blocks[0]?.content.type).toBe('profile')
    expect(draft.blocks[1]?.id).not.toBe('block-exp')
  })

  it('reports a selected block the source resume does not have', async () => {
    const fixture = await newFixture([textBlock('a', '一')])
    const tool = draftTool(fixture)

    expect(
      await tool.execute(
        { jobPostingId: POSTING.id, sourceResumeId: SOURCE_RESUME_ID, blockIds: ['nope'] },
        fixture.ctx,
      ),
    ).toEqual({ kind: 'unknownBlock', unknownBlockIds: ['nope'] })
  })

  it('leaves no draft behind when a selected block cannot be referenced', async () => {
    const refused: Block = {
      ...experienceBlock('var-1'),
      content: {
        type: 'experience',
        experienceId: asExperienceId('exp-1'),
        variantId: asVariantId('var-1'),
        refVersion: 1,
        claimIds: [asClaimId('clm-bad')],
      },
    }
    const fixture = await newFixture([refused])
    const tool = draftTool(fixture)

    await expect(
      tool.execute(
        { jobPostingId: POSTING.id, sourceResumeId: SOURCE_RESUME_ID, blockIds: ['block-exp'] },
        fixture.ctx,
      ),
    ).rejects.toThrow(DomainError)

    // The draft is written with its blocks in one insert, so a block the library
    // cannot back stops the whole call rather than leaving an empty resume that
    // no run points at.
    expect(await fixture.resumes.listAll()).toHaveLength(1)
  })
})
