/**
 * @file parseJobPosting
 * @description The one use case that calls a model on its own. It extracts the
 * structured requirements from a pasted job description and stores them with
 * the run that produced them, so a parsed posting never appears without a
 * provenance record.
 *
 * Responsibilities:
 * - Run the extraction model over the raw text with no tools attached
 * - Reject model output that does not fit ParsedJobPosting
 * - Refuse extracted statements that the raw description does not contain
 * - Record the agent run the parse is attributed to
 *
 * Constraints:
 * - Grounding is checked on the result, not asked for in a prompt: a
 *   requirement the raw text does not contain is refused however confidently
 *   the model stated it.
 * - The image path (a screenshot transcribed by the model) is not part of this
 *   use case; a posting without text is rejected rather than sent as an empty
 *   prompt.
 */

import { z } from 'zod'
import { attachParse, hasJobPostingContent } from '../../domain/generation/JobPosting'
import type { JobPosting } from '../../domain/generation/JobPosting'
import { completeRun, failRun } from '../../domain/generation/AgentRun'
import type { AgentRun } from '../../domain/generation/AgentRun'
import type { AgentRunRepository } from '../../domain/generation/ports/AgentRunRepository'
import type { JobPostingRepository } from '../../domain/generation/ports/JobPostingRepository'
import type { ModelProvider } from '../../domain/generation/ports/ModelProvider'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import { asAgentRunId } from '../../domain/shared/branded-id'
import type { JobPostingId } from '../../domain/shared/branded-id'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'

export interface ParseJobPostingDeps {
  readonly model: ModelProvider
  readonly jobPostings: JobPostingRepository
  readonly runs: AgentRunRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface ParseJobPostingInput {
  readonly jobPostingId: JobPostingId
  /** Replaces the extraction instruction; the grounding rule holds either way. */
  readonly systemPrompt?: string
}

export type JobPostingParseFailure =
  | { readonly kind: 'unknownPosting'; readonly jobPostingId: string; readonly detail: string }
  | { readonly kind: 'modelFailed'; readonly detail: string }
  | { readonly kind: 'outputRejected'; readonly detail: string }

export interface ParsedJobPostingOutcome {
  readonly jobPosting: JobPosting
  readonly run: AgentRun
}

export const EXTRACTION_SYSTEM_PROMPT = [
  '从下面的岗位描述中提取结构化要求。',
  '只回复一个 JSON 对象，不要输出其他内容，结构为',
  '{"title":string|null,"company":string|null,"responsibilities":string[],',
  '"requirements":string[],"keywords":string[]}。',
  '职责与要求必须逐字摘自描述原文。',
  '不要写出描述中没有的要求。',
].join('\n')

const parsedJobPostingSchema = z.object({
  title: z.string().trim().min(1).nullable().default(null),
  company: z.string().trim().min(1).nullable().default(null),
  responsibilities: z.array(z.string().trim().min(1)),
  requirements: z.array(z.string().trim().min(1)),
  keywords: z.array(z.string().trim().min(1)),
})

export async function parseJobPosting(
  deps: ParseJobPostingDeps,
  input: ParseJobPostingInput,
): Promise<Result<ParsedJobPostingOutcome, JobPostingParseFailure>> {
  const posting = await deps.jobPostings.findById(input.jobPostingId)
  if (posting === null) {
    return err({
      kind: 'unknownPosting',
      jobPostingId: input.jobPostingId,
      detail: `岗位描述 ${input.jobPostingId} 不存在。`,
    })
  }
  if (!hasJobPostingContent(posting) || posting.rawText.trim() === '') {
    return err({
      kind: 'outputRejected',
      detail: '岗位描述没有可解析的文本。请粘贴文本后再解析。',
    })
  }

  const run = await startRun(deps, posting)
  const answer = await readModelAnswer(deps.model, {
    system: input.systemPrompt ?? EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', parts: [{ kind: 'text', text: posting.rawText }] }],
  })
  if (!answer.ok) return reject(deps, run, { kind: 'modelFailed', detail: answer.error })

  const extracted = extractJsonObject(answer.value)
  if (extracted === null) {
    return reject(deps, run, {
      kind: 'outputRejected',
      detail: '模型回复中没有 JSON 对象。',
    })
  }
  const decoded = decodeJsonObject(extracted)
  if (!decoded.ok) return reject(deps, run, { kind: 'outputRejected', detail: decoded.error })

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
      detail: `以下内容不在岗位描述原文中：${ungrounded.join(' | ')}`,
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
async function startRun(deps: ParseJobPostingDeps, posting: JobPosting): Promise<AgentRun> {
  const run: AgentRun = {
    id: asAgentRunId(deps.ids.next()),
    conversationId: posting.conversationId,
    resumeId: posting.resumeId,
    jobPostingId: posting.id,
    status: 'running',
    errorText: null,
    promptTokens: null,
    completionTokens: null,
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
  await deps.runs.save(failRun(run, failure.detail, deps.clock.now()))
  return err(failure)
}

async function readModelAnswer(
  model: ModelProvider,
  request: {
    readonly system: string
    readonly messages: readonly {
      readonly role: 'user'
      readonly parts: readonly { readonly kind: 'text'; readonly text: string }[]
    }[]
  },
): Promise<Result<string, string>> {
  let answer = ''
  try {
    // No tools: the parse reads one text and writes nothing.
    for await (const chunk of model.stream(request, [])) {
      if (chunk.type === 'text') answer += chunk.textDelta
    }
  } catch (error: unknown) {
    return err(`模型调用失败：${describeThrown(error)}`)
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
    return err(`模型回复不是合法 JSON：${describeThrown(error)}`)
  }
}

function ungroundedStatements(
  parsed: {
    readonly responsibilities: readonly string[]
    readonly requirements: readonly string[]
  },
  rawText: string,
): readonly string[] {
  const haystack = normalizeForGrounding(rawText)
  return [...parsed.responsibilities, ...parsed.requirements].filter((statement) => {
    const needle = normalizeForGrounding(statement)
    // Every string contains the empty string, so a statement that normalizes
    // away to nothing — punctuation alone, say — would otherwise pass as
    // grounded and let the model assert content that is not in the text.
    if (needle.length === 0) return true
    return !haystack.includes(needle)
  })
}

/**
 * Whitespace, punctuation and symbols are discounted so a requirement copied
 * with different spacing or a full stop still counts as present. Keywords are
 * exempt: they are search terms derived from the text, not sentences asserted
 * to be in it.
 */
function normalizeForGrounding(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

