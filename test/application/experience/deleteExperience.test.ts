import { describe, expect, it } from 'vitest'
import { deleteExperience } from '../../../src/application/experience/DeleteExperience'
import type { DeleteExperienceDeps } from '../../../src/application/experience/DeleteExperience'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import type { Block } from '../../../src/domain/resume/Block'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { createResume } from '../../../src/domain/resume/Resume'
import type { Resume } from '../../../src/domain/resume/Resume'
import {
  asBlockId,
  asExperienceId,
  asResumeId,
  asRevisionId,
  asSnapshotId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import type { BlockId, ExperienceId, VariantId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock } from '../../support/fakeEnvironment'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')
const VARIANT_ID = asVariantId('var-1')
const RESUME_ID = asResumeId('resume-1')
const BLOCK_ID = asBlockId('block-1')

function experience(): Experience {
  return createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW)
}

function experienceBlock(blockId: BlockId, experienceId: ExperienceId, variantId: VariantId): Block {
  return {
    id: blockId,
    content: { type: 'experience', experienceId, variantId, refVersion: 1, claimIds: [] },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

/** A draft resume whose current live blocks reference the experience. */
async function resumeReferencing(
  repo: InMemoryResumeRepository,
  title: string,
  blockId: BlockId,
): Promise<void> {
  const revisionId = asRevisionId('revision-1')
  const resume = createResume(
    {
      id: RESUME_ID,
      title,
      targetRole: null,
      pageSetup: A4_PAGE_SETUP,
      initialRevisionId: revisionId,
    },
    NOW,
  )
  await repo.insertWithInitialRevision(
    resume,
    initialRevision(RESUME_ID, revisionId, { blocks: [], pageSetup: A4_PAGE_SETUP }, NOW),
  )
  await repo.saveDocument(
    RESUME_ID,
    {
      blocks: [experienceBlock(blockId, EXPERIENCE_ID, VARIANT_ID)],
      pageSetup: A4_PAGE_SETUP,
    },
    { label: '加入经历块', origin: 'user', runId: null },
  )
}

/** A frozen resume whose snapshot holds the experience as materialized text. */
async function frozenResumeWithSnapshot(repo: InMemoryResumeRepository): Promise<void> {
  const revisionId = asRevisionId('revision-9')
  const resume: Resume = {
    id: RESUME_ID,
    title: '定稿简历',
    targetRole: null,
    status: 'frozen',
    pageSetup: A4_PAGE_SETUP,
    blocks: [],
    currentRevision: revisionId,
    snapshots: [
      {
        id: asSnapshotId('snapshot-1'),
        resumeId: RESUME_ID,
        seq: 1,
        materializedBlocks: [
          {
            id: BLOCK_ID,
            content: {
              type: 'experience',
              title: '后端工程师',
              organization: null,
              startDate: null,
              endDate: null,
              variantContent: '负责服务拆分',
            },
            layout: DEFAULT_FLOW_LAYOUT,
            textStyle: null,
            claims: [],
          },
        ],
        pageSetup: A4_PAGE_SETUP,
        createdAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  }
  await repo.insertWithInitialRevision(
    resume,
    initialRevision(RESUME_ID, revisionId, { blocks: [], pageSetup: A4_PAGE_SETUP }, NOW),
  )
}

function setup(): {
  deps: DeleteExperienceDeps
  experienceRepo: InMemoryExperienceRepository
  resumeRepo: InMemoryResumeRepository
} {
  const clock = new FixedClock(NOW)
  const experienceRepo = new InMemoryExperienceRepository()
  experienceRepo.seed(experience())
  const resumeRepo = new InMemoryResumeRepository(() => clock.now())
  return { experienceRepo, resumeRepo, deps: { experienceRepo, resumeRepo } }
}

describe('deleteExperience', () => {
  it('deletes the row when no resume block references it', async () => {
    const { deps, experienceRepo } = setup()

    await deleteExperience(deps, EXPERIENCE_ID)

    expect(await experienceRepo.findById(EXPERIENCE_ID)).toBeNull()
  })

  it('refuses while a resume block references the experience, naming the resume and block', async () => {
    const { deps, experienceRepo, resumeRepo } = setup()
    await resumeReferencing(resumeRepo, '后端简历', BLOCK_ID)

    const refusal = deleteExperience(deps, EXPERIENCE_ID)

    await expect(refusal).rejects.toMatchObject({
      name: 'DomainError',
      code: 'referencedByBlocks',
      detail: { entity: 'experience', id: EXPERIENCE_ID, blockers: ['后端简历 / block-1'] },
    })
    expect(experienceRepo.size).toBe(1)
  })

  it('names the resume id when the resume carries no title', async () => {
    const { deps, resumeRepo } = setup()
    await resumeReferencing(resumeRepo, '', BLOCK_ID)

    await expect(deleteExperience(deps, EXPERIENCE_ID)).rejects.toMatchObject({
      detail: { blockers: ['resume-1 / block-1'] },
    })
  })

  it('does not treat a snapshot as a reference, because a snapshot is materialized text', async () => {
    const { deps, experienceRepo, resumeRepo } = setup()
    await frozenResumeWithSnapshot(resumeRepo)

    await deleteExperience(deps, EXPERIENCE_ID)

    expect(await experienceRepo.findById(EXPERIENCE_ID)).toBeNull()
  })

  it('refuses to delete an experience that does not exist', async () => {
    const { deps } = setup()

    await expect(deleteExperience(deps, asExperienceId('exp-missing'))).rejects.toThrow(
      /no such experience/,
    )
  })
})
