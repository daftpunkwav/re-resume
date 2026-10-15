/**
 * @file RunAgentTask
 * @description The agent tool-calling loop: stream a reply, run the tools it
 * asked for, feed the results back, repeat. No framework and no workflow
 * language — the loop is a `for` over model turns, and everything it touches
 * arrives as a parameter.
 *
 * Responsibilities:
 * - Create the run before the first model call, so a crash leaves a record
 * - Record every tool call, including one whose arguments were malformed
 * - Route destructive calls to the approval path instead of executing them
 * - Stream text deltas to the caller's sink and stop when the caller cancels
 *
 * Constraints:
 * - The run status is never set to awaitingConfirmation. That status is
 *   reserved for a future destructive tool, and assigning it here would claim
 *   a pause that no caller can resolve. A destructive call fails the run with
 *   its plan instead.
 * - ChatRequest has no tool role, so results are fed back as a user message.
 *   The provider adapters send exactly what this loop builds.
 * - Only strings the caller declared as secrets are scrubbed; the loop never
 *   sees a provider key itself, and every persisted string passes through the
 *   scrubber before it reaches argsJson, resultJson or errorText.
 */

import {
  approveToolInvocation,
  describeArgumentFailure,
  parseToolArguments,
} from './ApproveToolInvocation'
import type { DestructivePlan, ToolInvocationRecorder } from './ApproveToolInvocation'
import type { AgentRun } from '../../domain/generation/AgentRun'
import type { ToolInvocation } from '../../domain/generation/ToolInvocation'
import { initialApprovalState } from '../../domain/generation/ToolInvocation'
import type { ModelProvider, ToolSchema } from '../../domain/generation/ports/ModelProvider'
import type { ToolContext, ToolRegistry } from '../../domain/generation/ports/ToolRegistry'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { AgentRunId, JobPostingId, ResumeId } from '../../domain/shared/branded-id'
import { asAgentRunId, asToolInvocationId } from '../../domain/shared/branded-id'

const DEFAULT_MAX_TURNS = 8
const REDACTED = '[redacted]'

/**
 * The registry plus the JSON Schemas the model needs. The domain ToolRegistry
 * has no schema member, so the composition layer pairs each tool with the
 * schema its parse() validates.
 */
export interface AgentTools {
  readonly registry: ToolRegistry
  readonly schemas: readonly ToolSchema[]
}

export interface RunAgentTaskDeps {
  readonly model: ModelProvider
  readonly invocations: ToolInvocationRecorder
  readonly ids: IdGenerator
  /** Secrets currently loaded for the provider; scrubbed before persistence. */
  readonly secrets?: readonly string[]
  /** Model round trips allowed before the run is failed. */
  readonly maxTurns?: number
}

export interface RunAgentTaskRequest {
  readonly prompt: string
  readonly system?: string | null
  readonly resumeId?: ResumeId | null
  readonly jobPostingId?: JobPostingId | null
  /** Built per run, so a tool can stamp the drafting run onto what it writes. */
  readonly tools: (runId: AgentRunId) => AgentTools
  readonly onTextDelta?: (delta: string) => void
  readonly isCancelled?: () => boolean
}

interface PendingToolCall {
  readonly name: string
  readonly argsJson: string
}

interface ModelTurn {
  readonly text: string
  readonly toolCalls: readonly PendingToolCall[]
}

/** Raised when a destructive tool is called; the loop has no approval channel. */
export class DestructiveApprovalRequired extends Error {
  readonly plan: DestructivePlan

  constructor(plan: DestructivePlan) {
    super(
      `The destructive tool "${plan.toolName}" was not executed. It affects: ${plan.targets.join(', ')}.`,
    )
    this.name = 'DestructiveApprovalRequired'
    this.plan = plan
  }
}

export async function runAgentTask(
  ctx: ToolContext,
  deps: RunAgentTaskDeps,
  request: RunAgentTaskRequest,
): Promise<AgentRun> {
  const secrets = deps.secrets ?? []
  const run: AgentRun = {
    id: asAgentRunId(deps.ids.next()),
    resumeId: request.resumeId ?? null,
    jobPostingId: request.jobPostingId ?? null,
    status: 'running',
    errorText: null,
    startedAt: ctx.clock.now(),
    endedAt: null,
  }
  // Created before the first model call: a crash mid-run leaves a running row
  // rather than no trace of what was attempted.
  await ctx.runs.create(run)

  const maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS
  const messages: { role: 'user' | 'assistant'; text: string }[] = [
    { role: 'user', text: request.prompt },
  ]
  try {
    const tools = request.tools(run.id)
    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (isCancelled(request)) return await endRun(ctx, run, 'cancelled', null)
      const reply = await readTurn(
        deps.model,
        { system: request.system ?? null, messages },
        tools.schemas,
        request.onTextDelta,
      )
      messages.push({ role: 'assistant', text: assistantText(reply) })
      if (reply.toolCalls.length === 0) return await endRun(ctx, run, 'completed', null)

      const results: string[] = []
      for (const call of reply.toolCalls) {
        if (isCancelled(request)) return await endRun(ctx, run, 'cancelled', null)
        results.push(await invokeTool(ctx, deps, tools.registry, run.id, call, secrets))
      }
      messages.push({ role: 'user', text: results.join('\n') })
    }
    return await endRun(ctx, run, 'failed', `The run used all ${maxTurns} turns without finishing.`)
  } catch (error: unknown) {
    return await endRun(ctx, run, 'failed', redact(describeThrown(error), secrets))
  }
}

async function readTurn(
  model: ModelProvider,
  request: {
    readonly system: string | null
    readonly messages: readonly { role: 'user' | 'assistant'; text: string }[]
  },
  schemas: readonly ToolSchema[],
  onTextDelta: ((delta: string) => void) | undefined,
): Promise<ModelTurn> {
  let text = ''
  const toolCalls: PendingToolCall[] = []
  for await (const chunk of model.stream(request, schemas)) {
    if (chunk.type === 'text') {
      text += chunk.textDelta
      onTextDelta?.(chunk.textDelta)
      continue
    }
    toolCalls.push({ name: chunk.name, argsJson: chunk.argsJson })
  }
  return { text, toolCalls }
}

/**
 * A turn that only called tools has no assistant text; the call summary keeps
 * the transcript readable to the next request.
 */
function assistantText(reply: ModelTurn): string {
  if (reply.text.trim() !== '') return reply.text
  return reply.toolCalls
    .map((call) => `Called ${call.name} with ${call.argsJson}.`)
    .join('\n')
}

async function invokeTool(
  ctx: ToolContext,
  deps: RunAgentTaskDeps,
  registry: ToolRegistry,
  runId: AgentRunId,
  call: PendingToolCall,
  secrets: readonly string[],
): Promise<string> {
  const tool = registry.get(call.name)
  if (tool === undefined) {
    // No invocation row: the record carries the tool's declared risk, and an
    // unregistered name declares none. The model still learns it was refused.
    return toolResultMessage(
      call.name,
      failureJson(`No tool named "${call.name}" is registered.`),
    )
  }
  if (tool.risk === 'destructive') {
    const outcome = await approveToolInvocation(
      { invocations: deps.invocations, clock: ctx.clock },
      { tool, argsJson: call.argsJson, runId, ctx, ids: deps.ids },
    )
    throw new DestructiveApprovalRequired(outcome.plan)
  }

  const invocation: ToolInvocation = {
    id: asToolInvocationId(deps.ids.next()),
    runId,
    toolName: tool.name,
    risk: tool.risk,
    argsJson: redact(call.argsJson, secrets),
    resultJson: null,
    approvalState: initialApprovalState(tool.risk),
    createdAt: ctx.clock.now(),
  }
  await deps.invocations.record(invocation)

  const parsed = parseToolArguments(tool, call.argsJson)
  if (!parsed.ok) {
    // A malformed argument is an expected outcome: it is recorded and handed
    // back to the model, which may correct it, and the run continues.
    const resultJson = redact(failureJson(parsed.error), secrets)
    return toolResultMessage(tool.name, await recordResult(deps, invocation, resultJson))
  }
  try {
    const value = await tool.execute(parsed.value, ctx)
    const resultJson = redact(successJson(value), secrets)
    return toolResultMessage(tool.name, await recordResult(deps, invocation, resultJson))
  } catch (error: unknown) {
    const resultJson = redact(failureJson(describeArgumentFailure(error)), secrets)
    return toolResultMessage(tool.name, await recordResult(deps, invocation, resultJson))
  }
}

async function recordResult(
  deps: RunAgentTaskDeps,
  invocation: ToolInvocation,
  resultJson: string,
): Promise<string> {
  const executed: ToolInvocation = { ...invocation, resultJson, approvalState: 'executed' }
  await deps.invocations.record(executed)
  return resultJson
}

function toolResultMessage(toolName: string, resultJson: string): string {
  return `Result of ${toolName}:\n${resultJson}`
}

async function endRun(
  ctx: ToolContext,
  run: AgentRun,
  status: 'completed' | 'failed' | 'cancelled',
  errorText: string | null,
): Promise<AgentRun> {
  const ended: AgentRun = { ...run, status, errorText, endedAt: ctx.clock.now() }
  await ctx.runs.save(ended)
  return ended
}

function isCancelled(request: RunAgentTaskRequest): boolean {
  return request.isCancelled?.() === true
}

/** Exact-match replacement, so a secret with regex metacharacters is safe. */
function redact(value: string, secrets: readonly string[]): string {
  let scrubbed = value
  for (const secret of secrets) {
    if (secret.length === 0) continue
    scrubbed = scrubbed.split(secret).join(REDACTED)
  }
  return scrubbed
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function successJson(value: unknown): string {
  return JSON.stringify({ ok: true, value })
}

function failureJson(error: string): string {
  return JSON.stringify({ ok: false, error })
}
