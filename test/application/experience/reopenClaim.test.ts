import { describe, expect, it } from 'vitest'
import { reopenClaim } from '../../../src/application/experience/ReopenClaim'
import type { ReopenClaimDeps } from '../../../src/application/experience/ReopenClaim'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Claim } from '../../../src/domain/catalog/Claim'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asClaimId, asExperienceId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock } from '../../support/fakeEnvironment'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')
const CLAIM_ID = asClaimId('claim-1')

function setup(status: 'rejected' | 'pending'): {
  deps: ReopenClaimDeps
  repo: InMemoryExperienceRepository
} {
  const claim: Claim = {
    id: CLAIM_ID,
    experienceId: EXPERIENCE_ID,
    kind: 'metric',
    statement: '把构建时间从 40 分钟降到 6 分钟',
    sourceField: null,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  }
  const experience: Experience = {
    ...createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW),
    claims: [claim],
  }
  const repo = new InMemoryExperienceRepository()
  repo.seed(experience)
  return { repo, deps: { experienceRepo: repo, clock: new FixedClock(NOW) } }
}

describe('reopenClaim', () => {
  it('brings a rejected assertion back to pending', async () => {
    const { deps, repo } = setup('rejected')

    const updated = await reopenClaim(deps, EXPERIENCE_ID, CLAIM_ID)

    expect(updated.claims[0]?.status).toBe('pending')
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.claims[0]?.status).toBe('pending')
  })

  it('leaves the fact version alone', async () => {
    const { deps, repo } = setup('rejected')

    await reopenClaim(deps, EXPERIENCE_ID, CLAIM_ID)

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.factVersion).toBe(1)
  })

  it('refuses to reopen an assertion that was never rejected', async () => {
    const { deps, repo } = setup('pending')

    await expect(reopenClaim(deps, EXPERIENCE_ID, CLAIM_ID)).rejects.toMatchObject({
      name: 'DomainError',
      code: 'invalidClaimTransition',
    })
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.claims[0]?.status).toBe('pending')
  })
})
