/**
 * @file capabilities
 * @description The surface the composition root exposes to the interface. The
 * interface receives ready-to-call services and never sees a repository, a SQL
 * string or a provider.
 *
 * Responsibilities:
 * - Declare the service facades the root hands out, as interfaces
 * - Keep the root's contract separate from the assembly that implements it
 *
 * Constraints:
 * - Types declared here may name domain ports but must not name an
 *   infrastructure implementation: the interface is compiled into the window
 *   without the native layer behind it.
 * - A capability is added here when the interface can call it, not before.
 */

import type { AppSettings } from '../domain/settings/AppSettings'
import type { SecretStore } from '../domain/generation/ports/SecretStore'

/** Build information shown in the about section. Every field is a fact about the running build. */
export interface AppInfo {
  readonly version: string
  /** 'development', 'production' or 'test'. */
  readonly buildMode: string
  /** Which container runs the window. */
  readonly runtime: 'tauri' | 'browser'
  readonly license: string
  /** Absolute path of the database the window reads, or null when none is opened. */
  readonly databaseFile: string | null
}

export interface AppSettingsService {
  readonly read: () => Promise<AppSettings>
  readonly save: (patch: Partial<AppSettings>) => Promise<AppSettings>
}

export interface CompositionRoot {
  readonly appInfo: AppInfo
  readonly settings: AppSettingsService
  /**
   * The encrypted credential store. The interface reaches it through the
   * provider settings once those exist; the root owns the handle so the window
   * never names the native store itself.
   */
  readonly secrets: SecretStore
  /** Releases this root's claim on the shared database. */
  readonly shutdown: () => Promise<void>
}
