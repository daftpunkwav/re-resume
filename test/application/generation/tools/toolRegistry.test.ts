/**
 * @file toolRegistry.test
 * @description The registry contract: the exact tool count, the four
 * construction guards, the rendered JSON schema shape and the label lookup.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  EXPECTED_TOOL_COUNT,
  FORBIDDEN_TOOL_NAME_PATTERN,
  assertExpectedCount,
  assertLabelsPresent,
  assertNoDestructiveNames,
  assertUniqueNames,
} from '../../../../src/application/generation/buildToolRegistry'
import { TOOL_LABELS } from '../../../../src/application/generation/toolLabels'
import { defineTool } from '../../../../src/application/generation/tools/toolSchema'
import type { ToolDefinition } from '../../../../src/application/generation/tools/toolSchema'
import { createToolBed } from '../../../support/toolBed'

const EXPECTED_NAMES = [
  'searchInfoEntries',
  'getInfoEntries',
  'listInfoModules',
  'listResumes',
  'getResume',
  'listTemplates',
  'readJobPosting',
  'checkLayoutOverflow',
  'analyzeJobDescription',
  'createInfoEntry',
  'updateInfoEntry',
  'createCustomModule',
  'createResume',
  'updateResume',
  'setSectionSelection',
  'setSectionOrder',
  'setSectionDisplay',
  'setTemplate',
  'setAppearance',
  'setPageSetup',
  'writeResumeSummary',
  'writeEntryOverride',
  'addCanvasBlock',
  'moveCanvasBlock',
  'undoLastChange',
] as const

function fakeTool(name: string, risk: 'read' | 'write' | 'draft' = 'write'): ToolDefinition<unknown> {
  return defineTool({
    name,
    description: 'fake',
    risk,
    schema: z.strictObject({}),
    execute: async () => ({}),
  })
}

describe('the production registry', () => {
  it('registers exactly the 25 tools of the pack', () => {
    const { registry } = createToolBed()
    const names = registry.list().map((tool) => tool.name).sort()
    expect(registry.list()).toHaveLength(EXPECTED_TOOL_COUNT)
    expect(names).toEqual([...EXPECTED_NAMES].sort())
    expect(EXPECTED_TOOL_COUNT).toBe(25)
  })

  it('offers a renderable object schema for every tool', () => {
    const { registry } = createToolBed()
    const schemas = registry.schemas()
    expect(schemas).toHaveLength(EXPECTED_TOOL_COUNT)
    for (const schema of schemas) {
      expect(schema.name).not.toBe('')
      expect(schema.description).not.toBe('')
      const json = schema.parametersJsonSchema as {
        type?: string
        additionalProperties?: boolean
      }
      expect(json.type, schema.name).toBe('object')
      expect(json.additionalProperties, schema.name).toBe(false)
    }
  })

  it('resolves a tool and falls back to the name for an unlabelled lookup', () => {
    const { registry } = createToolBed()
    expect(registry.get('createResume')?.risk).toBe('write')
    expect(registry.get('nope')).toBeUndefined()
    expect(registry.labelFor('createResume')).toBe(TOOL_LABELS['createResume'])
    expect(registry.labelFor('unlabelled')).toBe('unlabelled')
  })

  it('labels every write and draft tool and no destructive name exists', () => {
    const { registry } = createToolBed()
    for (const tool of registry.list()) {
      if (tool.risk === 'read') continue
      expect(TOOL_LABELS[tool.name], tool.name).toBeTruthy()
      expect(FORBIDDEN_TOOL_NAME_PATTERN.test(tool.name), tool.name).toBe(false)
    }
  })
})

describe('the construction guards', () => {
  it('rejects a destructive tool name without an allow-list', () => {
    expect(() => assertNoDestructiveNames([fakeTool('removeCanvasBlock')])).toThrow(/destructive/)
    expect(() => assertNoDestructiveNames([fakeTool('clearHistory')])).toThrow(/destructive/)
    expect(() => assertNoDestructiveNames([fakeTool('createResume')])).not.toThrow()
  })

  it('rejects a duplicate name and a wrong count', () => {
    expect(() => assertUniqueNames([fakeTool('a'), fakeTool('a')])).toThrow(/twice/)
    expect(() => assertExpectedCount([fakeTool('a')])).toThrow(/Expected 25/)
  })

  it('rejects a write tool without a label', () => {
    expect(() => assertLabelsPresent([fakeTool('unlabelledWrite', 'write')])).toThrow(
      /without a card label/,
    )
    expect(() => assertLabelsPresent([fakeTool('createResume', 'write')])).not.toThrow()
  })

  it('builds a registry whose list matches its schema list', () => {
    const { registry } = createToolBed()
    expect(registry.schemas().map((schema) => schema.name).sort()).toEqual(
      registry.list().map((tool) => tool.name).sort(),
    )
  })
})
