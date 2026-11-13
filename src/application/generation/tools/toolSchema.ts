/**
 * @file toolSchema
 * @description The small contract every tool in the pack shares: a strict Zod
 * schema that becomes the model-visible JSON schema, a parser that never throws,
 * and the failure convention for a refusal the model can correct.
 *
 * Responsibilities:
 * - Turn a Zod schema into the `RegisteredTool.parse` Result
 * - Convert a thrown `DomainError` into the refusal value the model reads,
 *   while letting programming faults escape to the run loop
 * - Build the provenance record an agent write carries
 *
 * Constraints:
 * - Parsing is strict: an unknown argument is a refused call, not an ignored one.
 * - A domain refusal is data for the model; anything else is a fault and must
 *   not be silently converted into a successful result.
 * - The refusal carries a discriminator kind, so a successful result that
 *   happens to hold `ok` and `error` keys is never misread as a refusal: the
 *   run loop refuses only what this module produced.
 */

import type { z } from 'zod'
import type { AgentRunId, ConversationId } from '../../../domain/shared/branded-id'
import { DomainError } from '../../../domain/shared/DomainError'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import type { RegisteredTool } from '../../../domain/generation/ports/ToolRegistry'
import type { ToolRisk } from '../../../domain/generation/ToolRisk'

/**
 * The result value a tool returns when it refuses the request readably. The
 * kind is the discriminator the run loop reads; `ok` and `error` are the
 * model-facing payload.
 */
export interface ToolFailure {
  readonly kind: 'toolFailure'
  readonly ok: false
  readonly error: string
}

/** A registered tool plus the schema the registry renders as JSON. */
export interface ToolDefinition<I> extends RegisteredTool<I, unknown> {
  readonly schema: z.ZodType<I>
}

/** A value a tool should hand back to the model instead of throwing. */
export function toolFailure(error: DomainError): ToolFailure {
  return { kind: 'toolFailure', ok: false, error: `${error.code}: ${error.message}` }
}

/** Runs a tool body, converting a domain refusal and letting a fault escape. */
export async function executeSafely<T>(work: () => Promise<T>): Promise<T | ToolFailure> {
  try {
    return await work()
  } catch (failure) {
    if (failure instanceof DomainError) return toolFailure(failure)
    throw failure
  }
}

/** The provenance an agent write records; every write tool uses this shape. */
export interface AgentProvenance {
  readonly origin: 'agent'
  readonly runId: AgentRunId
  readonly conversationId: ConversationId
}

export function agentProvenance(context: ToolContext): AgentProvenance {
  return { origin: 'agent', runId: context.runId, conversationId: context.conversationId }
}

/** The provenance a resume document write records: origin plus the run. */
export function resumeProvenance(context: ToolContext): {
  readonly origin: 'agent'
  readonly runId: AgentRunId
} {
  return { origin: 'agent', runId: context.runId }
}

/**
 * Declares one tool. `description` is what the model reads when choosing a tool,
 * so it states when to call the tool rather than restating the schema.
 *
 * `execute` returns an `unknown` value because each tool hands the model its own
 * shape; the run loop then reads the audit identifiers from it **by name** —
 * `changeId`/`changeIds`, `revisionId`, `resumeId` (see `toolOutcome`). A tool
 * that means to report a write must spell those keys exactly: a misspelled key
 * compiles, and the card simply loses its undo affordance. `toolContract.test`
 * pins the names.
 */
export function defineTool<I>(spec: {
  readonly name: string
  readonly description: string
  readonly risk: ToolRisk
  readonly schema: z.ZodType<I>
  readonly execute: (input: I, context: ToolContext) => Promise<unknown>
}): ToolDefinition<I> {
  return {
    name: spec.name,
    description: spec.description,
    risk: spec.risk,
    schema: spec.schema,
    parse: (raw: unknown): Result<I> => {
      const parsed = spec.schema.safeParse(raw)
      if (parsed.success) return ok(parsed.data)
      return err(new Error(describeZodError(parsed.error)))
    },
    execute: spec.execute,
  }
}

/** A readable one-line rendering of every schema issue. */
export function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`)
    .join('; ')
}
