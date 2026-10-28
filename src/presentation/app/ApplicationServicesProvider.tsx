/**
 * @file ApplicationServicesProvider
 * @description Boots the composition root once and shares it with the
 * interface, keeping the three states the window can be in: starting, serving,
 * and failed. A rebuild that fails leaves the root that is already serving in
 * place and records the reason beside it.
 *
 * Responsibilities:
 * - Build the root from the saved options, and adopt the settings it reads
 * - Hand the interface the services, plus a way to retry a failed rebuild
 * - Ask for the vault password when a boot fails, since the settings form that
 *   could ask for it lives below this provider and was never mounted
 *
 * Constraints:
 * - The root needs the native container: SQLite and the encrypted store run
 *   through plugins that only exist inside the Tauri window. When that is
 *   missing — a plain browser — the provider surfaces the reason instead of
 *   leaving a blank window.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DATABASE_CONNECTION_STRING, createCompositionRoot } from '../../bootstrap/compositionRoot'
import { resolveCredentialsSnapshotPath } from '../../bootstrap/nativePaths'
import type { CompositionRoot } from '../../bootstrap/capabilities'
import { Button } from './components/Button'
import { Notice } from './components/Notice'
import { Spinner } from './components/Spinner'
import { TextField } from './components/TextField'
import { describeBootFailure } from './errorMessages'
import { useSettingsStore } from './stores/settingsStore'
import { useShellStore } from './stores/shellStore'

interface ServicesContextValue {
  readonly root: CompositionRoot
  /** Rebuilds the root after a failed rebuild, keeping the current one serving. */
  readonly rebuild: () => void
}

const ServicesContext = createContext<ServicesContextValue | null>(null)

export interface ApplicationServicesProviderProps {
  readonly children: ReactNode
  /** Overridden by the preview window and by tests, which need no native runtime. */
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

export function ApplicationServicesProvider({
  children,
  createRoot = createCompositionRoot,
  resolveSnapshotPath = resolveCredentialsSnapshotPath,
}: ApplicationServicesProviderProps) {
  const [boot, setBoot] = useState<BootState>({ status: 'booting' })
  // The root that is serving the interface right now. A rebuild that fails
  // leaves this one in place and records the reason beside it, so a failed
  // rebuild cannot replace a working session with a failure screen.
  const serving = useRef<CompositionRoot | null>(null)
  // Counts the boots the user asked for directly, so a retry runs even when
  // the password has not changed since the last failure.
  const [attempt, setAttempt] = useState(0)
  // The password that was submitted, as opposed to the one being typed: only
  // a submitted password may start a boot.
  const [submittedPassword, setSubmittedPassword] = useState('')
  const [passwordInput, setPasswordInput] = useState('')

  useEffect(() => {
    let cancelled = false

    const startRoot = async (): Promise<void> => {
      try {
        const snapshotPath = await resolveSnapshotPath()
        const root = await createRoot({
          databaseConnectionString: DATABASE_CONNECTION_STRING,
          stronghold: { snapshotPath, password: submittedPassword },
        })
        if (cancelled) {
          void root.shutdown()
          return
        }
        const previous = serving.current
        serving.current = root
        if (previous !== null && previous !== root) void previous.shutdown()
        useSettingsStore.getState().connect(root.settings.save)
        try {
          const settings = await root.settings.read()
          if (cancelled) {
            void root.shutdown()
            return
          }
          useSettingsStore.getState().adopt(settings)
          useShellStore.getState().hydrate(settings.panels)
        } catch (failure) {
          // A settings row that cannot be read is a per-section problem: the
          // cached value keeps serving and the settings overlay reports it.
          useSettingsStore.getState().failRead(failure)
        }
        setBoot({ status: 'ready', root, rebuildError: null })
      } catch (thrown) {
        if (cancelled) return
        const reason = describeBootFailure(thrown)
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
  }, [createRoot, resolveSnapshotPath, attempt, submittedPassword])

  // The root that was serving when the provider unmounted. A rebuild in
  // progress renders the boot screen, but that is not an unmount: the serving
  // ref has to survive it, or a failed rebuild would find nothing to fall back
  // to and replace a working session with the failure screen.
  useEffect(() => {
    return () => {
      const root = serving.current
      serving.current = null
      if (root !== null) void root.shutdown()
    }
  }, [])

  const activeRoot = boot.status === 'ready' ? boot.root : null

  const rebuild = useCallback(() => {
    setBoot({ status: 'booting' })
    setAttempt((count) => count + 1)
  }, [])

  const value = useMemo<ServicesContextValue | null>(
    () => (activeRoot === null ? null : { root: activeRoot, rebuild }),
    [activeRoot, rebuild],
  )

  if (boot.status === 'booting') {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <span className="brand-mark boot-mark" aria-hidden="true">
            R
          </span>
          <Spinner label="正在准备本地数据…" />
        </div>
      </div>
    )
  }

  if (boot.status === 'failed') {
    return (
      <div className="boot-screen">
        <div className="boot-card boot-card-wide">
          <BootFailure
            reason={boot.reason}
            password={passwordInput}
            onPasswordChange={setPasswordInput}
            onRetry={() => {
              setSubmittedPassword(passwordInput)
              setBoot({ status: 'booting' })
              setAttempt((count) => count + 1)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <ServicesContext.Provider value={value}>
      {boot.rebuildError === null ? null : (
        <div className="rebuild-banner" role="status">
          <Notice
            tone="warning"
            title="新的设置没有生效"
            actions={
              <Button size="small" variant="secondary" onClick={rebuild}>
                重试
              </Button>
            }
          >
            <p>界面仍在使用上一个可用的应用容器。下面是重建时失败的原因：</p>
            <p className="rebuild-reason">{boot.rebuildError}</p>
          </Notice>
        </div>
      )}
      {children}
    </ServicesContext.Provider>
  )
}

/**
 * A boot that failed has no root serving, so everything that could ask for a
 * vault password is below this provider and was never mounted. The prompt
 * therefore lives here: the encrypted store opens when the root is built, so a
 * boot refused for want of the password can only be answered where the boot
 * happens.
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
  return (
    <div className="boot-failure">
      <span className="brand-mark boot-mark" aria-hidden="true">
        R
      </span>
      <Notice tone="danger" title="无法连接本地应用容器">
        <p>
          界面依赖桌面容器提供的本地数据库与加密存储。请通过
          <code> pnpm run tauri dev </code>
          启动；若是凭据库需要密码，输入后重试。
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
        {/* Deliberately never disabled: a boot can fail for a reason the
            password has nothing to do with, and retrying without one is
            exactly what that case needs. */}
        <Button variant="primary" onClick={onRetry}>
          重试启动
        </Button>
      </div>
      <p className="boot-hint">凭据库密码只保存在内存里，不会写入磁盘。</p>
    </div>
  )
}

export function useServices(): CompositionRoot {
  const value = useContext(ServicesContext)
  if (value === null) {
    throw new Error('useServices must be called inside ApplicationServicesProvider.')
  }
  return value.root
}

/** Runs a rebuild that failed, for the banner that reports it. */
export function useApplicationRebuild(): () => void {
  const value = useContext(ServicesContext)
  if (value === null) {
    throw new Error('useApplicationRebuild must be called inside ApplicationServicesProvider.')
  }
  return value.rebuild
}
