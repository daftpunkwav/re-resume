/**
 * @file ApplicationServicesProvider
 * @description Boots the composition root once and shares it with the interface.
 *
 * The root needs the native container: SQLite, the encrypted store and
 * outbound HTTP all run through plugins that only exist inside the Tauri
 * window. When that is missing — a plain browser during development — the
 * provider surfaces the reason instead of leaving a blank window.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createCompositionRoot } from '../../bootstrap/compositionRoot'
import type { CompositionRoot } from '../../bootstrap/compositionRoot'
import { Spinner } from './components/Spinner'
import { TextField } from './components/TextField'
import { Button } from './components/Button'
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
  | {
      readonly status: 'ready'
      readonly root: CompositionRoot
      /** Set when a rebuild failed and this root is the one that survived. */
      readonly rebuildError: string | null
    }
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
  // The root that is serving the interface right now. A rebuild that fails
  // leaves this one in place and records the reason beside it, so the settings
  // that triggered it — a vault password, a saved provider — cannot replace a
  // working session with a failure screen the user did nothing to earn.
  const serving = useRef<CompositionRoot | null>(null)
  // Counts the boots the user asked for directly. The store only re-renders on
  // a value that actually changed, so retrying with the password already held
  // would otherwise re-run nothing at all.
  const [attempt, setAttempt] = useState(0)
  // Held here rather than in the failure screen, because that screen is
  // remounted by every failed attempt and a password the user mistyped once
  // should not have to be typed again.
  const [bootPassword, setBootPassword] = useState('')

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
        // A root that arrives after the effect was cancelled is still holding
        // the database handle and the outbound client; nothing else would ever
        // shut it down.
        if (cancelled) {
          void root.shutdown()
          return
        }
        serving.current = root
        setBoot({ status: 'ready', root, rebuildError: null })
      } catch (thrown) {
        if (cancelled) return
        const reason = thrown instanceof Error ? thrown.message : '未知原因'
        const running = serving.current
        if (running === null) {
          setBoot({ status: 'failed', reason })
          return
        }
        setBoot({ status: 'ready', root: running, rebuildError: reason })
      }
    }

    void startRoot()
    return () => {
      cancelled = true
    }
  }, [createRoot, resolveSnapshotPath, settings, vaultPassword, attempt])

  // Keyed on the root rather than on the whole state, so recording a rebuild
  // error does not read as a new root and shut down the one still serving.
  const activeRoot = boot.status === 'ready' ? boot.root : null
  useEffect(() => {
    if (activeRoot === null) return
    return () => {
      if (serving.current === activeRoot) serving.current = null
      void activeRoot.shutdown()
    }
  }, [activeRoot])

  const value = useMemo(() => activeRoot, [activeRoot])

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
        <BootFailure
          reason={boot.reason}
          password={bootPassword}
          onPasswordChange={setBootPassword}
          onRetry={() => {
            setBoot({ status: 'booting' })
            // Bumped as well as the password: writing the same password twice
            // into the store changes nothing there, and the boot effect would
            // not run a second time.
            setAttempt((count) => count + 1)
          }}
        />
      </div>
    )
  }

  return (
    <ServicesContext.Provider value={value}>
      {boot.rebuildError === null ? null : (
        <div className="boot-screen">
          <Notice tone="warning" title="新的设置没有生效">
            <p>界面仍在使用上一个可用的应用容器。下面是重建时失败的原因：</p>
            <p className="boot-reason">{boot.rebuildError}</p>
          </Notice>
        </div>
      )}
      {children}
    </ServicesContext.Provider>
  )
}

/**
 * A boot that failed has no root serving, so everything that could ask for a
 * vault password — the settings form — is below this provider and was never
 * mounted. The prompt therefore lives here: the encrypted store opens when the
 * root is built, so a boot refused for want of the password can only be
 * answered at the point where the boot happens.
 */
function BootFailure({
  reason,
  password,
  onPasswordChange,
  onRetry,
}: {
  readonly reason: string
  readonly password: string
  readonly onPasswordChange: (password: string) => void
  readonly onRetry: () => void
}) {
  const unlockVault = useProviderSettings((state) => state.unlockVault)

  return (
    <div className="stack">
      <Notice tone="danger" title="无法连接本地应用容器">
        <p>
          界面依赖 Tauri 容器提供的 SQLite、加密存储与出站网络能力。请通过
          <code> pnpm run tauri dev </code>
          启动。
        </p>
        <p className="boot-reason">{reason}</p>
      </Notice>

      <div className="boot-retry">
        <TextField
          label="凭据库密码"
          type="password"
          value={password}
          autoComplete="off"
          onChange={(event) => onPasswordChange(event.target.value)}
        />
        <Button
          disabled={password.length === 0}
          onClick={() => {
            unlockVault(password)
            onRetry()
          }}
        >
          重试启动
        </Button>
      </div>
      <p className="boot-hint">
        凭据库密码只保存在内存里。如果这次启动失败与它无关，清空它再重试一次即可。
      </p>
    </div>
  )
}

export function useServices(): CompositionRoot {
  const root = useContext(ServicesContext)
  if (root === null) {
    throw new Error('useServices must be called inside ApplicationServicesProvider.')
  }
  return root
}
