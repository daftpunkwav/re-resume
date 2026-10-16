import { describe, expect, it } from 'vitest'
import { updateVariant } from '../../../src/application/experience/UpdateVariant'
import type { UpdateVariantDeps } from '../../../src/application/experience/UpdateVariant'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asExperienceId, asVariantId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock } from '../../support/fakeEnvironment'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')
const VARIANT_ID = asVariantId('var-1')

function experienceWithVariant(): Experience {
  const created = createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW)
  return {
    ...created,
    factVersion: 2,
    variants: [
      {
        id: VARIANT_ID,
        experienceId: EXPERIENCE_ID,
        label: '架构导向',
        content: '负责服务拆分',
        emphasis: null,
        draftedByRunId: null,
        confirmedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  }
}

function setup(): { deps: UpdateVariantDeps; repo: InMemoryExperienceRepository } {
  const repo = new InMemoryExperienceRepository()
  repo.seed(experienceWithVariant())
  return { repo, deps: { experienceRepo: repo, clock: new FixedClock(NOW) } }
}

describe('updateVariant', () => {
  it('rewrites the wording, keeps the untouched fields and bumps factVersion', async () => {
    const { deps, repo } = setup()

    const result = await updateVariant(deps, {
      experienceId: EXPERIENCE_ID,
      variantId: VARIANT_ID,
      content: '主导了服务拆分',
    })

    expect(result.ok).toBe(true)
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.variants[0]?.content).toBe('主导了服务拆分')
    expect(stored?.variants[0]?.label).toBe('架构导向')
    expect(stored?.factVersion).toBe(3)
  })

  it('clears the emphasis when the field is sent as null', async () => {
    const { deps, repo } = setup()

    await updateVariant(deps, {
      experienceId: EXPERIENCE_ID,
      variantId: VARIANT_ID,
      emphasis: null,
    })

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.variants[0]?.emphasis).toBeNull()
  })

  it('returns an Err for a blank replacement', async () => {
    const { deps } = setup()

    expect(
      (await updateVariant(deps, { experienceId: EXPERIENCE_ID, variantId: VARIANT_ID, content: ' ' }))
        .ok,
    ).toBe(false)
  })

  it('refuses a variant that belongs to another experience', async () => {
    const { deps } = setup()

    await expect(
      updateVariant(deps, {
        experienceId: EXPERIENCE_ID,
        variantId: asVariantId('var-unknown'),
        content: '主导了服务拆分',
      }),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'variantNotInExperience' })
  })

  it('refuses a label the experience already uses', async () => {
    const { deps, repo } = setup()
    const experience = await repo.findById(EXPERIENCE_ID)
    if (experience === null) throw new Error('fixture missing')
    await repo.save({
      ...experience,
      variants: [
        ...experience.variants,
        { ...experience.variants[0]!, id: asVariantId('var-2'), label: '业务价值导向' },
      ],
    })

    await expect(
      updateVariant(deps, {
        experienceId: EXPERIENCE_ID,
        variantId: VARIANT_ID,
        label: '业务价值导向',
      }),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'duplicateVariantLabel' })
  })
})
