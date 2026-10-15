/**
 * @file proposeVariant
 * @description Drafts a new wording of an experience. This is the only tool
 * that accepts body text, and the text it produces is unreachable from a
 * resume: AddVariant records draftedByRunId and leaves confirmedAt null, and
 * commitDocumentChange refuses any block that selects an unconfirmed variant.
 *
 * Constraints:
 * - propose level. The draft carries the run that wrote it, so the registry
 *   that holds this tool has to be bound to a run.
 * - It delegates to AddVariant rather than building the variant itself: the
 *   label-uniqueness rule and the confirmed/unconfirmed split belong to that
 *   use case and to the Experience aggregate.
 */

import { z } from 'zod'
import { addVariant } from '../../experience/AddVariant'
import type { Variant } from '../../../domain/catalog/Variant'
import type { IdGenerator } from '../../../domain/shared/IdGenerator'
import type { AgentRunId, ExperienceId, VariantId } from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

export const proposeVariantInputSchema = z
  .object({
    experienceId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    content: z.string().trim().min(1),
    /**
     * A cleared field arrives as '', which AddVariant reads as "no emphasis".
     * The schema stays free of transforms because buildToolRegistry converts
     * it to JSON Schema for the model, and Zod cannot represent one there.
     */
    emphasis: z.string().nullable().optional(),
  })
  .strict()

export interface ProposeVariantInput {
  readonly experienceId: string
  /** Short identifier of the intended use, unique within the experience. */
  readonly label: string
  readonly content: string
  readonly emphasis?: string | null
}

export interface DraftedVariantSummary {
  readonly experienceId: ExperienceId
  readonly variantId: VariantId
  readonly label: string
  readonly draftedByRunId: string
  readonly confirmed: false
  /** Always true: no resume may reference the draft until it is confirmed. */
  readonly requiresConfirmation: true
}

export type ProposeVariantResult =
  | { readonly kind: 'drafted' } & DraftedVariantSummary
  | { readonly kind: 'refused'; readonly issues: readonly string[] }

export interface ProposeVariantDeps {
  readonly ids: IdGenerator
  /** The drafting run; null means the tool was registered outside a run. */
  readonly runId: AgentRunId | null
}

export function buildProposeVariantTool(
  deps: ProposeVariantDeps,
): RegisteredTool<ProposeVariantInput, ProposeVariantResult> {
  return {
    name: 'proposeVariant',
    description:
      'Draft a new wording of an experience. The draft stays unconfirmed and no resume can reference it until the user confirms it.',
    risk: 'propose',
    parse: (raw: unknown): Result<ProposeVariantInput> => {
      const parsed = proposeVariantInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (input: ProposeVariantInput, ctx: ToolContext): Promise<ProposeVariantResult> => {
      if (deps.runId === null) {
        throw new Error(
          'proposeVariant was registered without an agent run, so the draft would carry no provenance. Bind a run to the registry before using it.',
        )
      }
      const result = await addVariant(
        { experienceRepo: ctx.experiences, clock: ctx.clock, ids: deps.ids },
        {
          experienceId: input.experienceId,
          label: input.label,
          content: input.content,
          emphasis: input.emphasis ?? null,
          draftedByRunId: deps.runId,
        },
      )
      if (!result.ok) return { kind: 'refused', issues: describeIssues(result.error) }
      const variant = result.value.variants.find((entry) => entry.label === input.label)
      if (variant === undefined) return { kind: 'refused', issues: ['The draft was not written.'] }
      return { kind: 'drafted', ...toDraftSummary(variant, deps.runId) }
    },
  }
}

function toDraftSummary(variant: Variant, runId: AgentRunId): DraftedVariantSummary {
  if (variant.draftedByRunId === null) {
    throw new Error(`Variant "${variant.label}" was written without a drafting run.`)
  }
  return {
    experienceId: variant.experienceId,
    variantId: variant.id,
    label: variant.label,
    draftedByRunId: runId,
    confirmed: false,
    requiresConfirmation: true,
  }
}

function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
}
