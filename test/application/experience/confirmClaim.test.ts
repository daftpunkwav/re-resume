import { describe, expect, it } from 'vitest'
import { confirmClaim } from '../../../src/application/experience/ConfirmClaim'
import type { ConfirmClaimDeps } from '../../../src/application/experience/ConfirmClaim'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Claim } from '../../../src/domain/catalog/Claim'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asClaimId, asExperienceId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock } from '../../support/fakeEnvironment'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const LATER: DateTime = parseDateTime('2026-03-02T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')
const CLAIM_ID = asClaimId('claim-1')

function experienceWithPendingClaim(): Experience {
  const claim: Claim = {
    id: CLAIM_ID,
    experienceId: EXPERIENCE_ID,
    kind: 'metric',
    statement: '把构建时间从 40 分钟降到 6 分钟',
    sourceField: 'detail.highlights.0',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
  }
  return { ...createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW), claims: [claim] }
}

function setup(status: 'pending' | 'confirmed'): {
  deps: ConfirmClaimDeps
  repo: InMemoryExperienceRepository
} {
  const repo = new InMemoryExperienceRepository()
  const experience = experienceWithPendingClaim()
  repo.seed({
    ...experience,
    claims: [{ ...experience.claims[0]!, status }],
  })
  return { repo, deps: { experienceRepo: repo, clock: new FixedClock(LATER) } }
}

describe('confirmClaim', () => {
  it('moves a pending assertion to confirmed', async () => {
    const { deps, repo } = setup('pending')

    const updated = await confirmClaim(deps, EXPERIENCE_ID, CLAIM_ID)

    expect(updated.claims[0]?.status).toBe('confirmed')
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.claims[0]?.status).toBe('confirmed')
  })

  it('leaves the fact version alone, because claim state is derived, not versioned', async () => {
    const { deps, repo } = setup('pending')

    await confirmClaim(deps, EXPERIENCE_ID, CLAIM_ID)

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.factVersion).toBe(1)
  })

  it('refuses to confirm an assertion twice', async () => {
    const { deps, repo } = setup('confirmed')

    await expect(confirmClaim(deps, EXPERIENCE_ID, CLAIM_ID)).rejects.toMatchObject({
      name: 'DomainError',
      code: 'invalidClaimTransition',
    })
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.claims[0]?.status).toBe('confirmed')
  })

  it('refuses a claim that does not belong to this experience', async () => {
    const { deps } = setup('pending')

    await expect(confirmClaim(deps, EXPERIENCE_ID, asClaimId('claim-missing'))).rejects.toMatchObject({
      name: 'DomainError',
    })
  })
})
