import { describe, expect, it } from 'vitest'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { freezeResume } from '../../../src/application/resume/FreezeResume'
import type { LiveRevisionChain } from '../../../src/application/resume/UndoDocumentChange'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume } from '../../../src/domain/resume/Resume'
import type { Block, ExperienceContent } from '../../../src/domain/resume/Block'
import type { DocumentChange } from '../../../src/domain/resume/DocumentChange'
import { describeChange } from '../../../src/domain/resume/DocumentChange'
import { addClaim, addVariant, createExperience, rejectClaim } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime, parseIsoDate } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asBlockId,
  asClaimId,
  asExperienceId,
  asResumeId,
  asRevisionId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import type { ClaimId } from '../../../src/domain/shared/branded-id'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('resume-1')
const INITIAL_REVISION_ID = asRevisionId('revision-initial')
const EXPERIENCE_ID = asExperienceId('experience-1')
const VARIANT_ID = asVariantId('variant-1')
const CONFIRMED_CLAIM_ID = asClaimId('claim-confirmed')

function experienceWithConfirmedVariant(): Experience {
  const base = createExperience(
    {
      id: EXPERIENCE_ID,
      kind: 'work',
      title: '后端工程师',
      organization: '某公司',
      startDate: parseIsoDate('2020-01-01'),
      isCurrent: true,
    },
    NOW,
  )
  return addVariant(
    base,
    {
      id: VARIANT_ID,
      label: '架构导向',
      content: '负责服务治理与容量规划。',
      emphasis: null,
      draftedByRunId: null,
      confirmedAt: NOW,
    },
    NOW,
  )
}

function experienceWithConfirmedClaim(): Experience {
  return addClaim(
    experienceWithConfirmedVariant(),
    {
      id: CONFIRMED_CLAIM_ID,
      kind: 'metric',
      statement: '接口可用性 99.99%。',
      sourceField: 'detail.coverage',
      status: 'confirmed',
    },
    NOW,
  )
}

function textBlock(id: string, text: string): Block {
  return {
    id: asBlockId(id),
    content: { type: 'text', text },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

function experienceBlock(id: string, overrides: Partial<ExperienceContent> = {}): Block {
  return {
    id: asBlockId(id),
    content: {
      type: 'experience',
      experienceId: EXPERIENCE_ID,
      variantId: VARIANT_ID,
      refVersion: 1,
      claimIds: [],
      ...overrides,
    },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

function changeAppending(block: Block, label: string): DocumentChange {
  return describeChange({ label, origin: 'user', runId: null }, (state) => ({
    ...state,
    blocks: [...state.blocks, block],
  }))
}

async function seededResume(): Promise<InMemoryResumeRepository> {
  const repo = new InMemoryResumeRepository(() => NOW)
  const resume = createResume(
    {
      id: RESUME_ID,
      title: '简历',
      targetRole: null,
      pageSetup: A4_PAGE_SETUP,
      initialRevisionId: INITIAL_REVISION_ID,
    },
    NOW,
  )
  await repo.insertWithInitialRevision(
    resume,
    initialRevision(RESUME_ID, INITIAL_REVISION_ID, { blocks: [], pageSetup: A4_PAGE_SETUP }, NOW),
  )
  return repo
}

function chainOf(repo: InMemoryResumeRepository): LiveRevisionChain {
  return (resumeId) => repo.historyOf(resumeId)
}

async function seedResumeWithBlock(block: Block): Promise<InMemoryResumeRepository> {
  const resumeRepo = await seededResume()
  await commitDocumentChange(
    resumeRepo,
    new InMemoryExperienceRepository(),
    RESUME_ID,
    changeAppending(block, '添加块'),
  )
  return resumeRepo
}

describe('commitDocumentChange', () => {
  it('appends a revision and advances the cursor', async () => {
    const resumeRepo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()

    const revision = await commitDocumentChange(
      resumeRepo,
      experienceRepo,
      RESUME_ID,
      changeAppending(textBlock('block-1', '三段式后端开发。'), '添加经历描述'),
    )

    expect(revision.seq).toBe(2)
    expect(revision.label).toBe('添加经历描述')
    expect(revision.supersededAt).toBeNull()
    const stored = await resumeRepo.findById(RESUME_ID)
    expect(stored?.blocks.map((block) => block.id)).toEqual([asBlockId('block-1')])
    expect(stored?.currentRevision).toBe(revision.id)
  })

  it('refuses every change once the resume is frozen', async () => {
    const resumeRepo = await seedResumeWithBlock(textBlock('block-1', '三段式后端开发。'))
    const experienceRepo = new InMemoryExperienceRepository()
    await freezeResume(
      resumeRepo,
      experienceRepo,
      chainOf(resumeRepo),
      new SequentialIdGenerator('snapshot'),
      new FixedClock(),
      RESUME_ID,
    )

    await expect(
      commitDocumentChange(
        resumeRepo,
        experienceRepo,
        RESUME_ID,
        changeAppending(textBlock('block-2', '再写一段。'), '再添加块'),
      ),
    ).rejects.toMatchObject({ code: 'frozenResumeImmutable' })
  })

  it('refuses a variant that has not been confirmed', async () => {
    const resumeRepo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    const draft = addVariant(
      createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW),
      {
        id: VARIANT_ID,
        label: 'Agent 草稿',
        content: '负责服务治理。',
        emphasis: null,
        draftedByRunId: null,
        confirmedAt: null,
      },
      NOW,
    )
    experienceRepo.seed(draft)

    await expect(
      commitDocumentChange(
        resumeRepo,
        experienceRepo,
        RESUME_ID,
        changeAppending(experienceBlock('block-1'), '引用未确认表述'),
      ),
    ).rejects.toMatchObject({ code: 'variantUnconfirmed' })
    expect(resumeRepo.historyOf(RESUME_ID)).toHaveLength(1)
  })

  it('refuses a variant that belongs to another experience', async () => {
    const resumeRepo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    experienceRepo.seed(
      addVariant(
        createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW),
        {
          id: asVariantId('variant-of-another-experience'),
          label: '业务价值导向',
          content: '负责服务治理。',
          emphasis: null,
          draftedByRunId: null,
          confirmedAt: NOW,
        },
        NOW,
      ),
    )

    await expect(
      commitDocumentChange(
        resumeRepo,
        experienceRepo,
        RESUME_ID,
        changeAppending(experienceBlock('block-1'), '引用他人表述'),
      ),
    ).rejects.toMatchObject({ code: 'variantNotInExperience' })
    expect(resumeRepo.historyOf(RESUME_ID)).toHaveLength(1)
  })

  it('refuses a block that cites a rejected claim', async () => {
    const resumeRepo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    const rejected = rejectClaim(
      experienceWithConfirmedClaim(),
      CONFIRMED_CLAIM_ID,
      NOW,
    )
    experienceRepo.seed(rejected)

    await expect(
      commitDocumentChange(
        resumeRepo,
        experienceRepo,
        RESUME_ID,
        changeAppending(
          experienceBlock('block-1', { claimIds: [CONFIRMED_CLAIM_ID] }),
          '引用已拒绝断言',
        ),
      ),
    ).rejects.toMatchObject({ code: 'claimRejected' })
    expect(resumeRepo.historyOf(RESUME_ID)).toHaveLength(1)
  })

  it('accepts a confirmed claim and keeps a pending one out of a rejection', async () => {
    const resumeRepo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    experienceRepo.seed(
      addClaim(
        experienceWithConfirmedClaim(),
        {
          id: asClaimId('claim-pending'),
          kind: 'responsibility',
          statement: '负责跨团队协作。',
          sourceField: null,
          status: 'pending',
        },
        NOW,
      ),
    )

    const revision = await commitDocumentChange(
      resumeRepo,
      experienceRepo,
      RESUME_ID,
      changeAppending(
        experienceBlock('block-1', {
          claimIds: [CONFIRMED_CLAIM_ID, asClaimId('claim-pending')] as ClaimId[],
        }),
        '引用断言',
      ),
    )

    expect(revision.seq).toBe(2)
  })

  it('accepts the change that drops a rejected claim reference', async () => {
    const resumeRepo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    const confirmed = experienceWithConfirmedClaim()
    experienceRepo.seed(confirmed)

    // The reference is stored first, while the claim is still confirmed: the
    // revision has to hold it before anything is rejected.
    await commitDocumentChange(
      resumeRepo,
      experienceRepo,
      RESUME_ID,
      changeAppending(experienceBlock('block-1', { claimIds: [CONFIRMED_CLAIM_ID] }), '引用断言'),
    )

    experienceRepo.seed(rejectClaim(confirmed, CONFIRMED_CLAIM_ID, NOW))

    const revision = await commitDocumentChange(
      resumeRepo,
      experienceRepo,
      RESUME_ID,
      describeChange({ label: '移除断言引用', origin: 'user', runId: null }, (state) => ({
        ...state,
        blocks: state.blocks.map((block) =>
          block.id === 'block-1'
            ? { ...block, content: { ...block.content, claimIds: [] } }
            : block,
        ),
      })),
    )

    expect(revision.seq).toBe(3)
    const stored = await resumeRepo.findById(RESUME_ID)
    const content = stored?.blocks[0]?.content
    expect(content).toMatchObject({ type: 'experience', claimIds: [] })
  })

  it('keeps nothing persisted when the change itself throws', async () => {
    const resumeRepo = await seededResume()
    const exploding = describeChange({ label: '爆炸', origin: 'user', runId: null }, () => {
      throw new Error('change failed')
    })

    await expect(
      commitDocumentChange(resumeRepo, new InMemoryExperienceRepository(), RESUME_ID, exploding),
    ).rejects.toThrow('change failed')
    expect(resumeRepo.historyOf(RESUME_ID)).toHaveLength(1)
  })

  it('refuses a document that carries a duplicate block id', async () => {
    const resumeRepo = await seededResume()
    const duplicate = describeChange({ label: '重复块', origin: 'user', runId: null }, (state) => ({
      ...state,
      blocks: [textBlock('block-1', '一次'), textBlock('block-1', '两次')],
    }))

    await expect(
      commitDocumentChange(resumeRepo, new InMemoryExperienceRepository(), RESUME_ID, duplicate),
    ).rejects.toMatchObject({ code: 'duplicateBlockId' })
  })
})
