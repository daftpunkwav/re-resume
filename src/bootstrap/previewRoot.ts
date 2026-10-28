/**
 * @file previewRoot
 * @description The composition root used by the browser preview. It answers
 * the same contract as the native root, backed by memory instead of SQLite, so
 * the interface needs no preview branch of its own.
 *
 * Responsibilities:
 * - Seed one memory state: the fixture information library, the fixture resumes,
 *   the scripted conversations and their recorded tool calls
 * - Assemble the conversation, library and resume services over that same state,
 *   so a tool call the assistant makes is visible to both panels
 * - Answer the library's reference question from the in-memory resumes
 * - Measure with the fixture measurer, never the bundled fonts
 *
 * Constraints:
 * - Only loaded when the window is served in development with `?preview`; the
 *   production bundle does not contain this module.
 * - `?script=slow|failure` chooses the replay the scripted model uses; the
 *   default replay is the end-to-end tool chain.
 */

import type { AppSettingsRepository } from '../domain/settings/ports/AppSettingsRepository'
import type { SecretStore } from '../domain/generation/ports/SecretStore'
import type { CompositionRoot, ProviderService } from './capabilities'
import { describeAppInfo } from './buildInfo'
import { createAppSettingsService, createBackupService } from './wiring/appSettings'
import { createSeedDataService } from './wiring/seed'
import { createInfoService } from './wiring/info'
import { createResumeService } from './wiring/resume'
import { createExportService } from './wiring/export'
import { createLibraryChangesService } from './wiring/changes'
import { createProviderService } from './wiring/providers'
import {
  InMemoryAppSettingsRepository,
  InMemoryProviderConfigRepository,
  InMemorySecretStore,
} from '../infrastructure/preview/inMemoryRepositories'
import { FakeClock, SequentialIdGenerator } from '../infrastructure/preview/deterministicEnvironment'
import { ResumeEntryReferences } from '../infrastructure/persistence/resume/ResumeEntryReferences'
import {
  PREVIEW_PROBE_SCRIPT,
  PREVIEW_PROVIDER_CREDENTIAL,
  PREVIEW_PROVIDERS,
  PREVIEW_SETTINGS,
} from '../infrastructure/preview/fixtures'
import {
  PREVIEW_CONVERSATION_SCRIPT,
  PREVIEW_FAILURE_MESSAGE,
  PREVIEW_FAILURE_SCRIPT,
  PREVIEW_SLOW_SCRIPT,
  PREVIEW_TOOL_CHAIN_TURNS,
} from '../infrastructure/preview/fixtures.conversation'
import { ScriptedModelProvider } from '../infrastructure/preview/ScriptedModelProvider'
import { createPreviewConversationService } from './previewConversation'
import type { PreviewConversationOptions, PreviewConversationState } from './previewConversation'

/** The replay selected by `?script=`; the default replay is the tool chain. */
function readReplay(): PreviewConversationOptions {
  if (typeof window === 'undefined') return { turns: PREVIEW_TOOL_CHAIN_TURNS }
  const script = new URLSearchParams(window.location.search).get('script')
  switch (script) {
    case 'slow':
      return { script: PREVIEW_SLOW_SCRIPT, pauseMs: 420 }
    case 'failure':
      return {
        script: PREVIEW_FAILURE_SCRIPT,
        pauseMs: 160,
        failure: {
          message: PREVIEW_FAILURE_MESSAGE,
          retryable: true,
          status: 503,
          afterChunks: PREVIEW_FAILURE_SCRIPT.length,
        },
      }
    case 'plain':
      return { script: PREVIEW_CONVERSATION_SCRIPT }
    // The tool chain at a human pace, so the panels can be watched while the
    // assistant writes; the default replay runs the same chain without pauses.
    case 'tools':
      return { turns: PREVIEW_TOOL_CHAIN_TURNS, pauseMs: 500 }
    default:
      return { turns: PREVIEW_TOOL_CHAIN_TURNS }
  }
}

/**
 * The preview variant without a configured model service. The empty-state
 * warning and its actions are taller than the configured welcome, so the layout
 * needs a fixture that exercises them; `?providers=none` selects it.
 */
function readUnconfiguredProviders(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('providers') === 'none'
}

/** The library and resume capabilities over the shared preview state. */
function createPreviewLibraryServices(state: PreviewConversationState): {
  readonly info: CompositionRoot['info']
  readonly resume: CompositionRoot['resume']
  readonly libraryChanges: CompositionRoot['libraryChanges']
  readonly export: CompositionRoot['export']
} {
  const info = createInfoService({
    entries: state.entries,
    customModules: state.customModules,
    references: new ResumeEntryReferences(state.resumes),
    clock: state.clock,
    ids: new SequentialIdGenerator('preview-info'),
  })
  return {
    info,
    resume: createResumeService({
      resumes: state.resumes,
      entries: state.entries,
      customModules: state.customModules,
      jobPostings: state.jobPostings,
      attachments: state.attachments,
      updateInfoEntry: info.updateEntry,
      measurer: state.measurer,
      clock: new FakeClock(),
      ids: new SequentialIdGenerator('preview-resume'),
    }),
    libraryChanges: createLibraryChangesService({
      changes: state.changes,
      entries: state.entries,
      customModules: state.customModules,
      resumes: state.resumes,
      clock: state.clock,
    }),
    // The preview renders with the real bundled fonts (loaded on first use) and
    // saves through the browser's download list instead of a native dialog.
    export: createExportService({
      resumes: state.resumes,
      entries: state.entries,
      customModules: state.customModules,
      measurer: state.measurer,
      exporter: state.pdfExporter,
      saver: state.pdfSaver,
      attachments: state.attachments,
      fileStore: state.fileStore,
    }),
  }
}

function createPreviewProviders(deps: {
  readonly settings: AppSettingsRepository
  readonly secrets: SecretStore
  readonly unconfigured: boolean
}): ProviderService {
  const providers = new InMemoryProviderConfigRepository(
    deps.unconfigured ? [] : PREVIEW_PROVIDERS,
  )
  const clock = new FakeClock()
  const ids = new SequentialIdGenerator('preview-provider')
  return createProviderService({
    providers,
    settings: deps.settings,
    secrets: deps.secrets,
    clock,
    ids,
    // The preview has no network. The probe replays one frame, which is what a
    // reachable endpoint would deliver, so the connection state is rendered
    // truthfully for the harness even though no socket is opened.
    createProvider: () =>
      new ScriptedModelProvider({ id: 'preview-probe', script: PREVIEW_PROBE_SCRIPT }),
  })
}

/** The memory state a preview window keeps across a settings rebuild. */
interface PreviewState {
  readonly settings: InMemoryAppSettingsRepository
  readonly secrets: InMemorySecretStore
  readonly conversation: CompositionRoot['conversation']
  readonly info: CompositionRoot['info']
  readonly resume: CompositionRoot['resume']
  readonly libraryChanges: CompositionRoot['libraryChanges']
  readonly export: CompositionRoot['export']
  readonly providers: ProviderService
  readonly seed: CompositionRoot['seed']
}

let windowState: PreviewState | null = null

function createPreviewState(): PreviewState {
  const unconfigured = readUnconfiguredProviders()
  const settings = new InMemoryAppSettingsRepository(
    unconfigured ? { ...PREVIEW_SETTINGS, activeProviderId: null } : PREVIEW_SETTINGS,
  )
  const secrets = new InMemorySecretStore(
    unconfigured
      ? []
      : PREVIEW_PROVIDERS.map((config) => [config.secretRef, PREVIEW_PROVIDER_CREDENTIAL] as const),
  )
  const conversation = createPreviewConversationService(readReplay())
  const library = createPreviewLibraryServices(conversation.state)
  return {
    settings,
    secrets,
    conversation: conversation.service,
    info: library.info,
    resume: library.resume,
    libraryChanges: library.libraryChanges,
    export: library.export,
    providers: createPreviewProviders({ settings, secrets, unconfigured }),
    seed: createSeedDataService({
      settings,
      info: library.info,
      resume: library.resume,
      conversation: conversation.service,
      messages: conversation.state.messages,
      clock: conversation.state.clock,
    }),
  }
}

export interface PreviewRootOptions {
  /**
   * Keep the memory state across roots. The preview window sets this so a
   * settings rebuild behaves like the native window, whose database survives the
   * rebuild; a fresh call (a screenshot harness, a test) gets its own state.
   */
  readonly preserveState?: boolean
}

export function createPreviewRoot(options: PreviewRootOptions = {}): CompositionRoot {
  if (options.preserveState === true) windowState ??= createPreviewState()
  const state = windowState ?? createPreviewState()
  return {
    appInfo: describeAppInfo({ runtime: 'browser', databaseFile: null }),
    settings: createAppSettingsService({ repository: state.settings }),
    // Memory data has no file to export and nothing to clear on disk. The
    // settings surface reads this flag and states the limitation instead of
    // showing an export button that cannot produce a backup.
    backup: createBackupService({
      canManageData: false,
      secrets: state.secrets,
      backup: {
        dumpTables: async () => ({}),
        replaceAll: async () => undefined,
        clearAll: async () => undefined,
        listOrphanAttachments: async () => [],
        deleteAttachments: async () => undefined,
        listAttachmentStorageNames: async () => [],
        listProviderSecretRefs: async () => [],
      },
      files: {
        write: async () => undefined,
        read: async () => new Uint8Array(),
        delete: async () => undefined,
        list: async () => [],
      },
      clock: new FakeClock(),
    }),
    seed: state.seed,
    info: state.info,
    resume: state.resume,
    conversation: state.conversation,
    providers: state.providers,
    libraryChanges: state.libraryChanges,
    export: state.export,
    secrets: state.secrets,
    shutdown: async (): Promise<void> => undefined,
  }
}
