/**
 * @file ProfileForm.test
 * @description Behaviour of the 个人资料 tab: it shows the stored profile,
 * sends an edit to UpdateProfile, and reports a refused command as text rather
 * than letting the Result escape into an unhandled rejection.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsView } from '../../../../src/presentation/features/settings/SettingsView'
import type { ProfileSettings } from '../../../../src/bootstrap/compositionRoot'
import type { Profile } from '../../../../src/domain/catalog/Profile'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import type { ProfileId } from '../../../../src/domain/shared/branded-id'
import { err, ok } from '../../../../src/domain/shared/Result'

const rootHolder = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../../../../src/presentation/app/ApplicationServicesProvider', () => ({
  useServices: () => rootHolder.current,
}))

function timestamp(raw: string): DateTime {
  const parsed = parseDateTime(raw)
  if (parsed === null) throw new Error(`Fixture timestamp "${raw}" is not an ISO 8601 value.`)
  return parsed
}

/**
 * A method the test did not arrange is a mistake in the test, and says so
 * instead of resolving to undefined and failing somewhere further along.
 */
function unstubbed(name: string): () => never {
  return () => {
    throw new Error(`Unstubbed service method called: ${name}`)
  }
}

function profileService(overrides: Partial<ProfileSettings> = {}): ProfileSettings {
  return {
    get: overrides.get ?? unstubbed('profile.get'),
    update: overrides.update ?? unstubbed('profile.update'),
  }
}

function profileWith(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'default' as ProfileId,
    displayName: '张三',
    email: 'zhang@example.com',
    phone: '13800000000',
    links: [{ label: 'GitHub', url: 'https://github.invalid/zhang' }],
    version: 4,
    updatedAt: timestamp('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
}

function stubProfileService(service: ProfileSettings): void {
  rootHolder.current = { profile: service }
}

beforeEach(() => {
  rootHolder.current = null
})

describe('ProfileForm', () => {
  it('shows the stored profile and its version once the load resolves', async () => {
    stubProfileService(profileService({ get: async () => profileWith() }))

    render(<SettingsView />)

    expect(await screen.findByDisplayValue('张三')).toBeInTheDocument()
    expect(screen.getByDisplayValue('zhang@example.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('13800000000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://github.invalid/zhang')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('sends the edited fields to update and reloads afterwards', async () => {
    const update = vi.fn(async () => ok(profileWith({ displayName: '李四', version: 5 })))
    const get = vi.fn(async () => profileWith())
    stubProfileService(profileService({ get, update }))
    const user = userEvent.setup()

    render(<SettingsView />)
    const name = await screen.findByDisplayValue('张三')
    await user.type(name, '四')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      displayName: '张三四',
      email: 'zhang@example.com',
      phone: '13800000000',
      links: [{ label: 'GitHub', url: 'https://github.invalid/zhang' }],
    })
    await vi.waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2)
    })
  })

  it('reports a refused command as visible text instead of throwing', async () => {
    stubProfileService(
      profileService({
        get: async () => profileWith(),
        update: async () => err(new Error('Expected a valid email address.')),
      }),
    )
    const user = userEvent.setup()

    render(<SettingsView />)
    // Appended rather than cleared, so the address is one UpdateProfile rejects.
    const email = await screen.findByDisplayValue('zhang@example.com')
    await user.type(email, 'x')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('Expected a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('保存失败')).toBeInTheDocument()
  })

  it('calls out a blank display name while the form is open', async () => {
    stubProfileService(profileService({ get: async () => profileWith({ displayName: '' }) }))

    render(<SettingsView />)

    expect(await screen.findByText('姓名还是空的')).toBeInTheDocument()
  })

  it('drops the callout once a name is typed', async () => {
    stubProfileService(profileService({ get: async () => profileWith({ displayName: '' }) }))
    const user = userEvent.setup()

    render(<SettingsView />)
    const name = await screen.findByLabelText('姓名')
    await user.type(name, '王五')

    expect(screen.queryByText('姓名还是空的')).not.toBeInTheDocument()
  })

  it('adds a link row, removes it again, and saves what is left', async () => {
    const update = vi.fn(async () => ok(profileWith({ links: [], version: 5 })))
    stubProfileService(profileService({ get: async () => profileWith({ links: [] }), update }))
    const user = userEvent.setup()

    render(<SettingsView />)
    await screen.findByText('还没有链接。')

    await user.click(screen.getByRole('button', { name: '添加链接' }))
    expect(screen.getAllByLabelText('链接名称')).toHaveLength(1)
    expect(screen.getAllByLabelText('链接地址')).toHaveLength(1)

    await user.type(screen.getByLabelText('链接名称'), 'GitHub')
    await user.type(screen.getByLabelText('链接地址'), 'https://github.invalid/zhang')

    await user.click(screen.getByRole('button', { name: '添加链接' }))
    expect(screen.getAllByLabelText('链接名称')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '删除第 2 条链接' }))
    expect(screen.getAllByLabelText('链接名称')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '保存' }))

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1)
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        links: [{ label: 'GitHub', url: 'https://github.invalid/zhang' }],
      }),
    )
  })

  it('removes a seeded link row', async () => {
    stubProfileService(profileService({ get: async () => profileWith() }))
    const user = userEvent.setup()

    render(<SettingsView />)
    await screen.findByDisplayValue('GitHub')

    await user.click(screen.getByRole('button', { name: '删除第 1 条链接' }))

    expect(screen.queryByDisplayValue('GitHub')).not.toBeInTheDocument()
    expect(screen.getByText('还没有链接。')).toBeInTheDocument()
  })

  it('offers both settings tabs', async () => {
    stubProfileService(profileService({ get: async () => profileWith() }))

    render(<SettingsView />)

    // Awaited so the profile load settles inside the test rather than after it.
    expect(await screen.findByDisplayValue('张三')).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['个人资料', '模型服务'])
  })
})
