/**
 * @file ApproveToolInvocation
 * @description The destructive tool path reserved by spec section 5: produce a
 * dry-run plan first, and touch nothing until the user approves. v1 registers
 * no destructive tool, so the approval branch is unreachable by design; the
 * guard at the top says so out loud instead of quietly doing nothing.
 *
 * Responsibilities:
 * - Refuse any tool that did not declare the destructive risk level
 * - Record a pending invocation describing what the call would affect
 * - Execute and record the call only after an explicit approval
 *
 * Constraints:
 * - ToolInvocationRecorder is declared here because this file and RunAgentTask
 *   both write invocation records and neither owns the table; a third importer
 *   would make the recorder's vocabulary a fourth concern.
 */

import { z } from 'zod'
import type { ToolInvocation } from '../../domain/generation/ToolInvocation'
import { initialApprovalState } from '../../domain/generation/ToolInvocation'
import { redactJsonSecrets } from './redactSecret'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { AgentRunId } from '../../domain/shared/branded-id'
import { asToolInvocationId } from '../../domain/shared/branded-id'
import type {
  RegisteredTool,
  ToolContext,
} from '../../domain/generation/ports/ToolRegistry'

/** Insertion of an invocation record; a second call with the same id updates it. */
export interface ToolInvocationRecorder {
  record(invocation: ToolInvocation): Promise<void>
}

/** What the call would touch, derived from the identifiers it names. */
export interface DestructivePlan {
  readonly toolName: string
  readonly argsJson: string
  readonly targets: readonly string[]
}

export type DestructiveApproval = 'approved' | 'rejected'

export type DestructiveToolOutcome =
  | { readonly kind: 'awaitingApproval'; readonly plan: DestructivePlan; readonly invocation: ToolInvocation }
  | { readonly kind: 'rejected'; readonly plan: DestructivePlan; readonly invocation: ToolInvocation }
  | {
      readonly kind: 'executed'
      readonly plan: DestructivePlan
      readonly invocation: ToolInvocation
      readonly result: unknown
    }

export interface ApproveToolInvocationDeps {
  readonly invocations: ToolInvocationRecorder
  readonly clock: Clock
}

export interface DestructiveToolRequest {
  readonly tool: RegisteredTool<unknown, unknown>
  readonly argsJson: string
  readonly runId: AgentRunId
  readonly ctx: ToolContext
  readonly ids: IdGenerator
  /**
   * Credential values currently loaded for the provider. The dry-run plan and
   * the audit row both persist the argument text, so both are scrubbed here as
   * well — the reserved path must not be the one place a secret survives.
   */
  readonly secrets?: readonly string[]
  /** Omitted for a dry run; the v1 run loop never supplies it. */
  readonly approval?: DestructiveApproval
}

export async function approveToolInvocation(
  deps: ApproveToolInvocationDeps,
  request: DestructiveToolRequest,
): Promise<DestructiveToolOutcome> {
  if (request.tool.risk !== 'destructive') {
    throw new Error(
      `approveToolInvocation handles the destructive path only; "${request.tool.name}" is registered as ${request.tool.risk}.`,
    )
  }
  const argsJson = redactJsonSecrets(request.argsJson, request.secrets ?? [])
  const plan: DestructivePlan = {
    toolName: request.tool.name,
    argsJson,
    targets: namedIdentifiers(argsJson),
  }
  const invocation = startInvocation(deps, request, argsJson, initialApprovalState('destructive'))

  if (request.approval === undefined) {
    await deps.invocations.record(invocation)
    return { kind: 'awaitingApproval', plan, invocation }
  }
  if (request.approval === 'rejected') {
    const rejected: ToolInvocation = { ...invocation, approvalState: 'rejected' }
    await deps.invocations.record(rejected)
    return { kind: 'rejected', plan, invocation: rejected }
  }

  const parsed = parseToolArguments(request.tool, request.argsJson)
  if (!parsed.ok) {
    // Recorded as executed with a failure result: the call was processed and
    // wrote nothing, which is what the audit row has to say.
    const failed: ToolInvocation = {
      ...invocation,
      resultJson: failureJson(parsed.error),
      approvalState: 'executed',
    }
    await deps.invocations.record(failed)
    return { kind: 'executed', plan, invocation: failed, result: failed.resultJson }
  }
  try {
    const result = await request.tool.execute(parsed.value, request.ctx)
    const executed: ToolInvocation = {
      ...invocation,
      resultJson: successJson(result),
      approvalState: 'executed',
    }
    await deps.invocations.record(executed)
    return { kind: 'executed', plan, invocation: executed, result }
  } catch (error: unknown) {
    const failed: ToolInvocation = {
      ...invocation,
      resultJson: failureJson(describeThrown(error)),
      approvalState: 'executed',
    }
    await deps.invocations.record(failed)
    return { kind: 'executed', plan, invocation: failed, result: failed.resultJson }
  }
}

function startInvocation(
  deps: ApproveToolInvocationDeps,
  request: DestructiveToolRequest,
  argsJson: string,
  approvalState: ToolInvocation['approvalState'],
): ToolInvocation {
  return {
    id: asToolInvocationId(request.ids.next()),
    runId: request.runId,
    toolName: request.tool.name,
    risk: request.tool.risk,
    argsJson,
    resultJson: null,
    approvalState,
    createdAt: deps.clock.now(),
  }
}

/**
 * The dry-run diff: the identifiers the arguments name, since a destructive
 * call acts on entities rather than on text. A malformed argument list yields
 * no targets, which leaves the approval decision to the caller rather than
 * guessing what the call meant.
 */
function namedIdentifiers(argsJson: string): readonly string[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(argsJson) as unknown
  } catch {
    return []
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return []
  const identifiers: string[] = []
  for (const value of Object.values(decoded)) {
    if (typeof value === 'string') identifiers.push(value)
    else if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === 'string') identifiers.push(entry)
    }
  }
  return identifiers
}

/** Exported because the run loop validates the same way before recording. */
export function parseToolArguments(
  tool: RegisteredTool<unknown, unknown>,
  argsJson: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string } {
  let decoded: unknown
  try {
    decoded = JSON.parse(argsJson) as unknown
  } catch (error: unknown) {
    return { ok: false, error: `The arguments are not valid JSON: ${describeThrown(error)}` }
  }
  const parsed = tool.parse(decoded)
  if (parsed.ok) return { ok: true, value: parsed.value }
  return { ok: false, error: describeArgumentFailure(parsed.error) }
}

/**
 * Formats an argument-validation failure. The port returns Result<I> with the
 * default Error member, so the Zod issue list is recovered by narrowing on the
 * concrete error type rather than assumed at compile time.
 */
export function describeArgumentFailure(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
  }
  return describeThrown(error)
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function failureJson(error: string): string {
  return JSON.stringify({ ok: false, error })
}

function successJson(value: unknown): string {
  return JSON.stringify({ ok: true, value })
}
