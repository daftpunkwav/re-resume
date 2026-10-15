import { describe, expect, it } from 'vitest'
import { updateExperienceFact } from '../../../src/application/experience/UpdateExperienceFact'
import type { UpdateExperienceFactDeps } from '../../../src/application/experience/UpdateExperienceFact'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asExperienceId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock } from '../../support/fakeEnvironment'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')

function workExperience(): Experience {
  return createExperience(
    {
      id: EXPERIENCE_ID,
      kind: 'work',
      title: '后端工程师',
      organization: '某公司',
      startDate: '2022-07-01' as Experience['startDate'],
      detail: { company: '某公司', role: '工程师', technologies: ['Go'], highlights: [] },
    },
    NOW,
  )
}

async function setup(): Promise<{
  deps: UpdateExperienceFactDeps
  repo: InMemoryExperienceRepository
}> {
  const repo = new InMemoryExperienceRepository()
  repo.seed(workExperience())
  return { repo, deps: { experienceRepo: repo, clock: new FixedClock(NOW) } }
}

describe('updateExperienceFact', () => {
  it('patches only the fields the command carries and bumps factVersion', async () => {
    const { deps, repo } = await setup()

    const result = await updateExperienceFact(deps, {
      experienceId: EXPERIENCE_ID,
      title: '高级后端工程师',
    })

    expect(result.ok).toBe(true)
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.title).toBe('高级后端工程师')
    expect(stored?.organization).toBe('某公司')
    expect(stored?.startDate).toBe('2022-07-01')
    expect(stored?.factVersion).toBe(2)
  })

  it('clears an optional fact field when it is set to null', async () => {
    const { deps, repo } = await setup()

    await updateExperienceFact(deps, { experienceId: EXPERIENCE_ID, organization: null })

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.organization).toBeNull()
  })

  it('keeps the stored detail when the patch omits it', async () => {
    const { deps, repo } = await setup()

    await updateExperienceFact(deps, { experienceId: EXPERIENCE_ID, title: '资深后端工程师' })

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.detail).toEqual({
      company: '某公司',
      role: '工程师',
      technologies: ['Go'],
      highlights: [],
    })
  })

  it('validates a replacement detail against the experience own kind', async () => {
    const { deps, repo } = await setup()

    const result = await updateExperienceFact(deps, {
      experienceId: EXPERIENCE_ID,
      detail: { school: '某大学', degree: '学士', major: '计算机' },
    })

    expect(result.ok).toBe(false)
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.factVersion).toBe(1)
  })

  it('returns an Err for a date that is not a real calendar date', async () => {
    const { deps } = await setup()

    const result = await updateExperienceFact(deps, {
      experienceId: EXPERIENCE_ID,
      startDate: '2026-13-01',
    })

    expect(result.ok).toBe(false)
  })

  it('refuses an end date that precedes the stored start date', async () => {
    const { deps, repo } = await setup()

    await expect(
      updateExperienceFact(deps, { experienceId: EXPERIENCE_ID, endDate: '2020-01-01' }),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'endBeforeStart' })
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.factVersion).toBe(1)
  })

  it('refuses a blank title as an aggregate invariant', async () => {
    const { deps } = await setup()

    await expect(
      updateExperienceFact(deps, { experienceId: EXPERIENCE_ID, title: '  ' }),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'emptyTitle' })
  })
})
