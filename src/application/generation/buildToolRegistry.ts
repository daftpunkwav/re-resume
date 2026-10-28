/**
 * @file buildToolRegistry
 * @description The production tool registry: the 25 tools of the agent pack,
 * their model-visible JSON schemas and their card labels. The registry is built
 * once per composition root from the dependency bundle the tool pack declares.
 *
 * Responsibilities:
 * - Assemble the read, library, resume, draft, canvas and undo tools
 * - Render each tool's strict Zod schema into the JSON schema the model reads
 * - Enforce the four construction guards: no destructive tool name, the exact
 *   tool count, a label for every write/draft tool, and a renderable schema
 *
 * Constraints:
 * - `exportPdf` is deliberately not registered here: the export change registers
 *   it when the exporter exists, which is why the expected count is 25 rather
 *   than the contract's 26.
 * - A guard failure is a build error, not a runtime refusal: a registry that
 *   cannot describe itself must not reach a model.
 * - A registered tool's `parse` is the only argument validator; this module
 *   never pre-validates.
 */

import { z } from 'zod'
import type { RegisteredTool, ToolRegistry } from '../../domain/generation/ports/ToolRegistry'
import type { ToolSchema } from '../../domain/generation/ports/ModelProvider'
import { TOOL_LABELS, LABELLED_RISKS } from './toolLabels'
import type { ToolDefinition } from './tools/toolSchema'
import type { ToolPackDeps } from './tools/deps'
import { createReadTools } from './tools/readTools'
import { createInfoTools } from './tools/infoTools'
import { createResumeTools } from './tools/resumeTools'
import { createDraftTools } from './tools/draftTools'
import { createCanvasTools } from './tools/canvasTools'
import { createUndoTools } from './tools/undoTools'

/** Tools this pack registers. The export tool raises this to 26 when it lands. */
export const EXPECTED_TOOL_COUNT = 25

/** Tool names that imply deleting data; the product does not allow any. */
export const FORBIDDEN_TOOL_NAME_PATTERN = /(delete|remove|destroy|drop|clear|purge)/i

/** Builds the registry from the tool pack's dependency bundle. */
export function buildToolRegistry(deps: ToolPackDeps): ToolRegistry {
  const definitions = collectDefinitions(deps)
  assertNoDestructiveNames(definitions)
  assertUniqueNames(definitions)
  assertExpectedCount(definitions)
  assertLabelsPresent(definitions)
  const schemas = definitions.map(renderSchema)
  const tools: readonly RegisteredTool<unknown, unknown>[] = definitions
  return {
    list: () => tools,
    get: (name: string) => tools.find((tool) => tool.name === name),
    schemas: () => schemas,
    labelFor: (name: string) => TOOL_LABELS[name] ?? name,
  }
}

function collectDefinitions(deps: ToolPackDeps): readonly ToolDefinition<unknown>[] {
  return [
    ...createReadTools(deps),
    ...createInfoTools(deps),
    ...createResumeTools(deps),
    ...createDraftTools(deps),
    ...createCanvasTools(deps),
    ...createUndoTools(deps),
  ]
}

/** Guard 1: no tool name may read as a deletion. */
export function assertNoDestructiveNames(tools: readonly ToolDefinition<unknown>[]): void {
  for (const tool of tools) {
    if (FORBIDDEN_TOOL_NAME_PATTERN.test(tool.name)) {
      throw new Error(
        `Tool "${tool.name}" implies a destructive operation; the product exposes no delete tool.`,
      )
    }
  }
}

/** Guard 2: two tools may not share a name. */
export function assertUniqueNames(tools: readonly ToolDefinition<unknown>[]): void {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Tool "${tool.name}" is registered twice.`)
    seen.add(tool.name)
  }
}

/** Guard 3: the count is exact, so a forgotten registration fails at build time. */
export function assertExpectedCount(tools: readonly ToolDefinition<unknown>[]): void {
  if (tools.length !== EXPECTED_TOOL_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_TOOL_COUNT.toString()} tools, found ${tools.length.toString()}; ` +
        'a tool was added or removed without updating the expected count.',
    )
  }
}

/** Guard 4: every write and draft tool carries a Chinese card label. */
export function assertLabelsPresent(tools: readonly ToolDefinition<unknown>[]): void {
  for (const tool of tools) {
    if (!LABELLED_RISKS.has(tool.risk)) continue
    if (TOOL_LABELS[tool.name] === undefined || TOOL_LABELS[tool.name] === '') {
      throw new Error(`Tool "${tool.name}" is a ${tool.risk} tool without a card label.`)
    }
  }
}

/** Renders one declared schema; an unrenderable schema is a build error. */
function renderSchema(tool: ToolDefinition<unknown>): ToolSchema {
  let parametersJsonSchema: unknown
  try {
    parametersJsonSchema = z.toJSONSchema(tool.schema)
  } catch (failure) {
    throw new Error(
      `Tool "${tool.name}" declares a schema that cannot be rendered: ${
        failure instanceof Error ? failure.message : String(failure)
      }`,
    )
  }
  return { name: tool.name, description: tool.description, parametersJsonSchema }
}
