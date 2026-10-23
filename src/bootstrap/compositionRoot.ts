/**
 * @file compositionRoot
 * @description The one module allowed to construct infrastructure and hand it
 * to application use cases. Everything below `presentation/` receives ready to
 * call services and never sees a repository, a SQL string or a provider.
 *
 * Responsibilities:
 * - Open the database connection and run the startup check that guards it
 * - Construct the port implementations and inject them into the use cases
 * - Bind the canonical TextMeasurer to layout() and to the agent's layout check
 * - Release the claim on the shared database on shutdown
 *
 * Constraints:
 * - This module must not import from `presentation/`: the dependency points
 *   one way, and the UI receives this contract rather than the reverse.
 * - No business rule lives here. A rule stated below belongs in a use case;
 *   this file only decides which implementation each port receives.
 */

import type { Clock } from '../domain/shared/Clock'
import type { Experience } from '../domain/catalog/Experience'
import type { Profile } from '../domain/catalog/Profile'
import type { ExperienceRepository } from '../domain/catalog/ports/ExperienceRepository'
import type { ResumeRepository } from '../domain/resume/ports/ResumeRepository'
import type { ProfileRepository } from '../domain/catalog/ports/ProfileRepository'
import type { IdGenerator } from '../domain/shared/IdGenerator'
import type { Result } from '../domain/shared/Result'
import type { AgentRunId } from '../domain/shared/branded-id'
import type {
  ClaimId,
  ExperienceId,
  JobPostingId,
  ResumeId,
  VariantId,
} from '../domain/shared/branded-id'
import type { Resume } from '../domain/resume/Resume'
import type { Revision } from '../domain/resume/Revision'
import type { DocumentChange } from '../domain/resume/DocumentChange'
import type { PageSetup } from '../domain/resume/PageSetup'
import type { LayoutInput, LayoutOutput } from '../domain/resume/PageLayout'
import type { MaterializedBlock, ResumeSnapshot } from '../domain/resume/ResumeSnapshot'
import type { TextMeasurer } from '../domain/resume/ports/TextMeasurer'
import type { AgentRun } from '../domain/generation/AgentRun'
import type { ModelChunk, ModelProvider, ToolSchema } from '../domain/generation/ports/ModelProvider'
import type { SecretStore } from '../domain/generation/ports/SecretStore'
import type { ToolContext } from '../domain/generation/ports/ToolRegistry'

import { SystemClock } from '../infrastructure/platform/systemClock'
import { RandomIdGenerator } from '../infrastructure/platform/randomIdGenerator'
import { openSqliteDatabase } from '../infrastructure/persistence/sqlite'
import type { ManagedSqlDatabase, SqlDatabase } from '../infrastructure/persistence/sqlite'
import { SqliteExperienceRepository } from '../infrastructure/persistence/SqliteExperienceRepository'
import { SqliteProfileRepository } from '../infrastructure/persistence/SqliteProfileRepository'
import { SqliteResumeRepository } from '../infrastructure/persistence/SqliteResumeRepository'
import { SqliteAgentRunRepository } from '../infrastructure/persistence/SqliteAgentRunRepository'
import { SqliteJobPostingRepository } from '../infrastructure/persistence/SqliteJobPostingRepository'
import { StrongholdSecretStore } from '../infrastructure/security/StrongholdSecretStore'
import type { StrongholdSecretStoreOptions } from '../infrastructure/security/StrongholdSecretStore'
import { loadBundledFontRegistry } from '../infrastructure/measurement/BundledFontRegistry'
import { registerCanvasFonts } from '../infrastructure/measurement/CanvasFontRegistration'
import { createFontkitTextMeasurer } from '../infrastructure/measurement/FontkitTextMeasurer'
import { createTauriHttpClient } from '../infrastructure/http/TauriHttpClient'
import { AnthropicProvider } from '../infrastructure/http/ProviderAdapters/AnthropicProvider'
import { OpenAiCompatibleProvider } from '../infrastructure/http/ProviderAdapters/OpenAiCompatibleProvider'

import { createExperience } from '../application/experience/CreateExperience'
import type { CreateExperienceCommand } from '../application/experience/CreateExperience'
import { updateExperienceFact } from '../application/experience/UpdateExperienceFact'
import type { UpdateExperienceFactCommand } from '../application/experience/UpdateExperienceFact'
import { deleteExperience } from '../application/experience/DeleteExperience'
import { addVariant } from '../application/experience/AddVariant'
import type { AddVariantCommand } from '../application/experience/AddVariant'
import { updateVariant } from '../application/experience/UpdateVariant'
import type { UpdateVariantCommand } from '../application/experience/UpdateVariant'
import { removeVariant } from '../application/experience/RemoveVariant'
import { confirmVariant } from '../application/experience/ConfirmVariant'
import { addClaim } from '../application/experience/AddClaim'
import type { AddClaimCommand } from '../application/experience/AddClaim'
import { confirmClaim } from '../application/experience/ConfirmClaim'
import { rejectClaim } from '../application/experience/RejectClaim'
import { reopenClaim } from '../application/experience/ReopenClaim'
import { updateProfile } from '../application/profile/UpdateProfile'
import type { UpdateProfileCommand } from '../application/profile/UpdateProfile'
import { createResume } from '../application/resume/CreateResume'
import type { CreateResumeInput, ResumeCreation } from '../application/resume/CreateResume'
import { duplicateResume } from '../application/resume/DuplicateResume'
import type { DuplicateResumeInput } from '../application/resume/DuplicateResume'
import { commitDocumentChange } from '../application/resume/CommitDocumentChange'
import { undoDocumentChange } from '../application/resume/UndoDocumentChange'
import { redoDocumentChange } from '../application/resume/RedoDocumentChange'
import { freezeResume } from '../application/resume/FreezeResume'
import { compareVersions } from '../application/resume/CompareVersions'
import type { VersionDiff, VersionSelector } from '../application/resume/CompareVersions'
import { detectStaleReferences } from '../application/resume/DetectStaleReferences'
import type { StaleReference } from '../application/resume/DetectStaleReferences'
import { materializeBlocks } from '../application/resume/materializeBlocks'
import { layout } from '../application/layout/layout'
import { runAgentTask } from '../application/generation/RunAgentTask'
import { buildToolRegistry } from '../application/generation/buildToolRegistry'
import type { ToolInvocationRecorder } from '../application/generation/ApproveToolInvocation'
import { parseJobPosting } from '../application/generation/ParseJobPosting'
import type {
  JobPostingRepository,
  ParseJobPostingCommand,
  ParsedJobPostingOutcome,
} from '../application/generation/ParseJobPosting'

export type { CreateExperienceCommand } from '../application/experience/CreateExperience'
export type { UpdateExperienceFactCommand } from '../application/experience/UpdateExperienceFact'
export type { AddVariantCommand } from '../application/experience/AddVariant'
export type { UpdateVariantCommand } from '../application/experience/UpdateVariant'
export type { AddClaimCommand } from '../application/experience/AddClaim'
export type { UpdateProfileCommand } from '../application/profile/UpdateProfile'
export type { CreateResumeInput } from '../application/resume/CreateResume'
export type { DuplicateResumeInput } from '../application/resume/DuplicateResume'
export type { VersionDiff, VersionSelector } from '../application/resume/CompareVersions'
export type { StaleReference } from '../application/resume/DetectStaleReferences'
export type { ParseJobPostingCommand, ParsedJobPostingOutcome } from '../application/generation/ParseJobPosting'

export interface ExperienceLibrary {
  list(): Promise<readonly Experience[]>
  get(id: ExperienceId): Promise<Experience | null>
  create(command: CreateExperienceCommand): Promise<Result<Experience, unknown>>
  updateFact(command: UpdateExperienceFactCommand): Promise<Result<Experience, unknown>>
  remove(id: ExperienceId): Promise<void>
  addVariant(command: AddVariantCommand): Promise<Result<Experience, unknown>>
  updateVariant(command: UpdateVariantCommand): Promise<Result<Experience, unknown>>
  removeVariant(experienceId: ExperienceId, variantId: VariantId): Promise<void>
  confirmVariant(experienceId: ExperienceId, variantId: VariantId): Promise<Experience>
  addClaim(command: AddClaimCommand): Promise<Result<Experience, unknown>>
  confirmClaim(experienceId: ExperienceId, claimId: ClaimId): Promise<Experience>
  rejectClaim(experienceId: ExperienceId, claimId: ClaimId): Promise<Experience>
  reopenClaim(experienceId: ExperienceId, claimId: ClaimId): Promise<Experience>
}

export interface ProfileSettings {
  get(): Promise<Profile>
  update(command: UpdateProfileCommand): Promise<Result<Profile, unknown>>
}

export interface ResumeWorkbench {
  list(): Promise<readonly Resume[]>
  get(id: ResumeId): Promise<Resume | null>
  create(input: CreateResumeInput): Promise<ResumeId>
  duplicate(input: DuplicateResumeInput): Promise<ResumeId>
  /** The single write path into Resume.blocks. */
  commit(resumeId: ResumeId, change: DocumentChange): Promise<Revision>
  undo(resumeId: ResumeId): Promise<Revision>
  redo(resumeId: ResumeId): Promise<Revision>
  freeze(resumeId: ResumeId): Promise<ResumeSnapshot>
  compare(from: VersionSelector, to: VersionSelector): Promise<VersionDiff>
  /** Resolves live references so the canvas, export and the layout check share one input shape. */
  materialize(resumeId: ResumeId): Promise<readonly MaterializedBlock[]>
  /** Pure: pagination and overflow for an already-materialized document. */
  layOut(blocks: readonly MaterializedBlock[], page: PageSetup): LayoutOutput
  /** Derived on demand; never persisted. */
  staleReferences(
    experienceId: ExperienceId,
    knownFactVersion: number,
  ): Promise<readonly StaleReference[]>
}

/**
 * What one agent run needs from its caller. The sink and the cancellation
 * signal are declared here rather than owned by the console: the run loop
 * streams deltas and polls for cancellation between turns, and only the caller
 * knows where that text goes and when the user stopped waiting.
 */
export interface AgentTaskRequest {
  readonly prompt: string
  readonly system?: string | null
  readonly resumeId?: ResumeId | null
  readonly jobPostingId?: JobPostingId | null
  /** Called once per streamed text delta. */
  readonly onTextDelta: (delta: string) => void
  /** Polled before every model turn and before every tool call. */
  readonly isCancelled: () => boolean
}

/**
 * The run is the outcome. runAgentTask records a model failure, a malformed
 * tool call and a cancellation on the run itself — status and errorText — rather
 * than throwing, so the caller reads the result off the returned row.
 */
export type AgentTaskOutcome = AgentRun

export interface AgentConsole {
  toolSchemas(): readonly ToolSchema[]
  run(request: AgentTaskRequest): Promise<AgentTaskOutcome>
  parseJobPosting(
    command: ParseJobPostingCommand,
  ): Promise<Result<ParsedJobPostingOutcome, unknown>>
}

export interface CompositionRoot {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly experiences: ExperienceLibrary
  readonly profile: ProfileSettings
  readonly resumes: ResumeWorkbench
  readonly agent: AgentConsole
  /** Releases this root's claim on the shared database. */
  shutdown(): Promise<void>
}

/** Plain configuration for one model service. No behaviour, no secrets. */
export type ProviderDescriptor =
  | {
      readonly kind: 'openai-compatible'
      readonly id: string
      readonly modelId: string
      /** Endpoint root, for example https://api.openai.com/v1 */
      readonly baseUrl: string
      /** SecretStore key holding the API key for this endpoint. */
      readonly apiKeyRef: string
    }
  | {
      readonly kind: 'anthropic'
      readonly id: string
      readonly modelId: string
      /** Endpoint root, for example https://api.anthropic.com */
      readonly baseUrl: string
      /** SecretStore key holding the API key for this endpoint. */
      readonly apiKeyRef: string
    }

export interface CompositionRootOptions {
  /** Connection string handed to the SQL plugin verbatim. */
  readonly databaseConnectionString: string
  /** Stronghold snapshot path and unlock password; the password is never persisted. */
  readonly stronghold: StrongholdSecretStoreOptions
  /**
   * Which model service to talk to, or null when none is configured yet. The
   * adapter is built here, not by the caller: constructing one means importing
   * an infrastructure module, and the only directory allowed to do that is
   * this one. Null does not disable the application — only the agent
   * console, which reports that no provider is configured when it is used.
   */
  readonly provider: ProviderDescriptor | null
}

/** Everything the service factories below share, resolved once per root. */
interface Wiring {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly database: SqlDatabase
  readonly measurer: TextMeasurer
  readonly experienceRepo: ExperienceRepository
  readonly profileRepo: ProfileRepository
  /** The port plus the creation capability CreateResume and DuplicateResume declare. */
  readonly resumeRepo: ResumeRepository & ResumeCreation
  readonly runRepo: SqliteAgentRunRepository
  readonly secretStore: SecretStore
  readonly provider: ModelProvider
  readonly providerSecretRefs: readonly string[]
  readonly jobPostings: JobPostingRepository
}

/**
 * Runs a startup step that can fail after the database was opened. The
 * database is shared with the other roots of this process, and a root that
 * never reaches the caller cannot hand its claim back through shutdown(): the
 * claim goes back here, where the failure is.
 */
async function duringStartup<T>(
  database: ManagedSqlDatabase,
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step()
  } catch (failure) {
    // The claim goes back, and the failure that ended the boot is the one worth
    // reporting: a cleanup that fails as well is named beside it.
    try {
      await database.close()
    } catch (cleanupFailure) {
      throw new Error(
        'The startup step failed and releasing the database claim failed with it: ' +
          (cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure)),
        { cause: failure },
      )
    }
    throw failure
  }
}

/**
 * Builds the one application container: the infrastructure the use cases need,
 * wired to the ports they declare. Every startup step that can fail after the
 * database was opened releases its claim on the way out, so a boot that ends in
 * failure leaves no claim behind.
 */
export async function createCompositionRoot(
  options: CompositionRootOptions,
): Promise<CompositionRoot> {
  const clock: Clock = new SystemClock()
  const ids: IdGenerator = new RandomIdGenerator()
  // Fonts come before the database: they depend on nothing below, and a font
  // failure must not leave an opened connection behind — the caller only
  // receives a root, and with it shutdown(), once every startup step passed.
  const fontRegistry = await loadBundledFontRegistry()
  await registerCanvasFonts(fontRegistry)
  const database = requireManagedDatabase(
    await openSqliteDatabase(options.databaseConnectionString),
  )
  // Startup check: every ON DELETE CASCADE and ON DELETE RESTRICT clause in
  // the schema is inert until this reports 1, so the repositories refuse to run.
  await duringStartup(database, () => database.enableForeignKeys())

  const secretStore = new StrongholdSecretStore(options.stronghold)
  const provider = await duringStartup(database, () =>
    buildProvider(options.provider, secretStore),
  )
  const wiring: Wiring = {
    clock,
    ids,
    database,
    measurer: createFontkitTextMeasurer(fontRegistry),
    experienceRepo: new SqliteExperienceRepository(database),
    profileRepo: new SqliteProfileRepository(database),
    resumeRepo: new SqliteResumeRepository(database, clock, ids),
    runRepo: new SqliteAgentRunRepository(database),
    secretStore,
    provider,
    providerSecretRefs:
      options.provider === null ? [] : [options.provider.apiKeyRef],
    jobPostings: new SqliteJobPostingRepository(database),
  }

  return {
    clock,
    ids,
    experiences: buildExperienceLibrary(wiring),
    profile: buildProfileSettings(wiring),
    resumes: buildResumeWorkbench(wiring),
    agent: buildAgentConsole(wiring),
    shutdown: async (): Promise<void> => {
      await database.close()
    },
  }
}

function buildExperienceLibrary(wiring: Wiring): ExperienceLibrary {
  const writeDeps = { experienceRepo: wiring.experienceRepo, clock: wiring.clock }
  const createDeps = { ...writeDeps, ids: wiring.ids }
  // deleteExperience and removeVariant refuse a removal that a resume block
  // still points at, which is why the resume repository is reachable here.
  const deleteDeps = {
    experienceRepo: wiring.experienceRepo,
    resumeRepo: wiring.resumeRepo,
  }
  const removeVariantDeps = { ...deleteDeps, clock: wiring.clock }
  return {
    list: () => wiring.experienceRepo.listAll(),
    get: (id) => wiring.experienceRepo.findById(id),
    create: (command) => createExperience(createDeps, command),
    updateFact: (command) => updateExperienceFact(writeDeps, command),
    remove: (id) => deleteExperience(deleteDeps, id),
    addVariant: (command) => addVariant(createDeps, command),
    updateVariant: (command) => updateVariant(writeDeps, command),
    removeVariant: (experienceId, variantId) =>
      removeVariant(removeVariantDeps, experienceId, variantId),
    confirmVariant: (experienceId, variantId) =>
      confirmVariant(writeDeps, experienceId, variantId),
    addClaim: (command) => addClaim(createDeps, command),
    confirmClaim: (experienceId, claimId) => confirmClaim(writeDeps, experienceId, claimId),
    rejectClaim: (experienceId, claimId) => rejectClaim(writeDeps, experienceId, claimId),
    reopenClaim: (experienceId, claimId) => reopenClaim(writeDeps, experienceId, claimId),
  }
}

function buildProfileSettings(wiring: Wiring): ProfileSettings {
  const deps = { profileRepo: wiring.profileRepo, clock: wiring.clock }
  return {
    get: () => wiring.profileRepo.get(),
    update: (command) => updateProfile(deps, command),
  }
}

function buildResumeWorkbench(wiring: Wiring): ResumeWorkbench {
  // ResumeCreation is the narrow capability CreateResume and DuplicateResume
  // declare; SqliteResumeRepository answers it with insertWithInitialRevision,
  // which writes the resume row and its first revision in one transaction.
  const resumeCreation: ResumeCreation = wiring.resumeRepo
  const measurer = wiring.measurer
  return {
    list: () => wiring.resumeRepo.listAll(),
    get: (id) => wiring.resumeRepo.findById(id),
    create: (input) => createResume(resumeCreation, wiring.ids, wiring.clock, input),
    duplicate: (input) =>
      duplicateResume(
        wiring.resumeRepo,
        resumeCreation,
        wiring.experienceRepo,
        wiring.profileRepo,
        wiring.ids,
        wiring.clock,
        input,
      ),
    commit: (resumeId, change) =>
      commitDocumentChange(wiring.resumeRepo, wiring.experienceRepo, resumeId, change),
    undo: (resumeId) => undoDocumentChange(wiring.resumeRepo, resumeId),
    redo: (resumeId) => redoDocumentChange(wiring.resumeRepo, resumeId),
    freeze: (resumeId) =>
      freezeResume(
        wiring.resumeRepo,
        wiring.experienceRepo,
        wiring.ids,
        wiring.clock,
        resumeId,
      ),
    compare: (from, to) => compareVersions(wiring.resumeRepo, from, to),
    materialize: async (resumeId) => {
      const resume = await wiring.resumeRepo.findById(resumeId)
      if (resume === null) {
        throw new Error(`Cannot materialize resume "${resumeId}": no such resume.`)
      }
      return materializeBlocks(wiring.experienceRepo, resumeId, resume.blocks)
    },
    layOut: (blocks, page) => layout({ blocks, page, measurer }),
    staleReferences: async (experienceId, knownFactVersion) => {
      const [resumes, experience] = await Promise.all([
        wiring.resumeRepo.listAll(),
        wiring.experienceRepo.findById(experienceId),
      ])
      if (experience === null) {
        throw new Error(
          `Cannot list stale references for experience "${experienceId}": no such experience.`,
        )
      }
      return detectStaleReferences(resumes, experienceId, knownFactVersion, experience.claims)
    },
  }
}

function buildAgentConsole(wiring: Wiring): AgentConsole {
  const toolContext: ToolContext = {
    resumes: wiring.resumeRepo,
    experiences: wiring.experienceRepo,
    profiles: wiring.profileRepo,
    runs: wiring.runRepo,
    clock: wiring.clock,
    // The canonical measurer again: checkResumeLayout lays the document out with
    // this function, and the input measurer it passes is the same instance.
    layout: (input: LayoutInput): LayoutOutput => layout({ ...input, measurer: wiring.measurer }),
  }
  return {
    toolSchemas: () => registryFor(null).schemas,
    run: async (request) => {
      const secrets = await loadProviderSecrets(wiring.secretStore, wiring.providerSecretRefs)
      return runAgentTask(
        toolContext,
        {
          model: wiring.provider,
          invocations: toolInvocationRecorder(wiring.runRepo),
          ids: wiring.ids,
          secrets,
        },
        {
          prompt: request.prompt,
          system: request.system,
          resumeId: request.resumeId,
          jobPostingId: request.jobPostingId,
          tools: registryFor,
          onTextDelta: request.onTextDelta,
          isCancelled: request.isCancelled,
        },
      )
    },
    parseJobPosting: (command) =>
      parseJobPosting(
        {
          model: wiring.provider,
          jobPostings: wiring.jobPostings,
          runs: wiring.runRepo,
          clock: wiring.clock,
          ids: wiring.ids,
        },
        command,
      ),
  }

  /**
   * Built per run, because the drafting run has to be stamped onto whatever the
   * agent writes. A null run id serves schema listing, which registers the same
   * tools with a null provenance.
   */
  function registryFor(runId: AgentRunId | null) {
    return buildToolRegistry(
      {
        jobPostings: wiring.jobPostings,
        ids: wiring.ids,
        resumeCreation: wiring.resumeRepo,
        measurer: wiring.measurer,
      },
      runId,
    )
  }
}

/**
 * Builds the adapter from configuration. The credential stays in the secret
 * store; only the adapter, and only for the lifetime of this root, holds it.
 */
async function buildProvider(
  descriptor: ProviderDescriptor | null,
  store: SecretStore,
): Promise<ModelProvider> {
  if (descriptor === null) return new UnconfiguredModelProvider()
  const apiKey = await store.load(descriptor.apiKeyRef)
  // A configured endpoint with no stored credential is a settings state, not a
  // reason to refuse to start. The console reports it on first use, so the rest
  // of the application stays available while it is being fixed.
  if (apiKey === null || apiKey.length === 0) return new UnconfiguredModelProvider()
  const http = createTauriHttpClient()
  if (descriptor.kind === 'anthropic') {
    return new AnthropicProvider({
      id: descriptor.id,
      modelId: descriptor.modelId,
      baseUrl: descriptor.baseUrl,
      apiKey,
      http,
    })
  }
  return new OpenAiCompatibleProvider({
    id: descriptor.id,
    modelId: descriptor.modelId,
    baseUrl: descriptor.baseUrl,
    apiKey,
    http,
  })
}

/**
 * Stands in until a provider is configured. It fails loudly on first use
 * rather than returning empty output, so an unconfigured console reads as
 * "not set up yet" instead of "the model had nothing to say".
 */
class UnconfiguredModelProvider implements ModelProvider {
  readonly id = 'unconfigured'
  readonly modelId = 'unconfigured'

  stream(): AsyncIterable<ModelChunk> {
    throw new Error(
      'No model service is reachable: add a provider and store its credential in settings ' +
        'before running an agent task.',
    )
  }
}

/**
 * The application layer declares record(); the SQLite repository names the same
 * write recordToolInvocation. The adapter keeps both vocabularies intact
 * instead of widening the port to the implementation's spelling.
 */
function toolInvocationRecorder(runRepo: SqliteAgentRunRepository): ToolInvocationRecorder {
  return { record: (invocation) => runRepo.recordToolInvocation(invocation) }
}

/**
 * The credential values the scrubber needs for this run. A reference that holds
 * no record contributes nothing: an unconfigured provider was handed no key, so
 * there is nothing of it in the text to scrub. Refusing here instead would
 * reject the call before runAgentTask could create the failed run that names
 * the real cause — the user would see a settings error with no run recorded.
 */
async function loadProviderSecrets(
  store: SecretStore,
  refs: readonly string[],
): Promise<readonly string[]> {
  const secrets: string[] = []
  for (const ref of refs) {
    const secret = await store.load(ref)
    if (secret !== null && secret.length > 0) secrets.push(secret)
  }
  return secrets
}

/**
 * The seam's own type says which operations the connection has, and the guard
 * checks that the implementation agrees: close and the foreign key check are
 * what shutdown and cascade integrity depend on, so a connection that cannot
 * do them is refused instead of leaving shutdown a silent no-op.
 */
function requireManagedDatabase(database: SqlDatabase): ManagedSqlDatabase {
  const candidate = database as Partial<ManagedSqlDatabase>
  if (typeof candidate.close !== 'function' || typeof candidate.enableForeignKeys !== 'function') {
    throw new Error(
      'The opened SQLite connection exposes neither close() nor enableForeignKeys(), ' +
        'which shutdown and the cascade integrity check both require.',
    )
  }
  return candidate as ManagedSqlDatabase
}
