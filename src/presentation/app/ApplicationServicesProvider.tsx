/**
 * @file ApplicationServicesProvider
 * @description Boots the composition root once and shares it with the interface.
 *
 * The root needs the native container: SQLite, the encrypted store and
 * outbound HTTP all run through plugins that only exist inside the Tauri
 * window. When that is missing — a plain browser during development — the
 * provider surfaces the reason instead of leaving a blank window.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createCompositionRoot } from '../../bootstrap/compositionRoot'
import type { CompositionRoot } from '../../bootstrap/compositionRoot'
import { Spinner } from './components/Spinner'
import { Notice } from './components/Notice'
import { toProviderDescriptor, useProviderSettings } from './providerSettingsStore'

/**
 * Must match the migration registration in the native shell; a different
 * string opens a second, empty database.
 */
const DATABASE_CONNECTION_STRING = 'sqlite:re-resume.db'

const ServicesContext = createContext<CompositionRoot | null>(null)

export interface ApplicationServicesProviderProps {
  readonly children: ReactNode
  /** Overridden by tests so they do not need a native runtime. */
  readonly createRoot?: typeof createCompositionRoot
  readonly resolveSnapshotPath?: () => Promise<string>
}

type BootState =
  | { readonly status: 'booting' }
  | { readonly status: 'ready'; readonly root: CompositionRoot }
  | { readonly status: 'failed'; readonly reason: string }

async function defaultSnapshotPath(): Promise<string> {
  const { appDataDir } = await import('@tauri-apps/api/path')
  const { join } = await import('@tauri-apps/api/path')
  return join(await appDataDir(), 'credentials.hold')
}

export function ApplicationServicesProvider({
  children,
  createRoot = createCompositionRoot,
  resolveSnapshotPath = defaultSnapshotPath,
}: ApplicationServicesProviderProps) {
  const [boot, setBoot] = useState<BootState>({ status: 'booting' })
  const settings = useProviderSettings((state) => state.settings)
  const vaultPassword = useProviderSettings((state) => state.vaultPassword)

  useEffect(() => {
    let cancelled = false

    const startRoot = async (): Promise<void> => {
      try {
        const snapshotPath = await resolveSnapshotPath()
        const root = await createRoot({
          databaseConnectionString: DATABASE_CONNECTION_STRING,
          stronghold: { snapshotPath, password: vaultPassword },
          provider: toProviderDescriptor(settings),
        })
        if (!cancelled) setBoot({ status: 'ready', root })
      } catch (thrown) {
        if (cancelled) return
        const reason = thrown instanceof Error ? thrown.message : '未知原因'
        setBoot({ status: 'failed', reason })
      }
    }

    void startRoot()
    return () => {
      cancelled = true
    }
  }, [createRoot, resolveSnapshotPath, settings, vaultPassword])

  useEffect(() => {
    if (boot.status !== 'ready') return
    const root = boot.root
    return () => {
      void root.shutdown()
    }
  }, [boot])

  const value = useMemo(() => (boot.status === 'ready' ? boot.root : null), [boot])

  if (boot.status === 'booting') {
    return (
      <div className="boot-screen">
        <Spinner label="正在准备本地数据…" />
      </div>
    )
  }

  if (boot.status === 'failed') {
    return (
      <div className="boot-screen">
        <Notice tone="danger" title="无法连接本地应用容器">
          <p>
            界面依赖 Tauri 容器提供的 SQLite、加密存储与出站网络能力。请通过
            <code> pnpm run tauri dev </code>
            启动，或在设置中确认凭据库密码。
          </p>
          <p className="boot-reason">{boot.reason}</p>
        </Notice>
      </div>
    )
  }

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}

export function useServices(): CompositionRoot {
  const root = useContext(ServicesContext)
  if (root === null) {
    throw new Error('useServices must be called inside ApplicationServicesProvider.')
  }
  return root
}
