/**
 * @file toolSchema
 * @description The small contract every tool in the pack shares: a strict Zod
 * schema that becomes the model-visible JSON schema, a parser that never throws,
 * and the failure convention for a refusal the model can correct.
 *
 * Responsibilities:
 * - Turn a Zod schema into the `RegisteredTool.parse` Result
 * - Convert a thrown `DomainError` into the `{ ok:false, error }` result the
 *   model reads, while letting programming faults escape to the run loop
 * - Build the provenance record an agent write carries
 *
 * Constraints:
 * - Parsing is strict: an unknown argument is a refused call, not an ignored one.
 * - A domain refusal is data for the model; anything else is a fault and must
 *   not be silently converted into a successful result.
 */

import type { z } from 'zod'
import type { AgentRunId, ConversationId } from '../../../domain/shared/branded-id'
import { DomainError } from '../../../domain/shared/DomainError'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import type { RegisteredTool } from '../../../domain/generation/ports/ToolRegistry'
import type { ToolRisk } from '../../../domain/generation/ToolRisk'

/** The result value a tool returns when it refuses the request readably. */
export interface ToolFailure {
  readonly ok: false
  readonly error: string
}

/** A registered tool plus the schema the registry renders as JSON. */
export interface ToolDefinition<I> extends RegisteredTool<I, unknown> {
  readonly schema: z.ZodType<I>
}

/** A value a tool should hand back to the model instead of throwing. */
export function toolFailure(error: DomainError): ToolFailure {
  return { ok: false, error: `${error.code}: ${error.message}` }
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
