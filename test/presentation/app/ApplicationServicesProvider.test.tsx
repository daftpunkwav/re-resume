/**
 * @file ApplicationServicesProvider.test
 * @description How the composition root reaches the interface: what happens on
 * the first boot, and what happens to a working session when a rebuild fails.
 */

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationServicesProvider } from '../../../src/presentation/app/ApplicationServicesProvider'
import { useProviderSettings } from '../../../src/presentation/app/providerSettingsStore'
import type { CompositionRoot } from '../../../src/bootstrap/compositionRoot'

function stubRoot(): CompositionRoot {
  return { shutdown: vi.fn(async () => undefined) } as unknown as CompositionRoot
}

/**
 * Saving a provider or unlocking the vault is what re-runs the boot effect, so
 * the store is the trigger rather than anything this harness could render.
 */
let rebuildCount = 0
function rebuild(): void {
  // Each rebuild has to change the password: the provider selects it, and a
  // store update that leaves the selection identical re-runs nothing.
  rebuildCount += 1
  act(() => {
    useProviderSettings.getState().unlockVault(`password-${rebuildCount}`)
  })
}

function renderProvider(createRoot: () => Promise<CompositionRoot>): void {
  render(
    <ApplicationServicesProvider
      createRoot={createRoot}
      resolveSnapshotPath={async () => '/tmp/credentials.hold'}
    >
      <p>简历工作台</p>
    </ApplicationServicesProvider>,
  )
}

beforeEach(() => {
  useProviderSettings.setState({ settings: null, vaultPassword: '' })
})

describe('ApplicationServicesProvider', () => {
  it('hands a booted root to the interface', async () => {
    renderProvider(async () => stubRoot())

    expect(await screen.findByText('简历工作台')).toBeInTheDocument()
    expect(screen.queryByText('无法连接本地应用容器')).toBeNull()
  })

  it('shows the failure screen when the first boot fails', async () => {
    renderProvider(async () => {
      throw new Error('数据库被占用')
    })

    expect(await screen.findByText('无法连接本地应用容器')).toBeInTheDocument()
    expect(screen.getByText('数据库被占用')).toBeInTheDocument()
    expect(screen.queryByText('简历工作台')).toBeNull()
  })

  it('keeps the working session when a rebuild fails', async () => {
    let attempt = 0
    renderProvider(async () => {
      attempt += 1
      if (attempt === 1) return stubRoot()
      throw new Error('凭据库密码不对')
    })
    await screen.findByText('简历工作台')

    rebuild()

    // The settings that triggered the rebuild must not take the window down
    // with them; the root that was already serving keeps serving.
    expect(await screen.findByText('新的设置没有生效')).toBeInTheDocument()
    expect(screen.getByText('凭据库密码不对')).toBeInTheDocument()
    expect(screen.getByText('简历工作台')).toBeInTheDocument()
    expect(screen.queryByText('无法连接本地应用容器')).toBeNull()
  })

  it('closes the root a successful rebuild replaced', async () => {
    const first = stubRoot()
    const second = stubRoot()
    let attempt = 0
    renderProvider(async () => {
      attempt += 1
      return attempt === 1 ? first : second
    })
    await screen.findByText('简历工作台')

    rebuild()

    await vi.waitFor(() => expect(first.shutdown).toHaveBeenCalled())
    expect(second.shutdown).not.toHaveBeenCalled()
  })

  it('closes a root that arrives after a newer rebuild superseded it', async () => {
    const superseded = stubRoot()
    const kept = stubRoot()
    let attempt = 0
    renderProvider(async () => {
      attempt += 1
      if (attempt === 1) return stubRoot()
      if (attempt === 2) {
        // This rebuild is overtaken before it resolves, so the root it builds
        // belongs to an effect that no longer exists.
        await new Promise((resolve) => setTimeout(resolve, 40))
        return superseded
      }
      return kept
    })
    await screen.findByText('简历工作台')

    rebuild()
    rebuild()

    await vi.waitFor(() => expect(superseded.shutdown).toHaveBeenCalled())
    expect(kept.shutdown).not.toHaveBeenCalled()
    expect(screen.getByText('简历工作台')).toBeInTheDocument()
  })
})
