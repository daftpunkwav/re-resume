/**
 * @file compositionRoot
 * @description The one module allowed to construct infrastructure and hand it
 * to the interface as ready-to-call services. Everything below
 * `presentation/` receives that surface and never sees a repository, a SQL
 * string or a provider.
 *
 * Responsibilities:
 * - Run the startup sequence in order: backup, open the database, verify it
 * - Construct the port implementations and wire each area's use cases to them
 * - Repair the agent runs a previous process left running
 * - Report the build facts the about section shows
 * - Release the claim on the shared database on shutdown
 *
 * Constraints:
 * - This module must not import from `presentation/`: the dependency points
 *   one way, and the interface receives this contract rather than the reverse.
 * - No business rule lives here. A rule stated in a use case stays there; this
 *   file only decides which implementation each port receives.
 */

import type { Clock } from '../domain/shared/Clock'
import type { IdGenerator } from '../domain/shared/IdGenerator'
import type { FileStore } from '../domain/conversation/ports/FileStore'
import type { CompositionRoot } from './capabilities'
import { describeAppInfo } from './buildInfo'
import { createAppSettingsService, createBackupService } from './wiring/appSettings'
import { createSeedDataService } from './wiring/seed'
import { createInfoService } from './wiring/info'
import { createResumeService } from './wiring/resume'
import { createExportService } from './wiring/export'
import {
  createConversationService,
  createProviderFromConfig,
  readActiveProviderSecret,
  resolveActiveProvider,
} from './wiring/conversation'
import type { ConversationLibrary, ConversationRepositories } from './wiring/conversation'
import { ActiveRunRegistry } from '../application/generation/activeRunRegistry'
import { PROVIDER_CONNECTION_TIMEOUT_MS } from '../application/settings/providerConfiguration'
import { createProviderService } from './wiring/providers'
import { createLibraryChangesService } from './wiring/changes'
import { startLocalDatabase } from './localDatabase'
import { backupDatabaseBeforeMigration } from '../infrastructure/persistence/backup'
import { openSqliteDatabase } from '../infrastructure/persistence/sqlite'
import { TauriAttachmentStore } from '../infrastructure/attachments/TauriAttachmentStore'
import type { ManagedSqlDatabase } from '../infrastructure/persistence/sqlite'
import { SqliteAppSettingsRepository } from '../infrastructure/persistence/settings/SqliteAppSettingsRepository'
import { SqliteProviderConfigRepository } from '../infrastructure/persistence/settings/SqliteProviderConfigRepository'
import { SqliteBackupStore } from '../infrastructure/persistence/backup/SqliteBackupStore'
import { SqliteCustomModuleRepository } from '../infrastructure/persistence/info/SqliteCustomModuleRepository'
import { SqliteInfoEntryRepository } from '../infrastructure/persistence/info/SqliteInfoEntryRepository'
import { SqliteResumeRepository } from '../infrastructure/persistence/resume/SqliteResumeRepository'
import { ResumeEntryReferences } from '../infrastructure/persistence/resume/ResumeEntryReferences'
import { loadBundledFontRegistry } from '../infrastructure/measurement/BundledFontRegistry'
import { registerCanvasFonts } from '../infrastructure/measurement/CanvasFontRegistration'
import { createFontkitTextMeasurer } from '../infrastructure/measurement/FontkitTextMeasurer'
import type { TextMeasurer } from '../domain/resume/ports/TextMeasurer'
import type { ResumePdfExporter } from '../domain/resume/ports/ResumePdfExporter'
import type { PdfFileSaver } from '../domain/resume/ports/PdfFileSaver'
import { createPdfExporter } from '../infrastructure/exporter/react-pdf/BundledFontPdfExporter'
import { TauriPdfFileSaver } from '../infrastructure/filesystem/TauriPdfFileSaver'
import { SqliteChangeRecordRepository } from '../infrastructure/persistence/info/SqliteChangeRecordRepository'
import { SqliteAttachmentRepository } from '../infrastructure/persistence/conversation/SqliteAttachmentRepository'
import { SqliteAgentRunRepository } from '../infrastructure/persistence/conversation/SqliteAgentRunRepository'
import { SqliteConversationRepository } from '../infrastructure/persistence/conversation/SqliteConversationRepository'
import { SqliteJobPostingRepository } from '../infrastructure/persistence/conversation/SqliteJobPostingRepository'
import { SqliteMessageContextRepository } from '../infrastructure/persistence/conversation/SqliteMessageContextRepository'
import { SqliteMessageRepository } from '../infrastructure/persistence/conversation/SqliteMessageRepository'
import { SqliteToolInvocationRepository } from '../infrastructure/persistence/conversation/SqliteToolInvocationRepository'
import { StrongholdSecretStore } from '../infrastructure/security/StrongholdSecretStore'
import type { StrongholdSecretStoreOptions } from '../infrastructure/security/StrongholdSecretStore'
import { SystemClock } from '../infrastructure/platform/systemClock'
import { RandomIdGenerator } from '../infrastructure/platform/randomIdGenerator'
import { createTauriHttpClient } from '../infrastructure/http/TauriHttpClient'

/**
 * Connection string of the application database. Must match the one the native
 * shell registers its migrations under; a different spelling opens a second,
 * empty database.
 */
export const DATABASE_CONNECTION_STRING = 'sqlite:re-resume.db'

/** The database file name inside the application config directory. */
const DATABASE_FILE_NAME = 're-resume.db'

/** Output ceiling handed to the provider adapters when the request does not set one. */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

export interface CompositionRootOptions {
  /** Connection string handed to the SQL plugin verbatim. */
  readonly databaseConnectionString: string
  /**
   * Stronghold snapshot path and unlock password; the password is never
   * persisted. The active provider's credential is read through this store when
   * the root is built.
   */
  readonly stronghold: StrongholdSecretStoreOptions
}

/**
 * Copies the database before the SQL plugin has a chance to migrate it. A
 * failure is reported to the startup log and does not stop the boot: the copy
 * is a safety net, and refusing to start because it could not be made would
 * cost the user the application over a precaution.
 */
async function recordPreMigrationBackup(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const outcome = await backupDatabaseBeforeMigration(invoke)
    // An operational record, not trace output: the answer says whether a copy
    // of the pre-rebuild database was made.
    console.info(`[startup] database backup: ${outcome.status} (${outcome.detail})`)
  } catch (failure) {
    console.warn(
      '[startup] the pre-migration database backup could not be made; continuing without it.',
      failure,
    )
  }
}

/**
 * Absolute location of the database file, or null when it cannot be resolved.
 * The directory is the one the SQL plugin resolves a relative `sqlite:` URL
 * against (the application config directory), so this path is the same file the
 * plugin opens.
 */
async function resolveDatabaseFile(): Promise<string | null> {
  try {
    const { appConfigDir, join } = await import('@tauri-apps/api/path')
    return await join(await appConfigDir(), DATABASE_FILE_NAME)
  } catch {
    // A window that cannot name its config directory still runs: the database is
    // opened through the plugin, which resolves the directory itself.
    return null
  }
}

/**
 * Builds the conversation repositories over the shared file store. The root
 * constructs one native attachment store and hands it here, so the ingest path,
 * the backup document and the orphan sweep all read and write the same
 * attachment directory.
 */
function createConversationRepositories(
  database: ManagedSqlDatabase,
  fileStore: FileStore,
): ConversationRepositories {
  return {
    conversations: new SqliteConversationRepository(database),
    messages: new SqliteMessageRepository(database),
    messageContexts: new SqliteMessageContextRepository(database),
    attachments: new SqliteAttachmentRepository(database),
    jobPostings: new SqliteJobPostingRepository(database),
    runs: new SqliteAgentRunRepository(database),
    invocations: new SqliteToolInvocationRepository(database),
    fileStore,
  }
}

/**
 * Loads the bundled font bytes, registers them with the document's FontFaceSet
 * and builds the canonical measurer, returning the registry as well: the PDF
 * exporter draws with exactly the faces the measurer resolved line breaks
 * against. Registration is what lets the canvas paint the faces the measurer
 * measured; a failure is fatal because without the bundled faces every line
 * break would move, so a window that cannot measure must not pretend it can.
 */
async function createCanvasMeasurement(): Promise<{
  readonly measurer: TextMeasurer
  readonly fonts: Awaited<ReturnType<typeof loadBundledFontRegistry>>
}> {
  const fonts = await loadBundledFontRegistry()
  await registerCanvasFonts(fonts)
  return { measurer: createFontkitTextMeasurer(fonts), fonts }
}

/**
 * Resolves the active provider and builds the conversation service, including
 * the recovery pass for runs a previous process left behind.
 */
async function createConversationRuntime(input: {
  readonly repositories: ConversationRepositories
  readonly providerConfigs: SqliteProviderConfigRepository
  readonly secrets: StrongholdSecretStore
  readonly measuredLibrary: Omit<ConversationLibrary, 'measurer'>
  readonly measurer: TextMeasurer
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly pdfExporter: ResumePdfExporter
  readonly pdfSaver: PdfFileSaver
}): Promise<ReturnType<typeof createConversationService>> {
  const http = createTauriHttpClient()
  const model = await resolveActiveProvider({
    providerConfigs: input.providerConfigs,
    secrets: input.secrets,
    http,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  })
  const providerSecrets = await readActiveProviderSecret({
    providerConfigs: input.providerConfigs,
    secrets: input.secrets,
  })
  const conversation = createConversationService({
    repositories: input.repositories,
    library: { ...input.measuredLibrary, measurer: input.measurer },
    clock: input.clock,
    ids: input.ids,
    model,
    titleModel: model,
    activeRuns: new ActiveRunRegistry(),
    secrets: providerSecrets,
    pdfExporter: input.pdfExporter,
    pdfSaver: input.pdfSaver,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    onWarning: (message, warning) => {
      console.warn(`[conversation] ${message}`, warning)
    },
  })
  try {
    const recovery = await conversation.recoverInterruptedRuns()
    if (recovery.failedRuns > 0 || recovery.repairedMessages > 0) {
      console.info(
        `[startup] interrupted run recovery: ${recovery.failedRuns} run(s), ${recovery.repairedMessages} message(s)`,
      )
    }
  } catch (failure) {
    // A stale run row is untidy, not fatal: the window still opens and the next
    // send is gated by the same database rule.
    console.warn('[startup] interrupted run recovery failed; continuing.', failure)
  }
  return conversation
}

/** Binds the provider use cases to the settings row and the encrypted secrets. */
function createProviderRuntime(input: {
  readonly providers: SqliteProviderConfigRepository
  readonly settings: SqliteAppSettingsRepository
  readonly secrets: StrongholdSecretStore
  readonly clock: Clock
  readonly ids: IdGenerator
}): ReturnType<typeof createProviderService> {
  // The probe talks to the same API as a turn, so it shares the transport
  // contract; the root keeps one client per surface instead of reaching for a
  // global.
  const http = createTauriHttpClient()
  return createProviderService({
    providers: input.providers,
    settings: input.settings,
    secrets: input.secrets,
    clock: input.clock,
    ids: input.ids,
    createProvider: (config, apiKey) =>
      createProviderFromConfig(config, apiKey, {
        http,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        connectTimeoutMs: PROVIDER_CONNECTION_TIMEOUT_MS,
      }),
  })
}

/** Binds the resume use cases to the database, the library and the measurer. */
function createResumeRuntime(input: {
  readonly database: ManagedSqlDatabase
  readonly resumes: SqliteResumeRepository
  readonly entries: SqliteInfoEntryRepository
  readonly customModules: SqliteCustomModuleRepository
  readonly updateInfoEntry: ReturnType<typeof createInfoService>['updateEntry']
  readonly measurer: TextMeasurer
  readonly clock: Clock
  readonly ids: IdGenerator
}): ReturnType<typeof createResumeService> {
  return createResumeService({
    resumes: input.resumes,
    entries: input.entries,
    customModules: input.customModules,
    jobPostings: new SqliteJobPostingRepository(input.database),
    attachments: new SqliteAttachmentRepository(input.database),
    updateInfoEntry: input.updateInfoEntry,
    measurer: input.measurer,
    clock: input.clock,
    ids: input.ids,
  })
}

/** The port implementations one native root owns for its whole lifetime. */
interface RootRepositories {
  readonly settings: SqliteAppSettingsRepository
  readonly customModules: SqliteCustomModuleRepository
  readonly entries: SqliteInfoEntryRepository
  readonly changes: SqliteChangeRecordRepository
  readonly resumes: SqliteResumeRepository
  readonly providerConfigs: SqliteProviderConfigRepository
  readonly secrets: StrongholdSecretStore
}

function createRootRepositories(input: {
  readonly database: ManagedSqlDatabase
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly stronghold: CompositionRootOptions['stronghold']
}): RootRepositories {
  const customModules = new SqliteCustomModuleRepository(input.database)
  return {
    settings: new SqliteAppSettingsRepository(input.database, input.clock),
    customModules,
    entries: new SqliteInfoEntryRepository(input.database, customModules),
    changes: new SqliteChangeRecordRepository(input.database),
    resumes: new SqliteResumeRepository(input.database, input.clock, input.ids),
    providerConfigs: new SqliteProviderConfigRepository(input.database),
    secrets: new StrongholdSecretStore(input.stronghold),
  }
}

/** The library and the resume capabilities, bound to the same repository set. */
function createLibraryRuntime(input: {
  readonly database: ManagedSqlDatabase
  readonly repositories: RootRepositories
  readonly measurer: TextMeasurer
  readonly clock: Clock
  readonly ids: IdGenerator
}): Pick<CompositionRoot, 'info' | 'resume' | 'libraryChanges'> {
  const info = createInfoService({
    entries: input.repositories.entries,
    customModules: input.repositories.customModules,
    references: new ResumeEntryReferences(input.repositories.resumes),
    clock: input.clock,
    ids: input.ids,
  })
  return {
    info,
    resume: createResumeRuntime({
      database: input.database,
      resumes: input.repositories.resumes,
      entries: input.repositories.entries,
      customModules: input.repositories.customModules,
      updateInfoEntry: info.updateEntry,
      measurer: input.measurer,
      clock: input.clock,
      ids: input.ids,
    }),
    libraryChanges: createLibraryChangesService({
      changes: input.repositories.changes,
      entries: input.repositories.entries,
      customModules: input.repositories.customModules,
      resumes: input.repositories.resumes,
      clock: input.clock,
    }),
  }
}

/** The conversation capability and the provider settings that select its model. */
async function createAgentRuntime(input: {
  readonly conversationRepositories: ConversationRepositories
  readonly repositories: RootRepositories
  readonly measuredLibrary: Omit<ConversationLibrary, 'measurer'>
  readonly measurer: TextMeasurer
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly pdfExporter: ResumePdfExporter
  readonly pdfSaver: PdfFileSaver
}): Promise<Pick<CompositionRoot, 'conversation' | 'providers'>> {
  const conversation = await createConversationRuntime({
    repositories: input.conversationRepositories,
    providerConfigs: input.repositories.providerConfigs,
    secrets: input.repositories.secrets,
    measuredLibrary: input.measuredLibrary,
    measurer: input.measurer,
    clock: input.clock,
    ids: input.ids,
    pdfExporter: input.pdfExporter,
    pdfSaver: input.pdfSaver,
  })
  const providers = createProviderRuntime({
    providers: input.repositories.providerConfigs,
    settings: input.repositories.settings,
    secrets: input.repositories.secrets,
    clock: input.clock,
    ids: input.ids,
  })
  return { conversation, providers }
}

export async function createCompositionRoot(
  options: CompositionRootOptions,
): Promise<CompositionRoot> {
  const clock: Clock = new SystemClock()
  const { measurer, fonts } = await createCanvasMeasurement()
  // The renderer package is imported on the first export rather than here, so
  // starting the window does not download the PDF chunk.
  const pdfExporter: ResumePdfExporter = createPdfExporter(fonts)
  const pdfSaver: PdfFileSaver = new TauriPdfFileSaver()
  const database = await startLocalDatabase({
    backupBeforeMigration: recordPreMigrationBackup,
    openDatabase: () => openSqliteDatabase(options.databaseConnectionString),
  })

  try {
    const ids = new RandomIdGenerator()
    const repositories = createRootRepositories({
      database,
      clock,
      ids,
      stronghold: options.stronghold,
    })
    const fileStore = new TauriAttachmentStore()
    const conversationRepositories = createConversationRepositories(database, fileStore)
    const measuredLibrary: Omit<ConversationLibrary, 'measurer'> = {
      entries: repositories.entries,
      customModules: repositories.customModules,
      references: new ResumeEntryReferences(repositories.resumes),
      resumes: repositories.resumes,
      changes: repositories.changes,
    }
    const agent = await createAgentRuntime({
      conversationRepositories,
      repositories,
      measuredLibrary,
      measurer,
      clock,
      ids,
      pdfExporter,
      pdfSaver,
    })
    const library = createLibraryRuntime({ database, repositories, measurer, clock, ids })
    const pdfExport = createExportService({
      resumes: repositories.resumes,
      entries: repositories.entries,
      customModules: repositories.customModules,
      measurer,
      exporter: pdfExporter,
      saver: pdfSaver,
      attachments: conversationRepositories.attachments,
      fileStore,
    })
    const seed = createSeedDataService({
      settings: repositories.settings,
      info: library.info,
      resume: library.resume,
      conversation: agent.conversation,
      messages: conversationRepositories.messages,
      clock,
    })
    const backup = createBackupService({
      canManageData: true,
      backup: new SqliteBackupStore(database),
      files: fileStore,
      secrets: repositories.secrets,
      clock,
    })
    return {
      appInfo: describeAppInfo({ runtime: 'tauri', databaseFile: await resolveDatabaseFile() }),
      settings: createAppSettingsService({ repository: repositories.settings }),
      backup,
      seed,
      ...library,
      ...agent,
      export: pdfExport,
      secrets: repositories.secrets,
      shutdown: async (): Promise<void> => {
        await database.close()
      },
    }
  } catch (failure) {
    // The root never reached the caller, so no one else can release the claim.
    await database.close()
    throw failure
  }
}
