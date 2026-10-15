/**
 * @file ParseJobPosting
 * @description The one use case that calls a model on its own. It extracts
 * requirements from a pasted job description and persists them together with
 * the run that produced them, so parsed_json never appears without a source.
 *
 * Responsibilities:
 * - Run the extraction model over the raw text with no tools attached
 * - Reject model output that does not fit ParsedJobPosting
 * - Refuse extracted statements that the raw description does not contain
 * - Record the agent run the parse is attributed to
 *
 * Constraints:
 * - JobPostingRepository lives in the domain context, next to the entity it
 *   persists, so the infrastructure implementation never has to reach back
 *   into this layer for the port's shape.
 * - Grounding is checked on the result, not asked for in a prompt: a
 *   requirement the raw text does not contain is refused however confidently
 *   the model stated it.
 */

import { z } from 'zod'
import { attachParse } from '../../domain/generation/JobPosting'
import type { JobPostingRepository } from '../../domain/generation/ports/JobPostingRepository'

export type { JobPostingRepository }
import type { JobPosting } from '../../domain/generation/JobPosting'
import { completeRun, failRun } from '../../domain/generation/AgentRun'
import type { AgentRun } from '../../domain/generation/AgentRun'
import type { AgentRunRepository } from '../../domain/generation/ports/AgentRunRepository'
import type { ModelProvider } from '../../domain/generation/ports/ModelProvider'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import { asAgentRunId } from '../../domain/shared/branded-id'
import type { JobPostingId } from '../../domain/shared/branded-id'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'

/**
 * Why this is declared here rather than on the domain port: the job_posting
 * table has no domain port, and the use cases in this layer are its only
 * reader and writer. A repository implementation binds to this vocabulary.
 */
export interface ParseJobPostingDeps {
  readonly model: ModelProvider
  readonly jobPostings: JobPostingRepository
  readonly runs: AgentRunRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface ParseJobPostingCommand {
  readonly jobPostingId: JobPostingId
  /** Replaces the extraction instruction; the grounding rule holds either way. */
  readonly system?: string
}

export type JobPostingParseFailure =
  | { readonly kind: 'unknownPosting'; readonly jobPostingId: string }
  | { readonly kind: 'modelFailed'; readonly detail: string }
  | { readonly kind: 'outputRejected'; readonly detail: string }

export interface ParsedJobPostingOutcome {
  readonly jobPosting: JobPosting
  readonly run: AgentRun
}

const EXTRACTION_SYSTEM_PROMPT = [
  'Extract the job requirements from the description below.',
  'Reply with one JSON object and nothing else, shaped',
  '{"title":string|null,"company":string|null,"responsibilities":string[],',
  '"requirements":string[],"keywords":string[]}.',
  'Copy every responsibility and requirement verbatim from the description.',
  'Do not state a requirement the description does not contain.',
].join(' ')

const parsedJobPostingSchema = z.object({
  title: z.string().trim().min(1).nullable().default(null),
  company: z.string().trim().min(1).nullable().default(null),
  responsibilities: z.array(z.string().trim().min(1)),
  requirements: z.array(z.string().trim().min(1)),
  keywords: z.array(z.string().trim().min(1)),
})

export async function parseJobPosting(
  deps: ParseJobPostingDeps,
  command: ParseJobPostingCommand,
): Promise<Result<ParsedJobPostingOutcome, JobPostingParseFailure>> {
  const posting = await deps.jobPostings.findById(command.jobPostingId)
  if (posting === null) {
    return err({ kind: 'unknownPosting', jobPostingId: command.jobPostingId })
  }

  const run = await startRun(deps, command.jobPostingId)
  const answer = await readModelAnswer(deps.model, {
    system: command.system ?? EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', text: posting.rawText }],
  })
  if (!answer.ok) {
    return reject(deps, run, { kind: 'modelFailed', detail: answer.error })
  }

  const extracted = extractJsonObject(answer.value)
  if (extracted === null) {
    return reject(deps, run, {
      kind: 'outputRejected',
      detail: 'The model reply contained no JSON object.',
    })
  }

  const decoded = decodeJsonObject(extracted)
  if (!decoded.ok) {
    return reject(deps, run, { kind: 'outputRejected', detail: decoded.error })
  }

  const parsed = parsedJobPostingSchema.safeParse(decoded.value)
  if (!parsed.success) {
    return reject(deps, run, {
      kind: 'outputRejected',
      detail: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    })
  }

  const ungrounded = ungroundedStatements(parsed.data, posting.rawText)
  if (ungrounded.length > 0) {
    return reject(deps, run, {
      kind: 'outputRejected',
      detail: `Statements absent from the description: ${ungrounded.join(' | ')}`,
    })
  }

  const now = deps.clock.now()
  const parsedPosting: JobPosting = attachParse(posting, parsed.data, run.id, now)
  await deps.jobPostings.save(parsedPosting)
  const completed = completeRun(run, now)
  await deps.runs.save(completed)
  return ok({ jobPosting: parsedPosting, run: completed })
}

/** Written before the model call, so an aborted parse still leaves a record. */
async function startRun(deps: ParseJobPostingDeps, jobPostingId: JobPostingId): Promise<AgentRun> {
  const run: AgentRun = {
    id: asAgentRunId(deps.ids.next()),
    resumeId: null,
    jobPostingId,
    status: 'running',
    errorText: null,
    startedAt: deps.clock.now(),
    endedAt: null,
  }
  await deps.runs.create(run)
  return run
}

async function reject(
  deps: ParseJobPostingDeps,
  run: AgentRun,
  failure: JobPostingParseFailure,
): Promise<Result<ParsedJobPostingOutcome, JobPostingParseFailure>> {
  await deps.runs.save(failRun(run, describeFailure(failure), deps.clock.now()))
  return err(failure)
}

function describeFailure(failure: JobPostingParseFailure): string {
  if (failure.kind === 'unknownPosting') return `No job posting "${failure.jobPostingId}".`
  return failure.detail
}

async function readModelAnswer(
  model: ModelProvider,
  request: {
    readonly system: string
    readonly messages: readonly { readonly role: 'user'; readonly text: string }[]
  },
): Promise<Result<string, string>> {
  let answer = ''
  try {
    // No tools: the parse reads one text and writes nothing.
    for await (const chunk of model.stream(request, [])) {
      if (chunk.type === 'text') answer += chunk.textDelta
    }
  } catch (error: unknown) {
    return err(`The model call failed: ${describeThrown(error)}`)
  }
  return ok(answer)
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * Returns the first balanced JSON object in the reply, so a reply that wraps
 * the object in a Markdown fence or a sentence still parses. Brace counting is
 * string-aware, so a brace inside a quoted value cannot end the object early.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function decodeJsonObject(raw: string): Result<unknown, string> {
  try {
    return ok(JSON.parse(raw) as unknown)
  } catch (error: unknown) {
    return err(`The model reply was not valid JSON: ${describeThrown(error)}`)
  }
}

function ungroundedStatements(
  parsed: { readonly responsibilities: readonly string[]; readonly requirements: readonly string[] },
  rawText: string,
): readonly string[] {
  const haystack = normalizeForGrounding(rawText)
  return [...parsed.responsibilities, ...parsed.requirements].filter(
    (statement) => !haystack.includes(normalizeForGrounding(statement)),
  )
}

/**
 * Whitespace, punctuation and symbols are discounted so a requirement copied
 * with different spacing or a full stop still counts as present. Keywords are
 * exempt: they are search terms derived from the text, not sentences asserted
 * to be in it.
 */
function normalizeForGrounding(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}
