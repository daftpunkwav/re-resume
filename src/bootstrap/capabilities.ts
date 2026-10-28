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
import type {
  AddCanvasBlockInput,
  AddCanvasBlockOutput,
} from '../application/resume/addCanvasBlock'
import type {
  CheckLayoutOverflowInput,
  CheckLayoutOverflowOutput,
} from '../application/resume/checkLayoutOverflow'
import type {
  CreateResumeInput,
  CreateResumeOutput,
} from '../application/resume/createResume'
import type {
  DeleteOverrideInput,
  DeleteOverrideOutput,
} from '../application/resume/deleteOverride'
import type {
  DuplicateResumeInput,
  DuplicateResumeOutput,
} from '../application/resume/duplicateResume'
import type { FindMissingReferencesInput } from '../application/resume/findMissingReferences'
import type { FreezeResumeOutput } from '../application/resume/freezeResume'
import type {
  MoveCanvasBlockInput,
  MoveCanvasBlockOutput,
} from '../application/resume/moveCanvasBlock'
import type {
  ReadMaterializedDocumentInput,
  ReadMaterializedDocumentOutput,
} from '../application/resume/readMaterializedDocument'
import type {
  RemoveCanvasBlockInput,
  RemoveCanvasBlockOutput,
} from '../application/resume/removeCanvasBlock'
import type {
  RemoveSectionInput,
  RemoveSectionOutput,
} from '../application/resume/removeSection'
import type { RenameResumeInput } from '../application/resume/renameResume'
import type {
  ResizeCanvasBlockInput,
  ResizeCanvasBlockOutput,
} from '../application/resume/resizeCanvasBlock'
import type {
  SaveOverrideToLibraryInput,
  SaveOverrideToLibraryOutput,
} from '../application/resume/saveOverrideToLibrary'
import type {
  SetAppearanceInput,
  SetAppearanceOutput,
} from '../application/resume/setAppearance'
import type {
  SetPageSetupInput,
  SetPageSetupOutput,
} from '../application/resume/setPageSetup'
import type {
  SetSectionDisplayInput,
  SetSectionDisplayOutput,
} from '../application/resume/setSectionDisplay'
import type {
  SetSectionOrderInput,
  SetSectionOrderOutput,
} from '../application/resume/setSectionOrder'
import type {
  SetSectionSelectionInput,
  SetSectionSelectionOutput,
} from '../application/resume/setSectionSelection'
import type { SetTemplateInput, SetTemplateOutput } from '../application/resume/setTemplate'
import type { UpdateResumeTargetInput } from '../application/resume/updateResumeTarget'
import type {
  WriteEntryOverrideInput,
  WriteEntryOverrideOutput,
} from '../application/resume/writeEntryOverride'
import type {
  WriteSummaryOverrideInput,
  WriteSummaryOverrideOutput,
} from '../application/resume/writeSummaryOverride'
import type { InfoEntryReference } from '../domain/info/ports/InfoEntryReferenceQuery'
import type { CustomModuleId, InfoEntryId } from '../domain/shared/branded-id'
import type { AppSettings } from '../domain/settings/AppSettings'
import type { ProviderConfig } from '../domain/settings/ProviderConfig'
import type { ChangeRecord } from '../domain/changes/ChangeRecord'
import type { ChangeRecordId, RevisionId } from '../domain/shared/branded-id'
import type { SecretStore } from '../domain/generation/ports/SecretStore'
import type { MissingReference } from '../domain/resume/MissingReference'
import type { Resume } from '../domain/resume/Resume'
import type { Revision } from '../domain/resume/Revision'
import type { TemplateDefinition } from '../domain/resume/Template'
import type { ResumeId } from '../domain/shared/branded-id'
import type {
  ListProvidersOutput,
  SavedProvider,
} from '../application/settings/providerConfiguration'
import type { SaveProviderInput } from '../application/settings/saveProvider'
import type { DeleteProviderInput } from '../application/settings/deleteProvider'
import type { SetActiveProviderInput } from '../application/settings/setActiveProvider'
import type {
  ProviderConnectionTestResult,
  TestProviderConnectionInput,
} from '../application/settings/testProviderConnection'
import type { BackupDocument, BackupImportSummary } from '../domain/backup/BackupDocument'
import type { ClearAllDataResult } from '../application/settings/clearAllData'
import type { CleanupOrphanAttachmentsResult } from '../application/settings/cleanupOrphanAttachments'
import type { SeedSampleDataOutput } from '../application/seed/seedSampleData'
import type { ConversationService } from './wiring/conversation'

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
 * Backup and data management. The browser preview uses memory and declares
 * `canManageData: false`, so the settings surface can state that limitation
 * instead of offering an action that cannot work there.
 */
export interface BackupService {
  readonly canManageData: boolean
  /** Builds the document from the current data; the file is written by the interface. */
  readonly exportDocument: () => Promise<BackupDocument>
  /** Validates without writing, for the confirmation before a restore. */
  readonly inspectDocument: (raw: unknown) => BackupImportSummary
  /** Validates and restores in one transaction. */
  readonly importDocument: (raw: unknown) => Promise<BackupImportSummary>
  /** Clears every table and the attachment files beside them. */
  readonly clearAllData: () => Promise<ClearAllDataResult>
  /** Removes attachment rows and files nothing refers to any more. */
  readonly cleanupOrphanAttachments: () => Promise<CleanupOrphanAttachmentsResult>
}

/** The sample library: one call that fills an empty window. */
export interface SeedDataService {
  readonly seedSampleData: () => Promise<SeedSampleDataOutput>
}

/**
 * The configured model services as the interface sees them. A credential is
 * never returned: saving stores it in the secure store, and the connection test
 * reports only whether the service answers and how long it took.
 */
export interface ProviderService {
  readonly listProviders: () => Promise<ListProvidersOutput>
  readonly saveProvider: (input: SaveProviderInput) => Promise<SavedProvider>
  readonly deleteProvider: (input: DeleteProviderInput) => Promise<void>
  readonly setActiveProvider: (input: SetActiveProviderInput) => Promise<ProviderConfig>
  readonly testProviderConnection: (
    input: TestProviderConnectionInput,
  ) => Promise<ProviderConnectionTestResult>
}

/**
 * The recorded writes the assistant performed and the user can take back. The
 * undo rules (not already undone, still the newest change of its entity) live in
 * the use case behind this facade.
 */
export interface LibraryChangesService {
  readonly undo: (input: { readonly changeId: ChangeRecordId }) => Promise<ChangeRecord>
  /**
   * Reverses one resume revision the assistant produced, while it is still the
   * cursor. A later write refuses with `changeOutOfOrder`.
   */
  readonly undoRevision: (input: {
    readonly resumeId: ResumeId
    readonly revisionId: RevisionId
  }) => Promise<{ readonly label: string }>
}

/**
 * The information library as the interface sees it: the library use cases,
 * already bound to their repositories, clock and identifier source, plus the
 * two reference reads a delete confirmation needs to name what still uses the
 * value. The facade hands out domain values and throws `DomainError` for a
 * refusal; it hides which storage answers.
 */
export interface InfoService {
  readonly listEntries: (input?: ListInfoEntriesInput) => Promise<ListInfoEntriesOutput>
  readonly searchEntries: (input: SearchInfoEntriesInput) => Promise<SearchInfoEntriesOutput>
  readonly createEntry: (input: CreateInfoEntryInput) => Promise<CreateInfoEntryOutput>
  readonly updateEntry: (input: UpdateInfoEntryInput) => Promise<UpdateInfoEntryOutput>
  readonly deleteEntry: (input: DeleteInfoEntryInput) => Promise<DeleteInfoEntryOutput>
  /**
   * Resumes that still select an entry. The delete use case reports the same
   * references when it refuses; this read lets the confirmation name the
   * resumes before the deletion is attempted.
   */
  readonly listEntryReferences: (entryId: InfoEntryId) => Promise<readonly InfoEntryReference[]>
  /** Resumes whose sections reference a custom module itself. */
  readonly listModuleReferences: (
    moduleId: CustomModuleId,
  ) => Promise<readonly InfoEntryReference[]>
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

/**
 * The resume document as the interface sees it: every document use case, already
 * bound to the store, the library, the measurer, the clock and the identifier
 * source. The facade hands out domain values and throws `DomainError` for a
 * refusal; it hides which storage answers.
 */
export interface ResumeService {
  readonly listResumes: () => Promise<readonly Resume[]>
  readonly listTemplates: () => readonly TemplateDefinition[]
  readonly createResume: (input: CreateResumeInput) => Promise<CreateResumeOutput>
  readonly duplicateResume: (input: DuplicateResumeInput) => Promise<DuplicateResumeOutput>
  readonly renameResume: (input: RenameResumeInput) => Promise<void>
  readonly deleteResume: (resumeId: ResumeId) => Promise<void>
  readonly updateResumeTarget: (input: UpdateResumeTargetInput) => Promise<void>
  readonly undo: (resumeId: ResumeId) => Promise<Revision>
  readonly redo: (resumeId: ResumeId) => Promise<Revision>
  readonly setSectionSelection: (
    input: SetSectionSelectionInput,
  ) => Promise<SetSectionSelectionOutput>
  readonly setSectionOrder: (input: SetSectionOrderInput) => Promise<SetSectionOrderOutput>
  readonly setSectionDisplay: (
    input: SetSectionDisplayInput,
  ) => Promise<SetSectionDisplayOutput>
  readonly removeSection: (input: RemoveSectionInput) => Promise<RemoveSectionOutput>
  readonly writeSummaryOverride: (
    input: WriteSummaryOverrideInput,
  ) => Promise<WriteSummaryOverrideOutput>
  readonly writeEntryOverride: (
    input: WriteEntryOverrideInput,
  ) => Promise<WriteEntryOverrideOutput>
  readonly deleteOverride: (input: DeleteOverrideInput) => Promise<DeleteOverrideOutput>
  readonly saveOverrideToLibrary: (
    input: SaveOverrideToLibraryInput,
  ) => Promise<SaveOverrideToLibraryOutput>
  readonly setTemplate: (input: SetTemplateInput) => Promise<SetTemplateOutput>
  readonly setAppearance: (input: SetAppearanceInput) => Promise<SetAppearanceOutput>
  readonly setPageSetup: (input: SetPageSetupInput) => Promise<SetPageSetupOutput>
  readonly addCanvasBlock: (input: AddCanvasBlockInput) => Promise<AddCanvasBlockOutput>
  readonly moveCanvasBlock: (input: MoveCanvasBlockInput) => Promise<MoveCanvasBlockOutput>
  readonly resizeCanvasBlock: (
    input: ResizeCanvasBlockInput,
  ) => Promise<ResizeCanvasBlockOutput>
  readonly removeCanvasBlock: (
    input: RemoveCanvasBlockInput,
  ) => Promise<RemoveCanvasBlockOutput>
  readonly materializeDocument: (
    input: ReadMaterializedDocumentInput,
  ) => Promise<ReadMaterializedDocumentOutput>
  readonly findMissingReferences: (
    input: FindMissingReferencesInput,
  ) => Promise<readonly MissingReference[]>
  readonly checkLayoutOverflow: (
    input: CheckLayoutOverflowInput,
  ) => Promise<CheckLayoutOverflowOutput>
  readonly freezeResume: (resumeId: ResumeId) => Promise<FreezeResumeOutput>
}

export interface CompositionRoot {
  readonly appInfo: AppInfo
  readonly settings: AppSettingsService
  /** Backup export, import, clear-all and the orphan attachment sweep. */
  readonly backup: BackupService
  /** The sample data an empty window can import once. */
  readonly seed: SeedDataService
  /** Conversations, messages, attachments and the agent run of one turn. */
  readonly conversation: ConversationService
  readonly info: InfoService
  readonly resume: ResumeService
  /** Configured model services and the one serving requests. */
  readonly providers: ProviderService
  /** Reversal of the library writes the assistant performed. */
  readonly libraryChanges: LibraryChangesService
  /**
   * The encrypted credential store. The interface reaches it through the
   * provider settings once those exist; the root owns the handle so the window
   * never names the native store itself.
   */
  readonly secrets: SecretStore
  /** Releases this root's claim on the shared database. */
  readonly shutdown: () => Promise<void>
}
