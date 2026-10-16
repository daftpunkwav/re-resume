import { describe, expect, it } from 'vitest'
import { removeVariant } from '../../../src/application/experience/RemoveVariant'
import type { RemoveVariantDeps } from '../../../src/application/experience/RemoveVariant'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import type { Variant } from '../../../src/domain/catalog/Variant'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import type { Block } from '../../../src/domain/resume/Block'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { createResume } from '../../../src/domain/resume/Resume'
import {
  asBlockId,
  asExperienceId,
  asResumeId,
  asRevisionId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import type { BlockId, VariantId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock } from '../../support/fakeEnvironment'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const CONFIRMED_AT: DateTime = parseDateTime('2026-03-01T00:00:10.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')
const REFERENCED_VARIANT = asVariantId('var-1')
const OTHER_VARIANT = asVariantId('var-2')
const RESUME_ID = asResumeId('resume-1')
const BLOCK_ID = asBlockId('block-1')

function confirmedVariant(id: VariantId, label: string): Variant {
  return {
    id,
    experienceId: EXPERIENCE_ID,
    label,
    content: '负责服务拆分',
    emphasis: null,
    draftedByRunId: null,
    confirmedAt: CONFIRMED_AT,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function experience(): Experience {
  return {
    ...createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW),
    factVersion: 3,
    variants: [confirmedVariant(REFERENCED_VARIANT, '架构导向'), confirmedVariant(OTHER_VARIANT, '业务价值导向')],
  }
}

function experienceBlock(blockId: BlockId, variantId: VariantId): Block {
  return {
    id: blockId,
    content: {
      type: 'experience',
      experienceId: EXPERIENCE_ID,
      variantId,
      refVersion: 3,
      claimIds: [],
    },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

/** A draft resume whose live block selects the given variant. */
async function resumeReferencing(
  repo: InMemoryResumeRepository,
  title: string,
  variantId: VariantId,
): Promise<void> {
  const revisionId = asRevisionId('revision-1')
  const resume = createResume(
    { id: RESUME_ID, title, targetRole: null, pageSetup: A4_PAGE_SETUP, initialRevisionId: revisionId },
    NOW,
  )
  await repo.insertWithInitialRevision(
    resume,
    initialRevision(RESUME_ID, revisionId, { blocks: [], pageSetup: A4_PAGE_SETUP }, NOW),
  )
  await repo.saveDocument(
    RESUME_ID,
    { blocks: [experienceBlock(BLOCK_ID, variantId)], pageSetup: A4_PAGE_SETUP },
    { label: '加入经历块', origin: 'user', runId: null },
    revisionId,
  )
}

function setup(): {
  deps: RemoveVariantDeps
  experienceRepo: InMemoryExperienceRepository
  resumeRepo: InMemoryResumeRepository
} {
  const clock = new FixedClock(NOW)
  const experienceRepo = new InMemoryExperienceRepository()
  experienceRepo.seed(experience())
  const resumeRepo = new InMemoryResumeRepository(() => clock.now())
  return { experienceRepo, resumeRepo, deps: { experienceRepo, resumeRepo, clock } }
}

describe('removeVariant', () => {
  it('removes a variant no resume block points at', async () => {
    const { deps, experienceRepo, resumeRepo } = setup()
    await resumeReferencing(resumeRepo, '后端简历', REFERENCED_VARIANT)

    await removeVariant(deps, EXPERIENCE_ID, OTHER_VARIANT)

    const stored = await experienceRepo.findById(EXPERIENCE_ID)
    expect(stored?.variants.map((variant) => variant.id)).toEqual([REFERENCED_VARIANT])
    expect(stored?.factVersion).toBe(4)
  })

  it('refuses while a resume block references the variant, naming the resume and block', async () => {
    const { deps, experienceRepo, resumeRepo } = setup()
    await resumeReferencing(resumeRepo, '后端简历', REFERENCED_VARIANT)

    await expect(removeVariant(deps, EXPERIENCE_ID, REFERENCED_VARIANT)).rejects.toMatchObject({
      name: 'DomainError',
      code: 'referencedByBlocks',
      detail: {
        entity: 'variant',
        id: REFERENCED_VARIANT,
        blockers: ['后端简历 / block-1'],
      },
    })
    const stored = await experienceRepo.findById(EXPERIENCE_ID)
    expect(stored?.variants).toHaveLength(2)
    expect(stored?.factVersion).toBe(3)
  })

  it('names the resume id when the resume carries no title', async () => {
    const { deps, resumeRepo } = setup()
    await resumeReferencing(resumeRepo, '', REFERENCED_VARIANT)

    await expect(removeVariant(deps, EXPERIENCE_ID, REFERENCED_VARIANT)).rejects.toMatchObject({
      detail: { blockers: ['resume-1 / block-1'] },
    })
  })

  it('refuses a variant that does not belong to the experience', async () => {
    const { deps } = setup()

    await expect(
      removeVariant(deps, EXPERIENCE_ID, asVariantId('var-unknown')),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'variantNotInExperience' })
  })
})
