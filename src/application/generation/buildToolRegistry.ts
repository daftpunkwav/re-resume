/**
 * @file buildToolRegistry
 * @description The one place that knows the full tool list. It pairs each
 * tool with the schema its parse() validates and hands the run loop both the
 * registry and the JSON Schemas a model needs in order to call them.
 *
 * Responsibilities:
 * - Assemble the twelve tools of spec section 5 with their declared risks
 * - Bind the capabilities ToolContext does not carry, at composition time
 * - Produce a run-scoped registry, because the drafting run has to be stamped
 *   onto what an agent writes
 *
 * Constraints:
 * - ToolContext carries the repositories, the clock and the run recorder, but
 *   no IdGenerator, no job posting repository and no measurer. Those are
 *   supplied here rather than smuggled through a widened context, so the port
 *   keeps saying exactly what every tool is given.
 * - A registry built with a null run id serves listing and schema purposes; the
 *   propose tool refuses to draft in that state, because a draft without a
 *   drafting run has no provenance.
 * - Every tool schema is closed, so an undeclared argument is a parse failure
 *   rather than a silently dropped field. That is what stops a write tool from
 *   being handed body text: the only key it declares are identifiers.
 */

import type { ZodType } from 'zod'
import { z } from 'zod'
import type { AgentTools } from './RunAgentTask'
import type { JobPostingRepository } from './ParseJobPosting'
import type { ResumeCreation } from '../resume/CreateResume'
import type { ToolSchema } from '../../domain/generation/ports/ModelProvider'
import type { RegisteredTool, ToolRegistry } from '../../domain/generation/ports/ToolRegistry'
import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { AgentRunId } from '../../domain/shared/branded-id'
import { searchExperiences, searchExperiencesInputSchema } from './tools/searchExperiences'
import {
  getExperienceDetails,
  getExperienceDetailsInputSchema,
} from './tools/getExperienceDetails'
import {
  buildAnalyzeJobDescriptionTool,
  analyzeJobDescriptionInputSchema,
} from './tools/analyzeJobDescription'
import { buildMatchExperiencesTool, matchExperiencesInputSchema } from './tools/matchExperiences'
import {
  buildCheckResumeLayoutTool,
  checkResumeLayoutInputSchema,
} from './tools/checkResumeLayout'
import {
  compareResumeVersions,
  compareResumeVersionsInputSchema,
} from './tools/compareResumeVersions'
import {
  buildSelectExperienceVariantTool,
  selectExperienceVariantInputSchema,
} from './tools/selectExperienceVariant'
import {
  buildCreateResumeDraftTool,
  createResumeDraftInputSchema,
} from './tools/createResumeDraft'
import { buildAddBlockTool, addBlockInputSchema } from './tools/addBlock'
import { buildMoveBlockTool, moveBlockInputSchema } from './tools/moveBlock'
import {
  buildReorderResumeSectionsTool,
  reorderResumeSectionsInputSchema,
} from './tools/reorderResumeSections'
import { buildProposeVariantTool, proposeVariantInputSchema } from './tools/proposeVariant'

export interface ToolRegistryDeps {
  readonly jobPostings: JobPostingRepository
  readonly ids: IdGenerator
  /** Insertion of a resume together with its first revision. */
  readonly resumeCreation: ResumeCreation
  /** The measurer checkResumeLayout lays out with. */
  readonly measurer: TextMeasurer
}

/** One tool plus the schema that validates its arguments. */
interface ToolEntry {
  readonly tool: RegisteredTool<unknown, unknown>
  readonly inputSchema: ZodType
}

export function buildToolRegistry(deps: ToolRegistryDeps, runId: AgentRunId | null): AgentTools {
  const tools: readonly ToolEntry[] = [
    { tool: searchExperiences, inputSchema: searchExperiencesInputSchema },
    { tool: getExperienceDetails, inputSchema: getExperienceDetailsInputSchema },
    {
      tool: buildAnalyzeJobDescriptionTool(deps.jobPostings),
      inputSchema: analyzeJobDescriptionInputSchema,
    },
    {
      tool: buildMatchExperiencesTool(deps.jobPostings),
      inputSchema: matchExperiencesInputSchema,
    },
    {
      tool: buildCheckResumeLayoutTool(deps.measurer),
      inputSchema: checkResumeLayoutInputSchema,
    },
    { tool: compareResumeVersions, inputSchema: compareResumeVersionsInputSchema },
    {
      tool: buildSelectExperienceVariantTool({ runId }),
      inputSchema: selectExperienceVariantInputSchema,
    },
    {
      tool: buildCreateResumeDraftTool({
        jobPostings: deps.jobPostings,
        ids: deps.ids,
        resumeCreation: deps.resumeCreation,
        runId,
      }),
      inputSchema: createResumeDraftInputSchema,
    },
    { tool: buildAddBlockTool({ ids: deps.ids, runId }), inputSchema: addBlockInputSchema },
    { tool: buildMoveBlockTool({ runId }), inputSchema: moveBlockInputSchema },
    {
      tool: buildReorderResumeSectionsTool({ runId }),
      inputSchema: reorderResumeSectionsInputSchema,
    },
    {
      tool: buildProposeVariantTool({ ids: deps.ids, runId }),
      inputSchema: proposeVariantInputSchema,
    },
  ]
  const registry: ToolRegistry = {
    list: () => tools.map((entry) => entry.tool),
    get: (name: string) => tools.find((entry) => entry.tool.name === name)?.tool,
  }
  return { registry, schemas: tools.map(toSchema) }
}

function toSchema(entry: ToolEntry): ToolSchema {
  return {
    name: entry.tool.name,
    description: entry.tool.description,
    parametersJsonSchema: z.toJSONSchema(entry.inputSchema),
  }
}
