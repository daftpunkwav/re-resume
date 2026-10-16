import { describe, expect, it } from 'vitest'
import { createExperience } from '../../../src/application/experience/CreateExperience'
import type { CreateExperienceDeps } from '../../../src/application/experience/CreateExperience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import type { ExperienceId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime

function setup(): { deps: CreateExperienceDeps; repo: InMemoryExperienceRepository } {
  const repo = new InMemoryExperienceRepository()
  return {
    repo,
    deps: { experienceRepo: repo, clock: new FixedClock(NOW), ids: new SequentialIdGenerator('exp') },
  }
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'DomainError', code })
}

describe('createExperience', () => {
  it('persists the row with the generated id and the clock timestamp', async () => {
    const { deps, repo } = setup()

    const result = await createExperience(deps, { kind: 'work', title: '后端工程师' })

    expect(result.ok).toBe(true)
    expect(repo.size).toBe(1)
    const stored = await repo.findById('exp-1' as ExperienceId)
    expect(stored?.title).toBe('后端工程师')
    expect(stored?.factVersion).toBe(1)
    expect(stored?.createdAt).toBe(NOW)
    expect(stored?.detail).toEqual({})
  })

  it('keeps the optional fact fields it was given', async () => {
    const { deps } = setup()

    const result = await createExperience(deps, {
      kind: 'work',
      title: '后端工程师',
      organization: '某公司',
      startDate: '2022-07-01',
      endDate: '2025-06-30',
      detail: {
        company: '某公司',
        role: '工程师',
        technologies: ['Go'],
        highlights: [],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.startDate).toBe('2022-07-01')
    expect(result.value.organization).toBe('某公司')
  })

  it('returns an Err for a date that is not a real calendar date', async () => {
    const { deps } = setup()

    const result = await createExperience(deps, {
      kind: 'work',
      title: '后端工程师',
      startDate: '2026-02-31',
    })

    expect(result.ok).toBe(false)
  })

  it('refuses a current experience that carries an end date', async () => {
    const { deps } = setup()

    await expectDomainError(
      createExperience(deps, {
        kind: 'work',
        title: '后端工程师',
        isCurrent: true,
        endDate: '2026-02-01',
      }),
      'currentWithEndDate',
    )
  })

  it('refuses an end date that precedes the start date', async () => {
    const { deps } = setup()

    await expectDomainError(
      createExperience(deps, {
        kind: 'work',
        title: '后端工程师',
        startDate: '2022-07-01',
        endDate: '2021-01-01',
      }),
      'endBeforeStart',
    )
  })

  it('refuses a blank title as an aggregate invariant', async () => {
    const { deps } = setup()

    await expectDomainError(createExperience(deps, { kind: 'work', title: '   ' }), 'emptyTitle')
  })

  it('returns an Err when the detail does not fit the declared kind', async () => {
    const { deps } = setup()

    const result = await createExperience(deps, {
      kind: 'work',
      title: '后端工程师',
      detail: { school: '某大学' },
    })

    expect(result.ok).toBe(false)
  })

  it('strips an unknown key from the stored detail', async () => {
    const { deps, repo } = setup()

    await createExperience(deps, {
      kind: 'summary',
      title: '个人总结',
      detail: { highlights: ['八年后端经验'], legacyField: '旧字段' },
    })

    const stored = await repo.findById('exp-1' as ExperienceId)
    expect(stored?.detail).toEqual({ highlights: ['八年后端经验'] })
  })
})
