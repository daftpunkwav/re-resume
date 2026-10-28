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

import type {
  CreateCustomModuleInput,
  CreateCustomModuleOutput,
} from '../application/info/createCustomModule'
import type {
  CreateInfoEntryInput,
  CreateInfoEntryOutput,
} from '../application/info/createInfoEntry'
import type {
  DeleteCustomModuleInput,
  DeleteCustomModuleOutput,
} from '../application/info/deleteCustomModule'
import type {
  DeleteInfoEntryInput,
  DeleteInfoEntryOutput,
} from '../application/info/deleteInfoEntry'
import type {
  ListInfoEntriesInput,
  ListInfoEntriesOutput,
} from '../application/info/listInfoEntries'
import type {
  ReorderCustomModulesInput,
  ReorderCustomModulesOutput,
} from '../application/info/reorderCustomModules'
import type {
  ReorderInfoEntriesInput,
  ReorderInfoEntriesOutput,
} from '../application/info/reorderInfoEntries'
import type {
  SearchInfoEntriesInput,
  SearchInfoEntriesOutput,
} from '../application/info/searchInfoEntries'
import type {
  UpdateCustomModuleInput,
  UpdateCustomModuleOutput,
} from '../application/info/updateCustomModule'
import type {
  UpdateInfoEntryInput,
  UpdateInfoEntryOutput,
} from '../application/info/updateInfoEntry'
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

/**
 * The information library as the interface sees it: the library use cases,
 * already bound to their repositories, clock and identifier source. The facade
 * hands out domain values and throws `DomainError` for a refusal; it hides which
 * storage answers.
 */
export interface InfoService {
  readonly listEntries: (input?: ListInfoEntriesInput) => Promise<ListInfoEntriesOutput>
  readonly searchEntries: (input: SearchInfoEntriesInput) => Promise<SearchInfoEntriesOutput>
  readonly createEntry: (input: CreateInfoEntryInput) => Promise<CreateInfoEntryOutput>
  readonly updateEntry: (input: UpdateInfoEntryInput) => Promise<UpdateInfoEntryOutput>
  readonly deleteEntry: (input: DeleteInfoEntryInput) => Promise<DeleteInfoEntryOutput>
  readonly reorderEntries: (input: ReorderInfoEntriesInput) => Promise<ReorderInfoEntriesOutput>
  readonly createCustomModule: (
    input: CreateCustomModuleInput,
  ) => Promise<CreateCustomModuleOutput>
  readonly updateCustomModule: (
    input: UpdateCustomModuleInput,
  ) => Promise<UpdateCustomModuleOutput>
  readonly deleteCustomModule: (
    input: DeleteCustomModuleInput,
  ) => Promise<DeleteCustomModuleOutput>
  readonly reorderCustomModules: (
    input: ReorderCustomModulesInput,
  ) => Promise<ReorderCustomModulesOutput>
}

export interface CompositionRoot {
  readonly appInfo: AppInfo
  readonly settings: AppSettingsService
  readonly info: InfoService
  /**
   * The encrypted credential store. The interface reaches it through the
   * provider settings once those exist; the root owns the handle so the window
   * never names the native store itself.
   */
  readonly secrets: SecretStore
  /** Releases this root's claim on the shared database. */
  readonly shutdown: () => Promise<void>
}
