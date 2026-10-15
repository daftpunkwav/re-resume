import { describe, expect, it } from 'vitest'
import { updateProfile } from '../../../src/application/profile/UpdateProfile'
import type { UpdateProfileDeps } from '../../../src/application/profile/UpdateProfile'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { InMemoryProfileRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock } from '../../support/fakeEnvironment'

const SEEDED_AT: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const UPDATED_AT: DateTime = parseDateTime('2026-03-02T00:00:00.000Z') as DateTime

function setup(): { deps: UpdateProfileDeps; repo: InMemoryProfileRepository } {
  const repo = InMemoryProfileRepository.seeded(SEEDED_AT)
  return { repo, deps: { profileRepo: repo, clock: new FixedClock(UPDATED_AT) } }
}

describe('updateProfile', () => {
  it('bumps the version on every update, which is what a block refVersion compares', async () => {
    const { deps, repo } = setup()

    const first = await updateProfile(deps, { displayName: '张三' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.version).toBe(2)
    expect(first.value.updatedAt).toBe(UPDATED_AT)

    const second = await updateProfile(deps, { email: 'zhang@example.com' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.version).toBe(3)
    const stored = await repo.get()
    expect(stored.version).toBe(3)
  })

  it('keeps the fields the command does not carry', async () => {
    const { deps, repo } = setup()

    await updateProfile(deps, {
      displayName: '张三',
      email: 'zhang@example.com',
      phone: '13800000000',
      links: [{ label: 'GitHub', url: 'https://github.invalid/zhang' }],
    })
    await updateProfile(deps, { phone: '13900000000' })

    const stored = await repo.get()
    expect(stored.displayName).toBe('张三')
    expect(stored.email).toBe('zhang@example.com')
    expect(stored.phone).toBe('13900000000')
    expect(stored.links).toEqual([{ label: 'GitHub', url: 'https://github.invalid/zhang' }])
  })

  it('clears a field that the command sends as null or as an empty string', async () => {
    const { deps } = setup()

    await updateProfile(deps, { email: 'zhang@example.com', phone: '13800000000' })
    const cleared = await updateProfile(deps, { email: '', phone: null })

    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.value.email).toBeNull()
    expect(cleared.value.phone).toBeNull()
  })

  it('accepts an empty display name, so a seeded profile can be cleared', async () => {
    const { deps, repo } = setup()

    await updateProfile(deps, { displayName: '张三' })
    const cleared = await updateProfile(deps, { displayName: '' })

    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.value.displayName).toBe('')
    const stored = await repo.get()
    expect(stored.displayName).toBe('')
  })

  it('returns an Err for a malformed address or link url and writes nothing', async () => {
    const { deps, repo } = setup()
    expect((await updateProfile(deps, { email: 'not-an-address' })).ok).toBe(false)
    expect((await updateProfile(deps, { links: [{ label: 'GitHub', url: 'nope' }] })).ok).toBe(false)
    const stored = await repo.get()
    expect(stored.version).toBe(1)
    expect(stored.email).toBeNull()
  })

  it('trims the fields before storing them', async () => {
    const { deps } = setup()

    const result = await updateProfile(deps, { displayName: '  张三  ', email: ' zhang@example.com ' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.displayName).toBe('张三')
    expect(result.value.email).toBe('zhang@example.com')
  })
})
