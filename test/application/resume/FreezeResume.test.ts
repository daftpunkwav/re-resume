import { describe, expect, it } from 'vitest'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { freezeResume } from '../../../src/application/resume/FreezeResume'
import { undoDocumentChange } from '../../../src/application/resume/UndoDocumentChange'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import { describeChange } from '../../../src/domain/resume/DocumentChange'
import { addClaim, addVariant, createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import type { ClaimStatus } from '../../../src/domain/catalog/ClaimStatus'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
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
import { DriftingExperienceRepository } from '../../support/driftingExperienceRepository'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('resume-1')
const INITIAL_REVISION_ID = asRevisionId('revision-initial')
const EXPERIENCE_ID = asExperienceId('experience-1')
const VARIANT_ID = asVariantId('variant-1')
const CONFIRMED_CLAIM_ID = asClaimId('claim-confirmed')

function experience(claimStatus: ClaimStatus): Experience {
  const withVariant = addVariant(
    createExperience(
      { id: EXPERIENCE_ID, kind: 'work', title: '后端工程师', organization: '某公司' },
      NOW,
    ),
    {
      id: VARIANT_ID,
      label: '架构导向',
      content: '负责服务治理。',
      emphasis: null,
      draftedByRunId: null,
      confirmedAt: NOW,
    },
    NOW,
  )
  return addClaim(
    withVariant,
    {
      id: CONFIRMED_CLAIM_ID,
      kind: 'metric',
      statement: '接口可用性 99.99%。',
      sourceField: 'detail.coverage',
      status: claimStatus,
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

function experienceBlock(claimIds: readonly ClaimId[]): Block {
  return {
    id: asBlockId('block-1'),
    content: {
      type: 'experience',
      experienceId: EXPERIENCE_ID,
      variantId: VARIANT_ID,
      refVersion: 1,
      claimIds,
    },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

async function seededResume(): Promise<InMemoryResumeRepository> {
  const repo = new InMemoryResumeRepository(() => NOW)
  await repo.insertWithInitialRevision(
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
    initialRevision(
      RESUME_ID,
      INITIAL_REVISION_ID,
      { blocks: [], pageSetup: A4_PAGE_SETUP },
      NOW,
    ),
  )
  return repo
}

describe('freezeResume', () => {
  it('appends a materialized snapshot and freezes the resume', async () => {
    const repo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    experienceRepo.seed(experience('confirmed'))
    await commitDocumentChange(
      repo,
      experienceRepo,
      RESUME_ID,
      describeChange({ label: '添加经历', origin: 'user', runId: null }, (state) => ({
        ...state,
        blocks: [textBlock('block-0', '三段式后端开发。'), experienceBlock([CONFIRMED_CLAIM_ID])],
      })),
    )

    const snapshot = await freezeResume(
      repo,
      experienceRepo,
      new SequentialIdGenerator('snapshot'),
      new FixedClock(),
      RESUME_ID,
    )

    expect(snapshot.seq).toBe(1)
    expect(snapshot.pageSetup).toEqual(A4_PAGE_SETUP)
    expect(snapshot.materializedBlocks).toHaveLength(2)
    expect(snapshot.materializedBlocks[1]?.content).toMatchObject({
      type: 'experience',
      title: '后端工程师',
      variantContent: '负责服务治理。',
    })
    expect(snapshot.materializedBlocks[1]?.claims).toHaveLength(1)

    const stored = await repo.findById(RESUME_ID)
    expect(stored?.status).toBe('frozen')
    expect(stored?.snapshots).toHaveLength(1)
    // Freezing does not rewrite the live document.
    expect(stored?.blocks.map((block) => block.id)).toEqual([
      asBlockId('block-0'),
      asBlockId('block-1'),
    ])
  })

  it('reads the cited experiences once, so a claim rejected afterwards is not dropped', async () => {
    const repo = await seededResume()
    const experienceRepo = new DriftingExperienceRepository(
      experience('confirmed'),
      experience('rejected'),
    )
    await commitDocumentChange(
      repo,
      experienceRepo,
      RESUME_ID,
      describeChange({ label: '添加经历', origin: 'user', runId: null }, (state) => ({
        ...state,
        blocks: [experienceBlock([CONFIRMED_CLAIM_ID])],
      })),
    )
    // From here on the library changes under the freeze, as a rejection from
    // another run would.
    experienceRepo.armed = true

    const snapshot = await freezeResume(
      repo,
      experienceRepo,
      new SequentialIdGenerator('snapshot'),
      new FixedClock(),
      RESUME_ID,
    )

    // The statement the gate saw is the statement the snapshot carries.
    expect(snapshot.materializedBlocks[0]?.claims).toHaveLength(1)
    expect(experienceRepo.reads).toBe(1)
  })

  it('refuses a block that still cites an unconfirmed claim', async () => {
    const repo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    experienceRepo.seed(experience('pending'))
    await commitDocumentChange(
      repo,
      experienceRepo,
      RESUME_ID,
      describeChange({ label: '添加经历', origin: 'user', runId: null }, (state) => ({
        ...state,
        blocks: [experienceBlock([CONFIRMED_CLAIM_ID])],
      })),
    )

    await expect(
      freezeResume(
        repo,
        experienceRepo,
        new SequentialIdGenerator('snapshot'),
        new FixedClock(),
        RESUME_ID,
      ),
    ).rejects.toMatchObject({ code: 'claimPending' })
    expect((await repo.findById(RESUME_ID))?.status).toBe('draft')
  })

  it('refuses a cursor that was moved back from the newest revision', async () => {
    const repo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    await commitDocumentChange(
      repo,
      experienceRepo,
      RESUME_ID,
      describeChange({ label: '添加第一段', origin: 'user', runId: null }, (state) => ({
        ...state,
        blocks: [textBlock('block-1', '第一段。')],
      })),
    )
    await commitDocumentChange(
      repo,
      experienceRepo,
      RESUME_ID,
      describeChange({ label: '添加第二段', origin: 'user', runId: null }, (state) => ({
        ...state,
        blocks: [...state.blocks, textBlock('block-2', '第二段。')],
      })),
    )
    await undoDocumentChange(repo, RESUME_ID)

    await expect(
      freezeResume(
        repo,
        experienceRepo,
        new SequentialIdGenerator('snapshot'),
        new FixedClock(),
        RESUME_ID,
      ),
    ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })
  })

  it('refuses an empty resume', async () => {
    const repo = await seededResume()

    await expect(
      freezeResume(
        repo,
        new InMemoryExperienceRepository(),
        new SequentialIdGenerator('snapshot'),
        new FixedClock(),
        RESUME_ID,
      ),
    ).rejects.toMatchObject({ code: 'emptyResume' })
  })

  it('refuses to freeze twice', async () => {
    const repo = await seededResume()
    const experienceRepo = new InMemoryExperienceRepository()
    await commitDocumentChange(
      repo,
      experienceRepo,
      RESUME_ID,
      describeChange({ label: '添加第一段', origin: 'user', runId: null }, (state) => ({
        ...state,
        blocks: [textBlock('block-1', '第一段。')],
      })),
    )
    const ids = new SequentialIdGenerator('snapshot')
    const clock = new FixedClock()
    await freezeResume(repo, experienceRepo, ids, clock, RESUME_ID)

    await expect(
      freezeResume(repo, experienceRepo, ids, clock, RESUME_ID),
    ).rejects.toMatchObject({ code: 'frozenResumeImmutable' })
  })
})
