/**
 * @file buildToolRegistry
 * @description The production tool registry. This build registers no tool: the
 * assistant can stream a conversation, but every change to the data has to be a
 * tool, and none has been installed yet. The run loop therefore offers the model
 * an empty tool list and a call to an unregistered name is refused.
 *
 * Constraints:
 * - A registered tool's `parse` is the only argument validator; this module
 *   never pre-validates.
 * - The label lookup falls back to the tool name, so an unlabelled tool cannot
 *   crash a card render.
 */

import type { RegisteredTool, ToolRegistry } from '../../domain/generation/ports/ToolRegistry'

const NO_TOOLS: readonly RegisteredTool<unknown, unknown>[] = []

export function buildToolRegistry(): ToolRegistry {
  return {
    list: () => NO_TOOLS,
    get: (name: string) => NO_TOOLS.find((tool) => tool.name === name),
    schemas: () => [],
    labelFor: (name: string) => name,
  }
}
