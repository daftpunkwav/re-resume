/**
 * @file ApplicationServicesProvider.test
 * @description How the composition root reaches the interface: what happens on
 * the first boot, what a failed rebuild does to a working session, and how the
 * settings value the root reads is adopted.
 */

import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ApplicationServicesProvider,
  useApplicationRebuild,
} from '../../../src/presentation/app/ApplicationServicesProvider'
import type { CompositionRoot } from '../../../src/bootstrap/capabilities'
import type { createCompositionRoot } from '../../../src/bootstrap/compositionRoot'
import { DEFAULT_APP_SETTINGS } from '../../../src/domain/settings/AppSettings'
import { InMemorySecretStore } from '../../../src/infrastructure/preview/inMemoryRepositories'
import { createPreviewConversationService } from '../../../src/bootstrap/previewConversation'
import { useSettingsStore } from '../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../src/presentation/app/stores/shellStore'
import { stubCompositionRoot } from '../../support/stubCompositionRoot'

function stubRoot(): CompositionRoot {
  const base = stubCompositionRoot()
  return {
    appInfo: {
      version: '0.0.0-test',
      buildMode: 'test',
      runtime: 'browser',
      license: 'MIT',
      databaseFile: null,
    },
    settings: {
      read: async () => DEFAULT_APP_SETTINGS,
      save: async (patch) => ({ ...DEFAULT_APP_SETTINGS, ...patch }),
    },
    info: base.info,
    resume: base.resume,
    export: base.export,
    conversation: createPreviewConversationService().service,
    providers: base.providers,
    libraryChanges: base.libraryChanges,
    backup: base.backup,
    seed: base.seed,
    secrets: new InMemorySecretStore(),
    shutdown: vi.fn(async () => undefined),
  }
}

/** A control inside the provider that asks for a rebuild, as the banner does. */
const rebuildHolder: { current: (() => void) | null } = { current: null }

function RebuildProbe() {
  const rebuild = useApplicationRebuild()
  useEffect(() => {
    rebuildHolder.current = rebuild
  }, [rebuild])
  return (
    <button type="button" onClick={rebuild}>
      重建
    </button>
  )
}

function renderProvider(createRoot: typeof createCompositionRoot): void {
  render(
    <ApplicationServicesProvider
      createRoot={createRoot}
      resolveSnapshotPath={async () => '/tmp/credentials.hold'}
    >
      <p>简历工作台</p>
      <RebuildProbe />
    </ApplicationServicesProvider>,
  )
}

beforeEach(() => {
  useSettingsStore.setState({
    settings: DEFAULT_APP_SETTINGS,
    status: 'connecting',
    error: null,
  })
  useShellStore.setState({ rightPanel: 'none', rightWidth: 400, sidebarCollapsed: false })
})

describe('ApplicationServicesProvider', () => {
  it('hands a booted root to the interface', async () => {
    renderProvider(async () => stubRoot())

    expect(await screen.findByText('简历工作台')).toBeInTheDocument()
    expect(screen.queryByText('无法连接本地应用容器')).toBeNull()
  })

  it('adopts the settings the root reads', async () => {
    const settings = { ...DEFAULT_APP_SETTINGS, uiScale: 1.2 }
    renderProvider(async () => ({
      ...stubRoot(),
      settings: { read: async () => settings, save: async () => settings },
    }))

    await screen.findByText('简历工作台')
    expect(useSettingsStore.getState().settings.uiScale).toBe(1.2)
    expect(useSettingsStore.getState().status).toBe('ready')
  })

  it('keeps the cached settings when the root cannot read them', async () => {
    renderProvider(async () => ({
      ...stubRoot(),
      settings: {
        read: async () => {
          throw new Error('设置行损坏')
        },
        save: async (patch) => ({ ...DEFAULT_APP_SETTINGS, ...patch }),
      },
    }))

    expect(await screen.findByText('简历工作台')).toBeInTheDocument()
    expect(useSettingsStore.getState().status).toBe('unavailable')
    expect(useSettingsStore.getState().error?.message).toContain('设置行损坏')
  })

  it('shows the failure screen when the first boot fails', async () => {
    renderProvider(async () => {
      throw new Error('数据库被占用')
    })

    expect(await screen.findByText('无法连接本地应用容器')).toBeInTheDocument()
    expect(screen.getByText('数据库被占用')).toBeInTheDocument()
    expect(screen.queryByText('简历工作台')).toBeNull()
  })

  it('shows a plugin rejection reason instead of an unknown cause', async () => {
    // A native rejection can be a string rather than an Error, and that string
    // is the only diagnostic the user can read or report.
    const rejection = 'error returned from database: unable to open database file'
    renderProvider(async () => {
      throw rejection
    })

    expect(await screen.findByText('无法连接本地应用容器')).toBeInTheDocument()
    expect(screen.getByText(rejection)).toBeInTheDocument()
    expect(screen.queryByText('未知原因')).toBeNull()
  })

  it('keeps the working session when a rebuild fails', async () => {
    const user = userEvent.setup({ delay: null })
    let attempt = 0
    renderProvider(async () => {
      attempt += 1
      if (attempt === 1) return stubRoot()
      throw new Error('凭据库密码不对')
    })
    await screen.findByText('简历工作台')

    await user.click(screen.getByRole('button', { name: '重建' }))

    // The settings that triggered the rebuild must not take the window down
    // with them; the root that was already serving keeps serving.
    expect(await screen.findByText('新的设置没有生效')).toBeInTheDocument()
    expect(screen.getByText('凭据库密码不对')).toBeInTheDocument()
    expect(screen.getByText('简历工作台')).toBeInTheDocument()
    expect(screen.queryByText('无法连接本地应用容器')).toBeNull()
  })

  it('closes the root a successful rebuild replaced', async () => {
    const user = userEvent.setup({ delay: null })
    const first = stubRoot()
    const second = stubRoot()
    let attempt = 0
    renderProvider(async () => {
      attempt += 1
      return attempt === 1 ? first : second
    })
    await screen.findByText('简历工作台')

    await user.click(screen.getByRole('button', { name: '重建' }))

    await vi.waitFor(() => expect(first.shutdown).toHaveBeenCalled())
    expect(second.shutdown).not.toHaveBeenCalled()
  })

  it('offers the vault password on the failure screen and boots with it', async () => {
    const user = userEvent.setup({ delay: null })
    let attempt = 0
    renderProvider(async (options) => {
      attempt += 1
      // The encrypted store refuses an empty password, the way it would once
      // something has been written into the snapshot.
      if (options.stronghold.password === '') throw new Error('凭据库没有解开')
      return stubRoot()
    })

    expect(await screen.findByText('无法连接本地应用容器')).toBeInTheDocument()

    await user.type(screen.getByLabelText('凭据库密码'), 'the-vault-password')
    await user.click(screen.getByRole('button', { name: '重试启动' }))

    // Without a prompt here the user has no way forward at all: the settings
    // form that could ask for this password was never mounted.
    expect(await screen.findByText('简历工作台')).toBeInTheDocument()
    expect(attempt).toBe(2)
  })

  it('retries with the password it already holds', async () => {
    const user = userEvent.setup({ delay: null })
    const seen: string[] = []
    let attempt = 0
    renderProvider(async (options) => {
      attempt += 1
      seen.push(options.stronghold.password)
      // Fails until the third boot, and only accepts the password entered, so
      // a retry that lost it cannot pass by accident.
      if (attempt < 3 || options.stronghold.password !== 'first') {
        throw new Error('凭据库没有解开')
      }
      return stubRoot()
    })
    await screen.findByText('无法连接本地应用容器')

    await user.type(screen.getByLabelText('凭据库密码'), 'first')
    await user.click(screen.getByRole('button', { name: '重试启动' }))
    await screen.findByText('无法连接本地应用容器')

    await user.click(screen.getByRole('button', { name: '重试启动' }))

    expect(await screen.findByText('简历工作台')).toBeInTheDocument()
    expect(seen).toEqual(['', 'first', 'first'])
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

    // The button is unmounted while the provider shows its boot state, so the
    // rebuild is triggered through the function the provider handed out.
    act(() => rebuildHolder.current?.())
    act(() => rebuildHolder.current?.())

    // The superseded boot resolves after a timer; on a busy machine the
    // shutdown callback can land later than the default wait.
    await vi.waitFor(() => expect(superseded.shutdown).toHaveBeenCalled(), { timeout: 3000 })
    expect(kept.shutdown).not.toHaveBeenCalled()
    expect(await screen.findByText('简历工作台')).toBeInTheDocument()
  })
})
