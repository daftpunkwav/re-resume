import { describe, expect, it } from 'vitest'
import { confirmVariant } from '../../../src/application/experience/ConfirmVariant'
import type { ConfirmVariantDeps } from '../../../src/application/experience/ConfirmVariant'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import type { Variant } from '../../../src/domain/catalog/Variant'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asAgentRunId, asExperienceId, asVariantId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock } from '../../support/fakeEnvironment'

const CREATED_AT: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const CONFIRMED_AT: DateTime = parseDateTime('2026-03-02T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')
const VARIANT_ID = asVariantId('var-1')

/** An experience carrying one agent draft; factVersion 2 came from the add. */
function experienceWithDraft(): Experience {
  const created = createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, CREATED_AT)
  const draft: Variant = {
    id: VARIANT_ID,
    experienceId: EXPERIENCE_ID,
    label: '架构导向',
    content: '负责服务拆分',
    emphasis: null,
    draftedByRunId: asAgentRunId('run-1'),
    confirmedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
  return { ...created, factVersion: 2, variants: [draft] }
}

function setup(): { deps: ConfirmVariantDeps; repo: InMemoryExperienceRepository } {
  const repo = new InMemoryExperienceRepository()
  repo.seed(experienceWithDraft())
  return { repo, deps: { experienceRepo: repo, clock: new FixedClock(CONFIRMED_AT) } }
}

describe('confirmVariant', () => {
  it('writes confirmedAt and keeps the drafting run for provenance', async () => {
    const { deps, repo } = setup()

    await confirmVariant(deps, EXPERIENCE_ID, VARIANT_ID)

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.variants[0]?.confirmedAt).toBe(CONFIRMED_AT)
    expect(stored?.variants[0]?.draftedByRunId).toBe('run-1')
  })

  it('does not bump factVersion, because a confirmation is not a content change', async () => {
    const { deps, repo } = setup()

    await confirmVariant(deps, EXPERIENCE_ID, VARIANT_ID)

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.factVersion).toBe(2)
  })

  it('leaves the wording untouched', async () => {
    const { deps, repo } = setup()

    await confirmVariant(deps, EXPERIENCE_ID, VARIANT_ID)

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.variants[0]?.content).toBe('负责服务拆分')
    expect(stored?.variants[0]?.label).toBe('架构导向')
  })

  it('refuses a variant that belongs to another experience', async () => {
    const { deps } = setup()

    await expect(confirmVariant(deps, EXPERIENCE_ID, asVariantId('var-unknown'))).rejects.toMatchObject(
      { name: 'DomainError', code: 'variantNotInExperience' },
    )
  })
})
