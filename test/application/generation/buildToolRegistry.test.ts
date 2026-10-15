/**
 * @file buildToolRegistry
 * @description The composition point is the only place the tool list exists, so
 * this is where a missing tool, a wrong risk level or an unconvertible schema
 * shows up.
 */

import { describe, expect, it } from 'vitest'
import { buildToolRegistry } from '../../../src/application/generation/buildToolRegistry'
import type { JobPostingRepository } from '../../../src/application/generation/ParseJobPosting'
import type { JobPosting } from '../../../src/domain/generation/JobPosting'
import type { JobPostingId } from '../../../src/domain/shared/branded-id'
import { asAgentRunId } from '../../../src/domain/shared/branded-id'
import { FixtureTextMeasurer } from '../../../src/infrastructure/measurement/FixtureTextMeasurer'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { SequentialIdGenerator } from '../../support/fakeEnvironment'
import { InMemoryResumeRepository } from '../../support/inMemoryResumeRepository'
import { FixedClock } from '../../support/fakeEnvironment'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RUN_ID = asAgentRunId('run-1')

/** The table in spec section 5, in the order the registry lists it. */
const EXPECTED_TOOLS: readonly (readonly [string, string])[] = [
  ['searchExperiences', 'read'],
  ['getExperienceDetails', 'read'],
  ['analyzeJobDescription', 'read'],
  ['matchExperiences', 'read'],
  ['checkResumeLayout', 'read'],
  ['compareResumeVersions', 'read'],
  ['selectExperienceVariant', 'write'],
  ['createResumeDraft', 'write'],
  ['addBlock', 'write'],
  ['moveBlock', 'write'],
  ['reorderResumeSections', 'write'],
  ['proposeVariant', 'propose'],
]

class EmptyJobPostings implements JobPostingRepository {
  async findById(_id: JobPostingId): Promise<JobPosting | null> {
    return null
  }

  async listAll(): Promise<readonly JobPosting[]> {
    return []
  }

  async save(jobPosting: JobPosting): Promise<void> {
    throw new Error(`The registry must not save a job posting; got "${jobPosting.id}".`)
  }
}

function registryDeps() {
  const clock = new FixedClock(NOW)
  const resumes = new InMemoryResumeRepository(() => clock.now())
  return {
    jobPostings: new EmptyJobPostings(),
    ids: new SequentialIdGenerator(),
    resumeCreation: resumes,
    measurer: new FixtureTextMeasurer(),
  }
}

describe('buildToolRegistry', () => {
  it('registers the twelve tools with the risk levels of the spec table', () => {
    const tools = buildToolRegistry(registryDeps(), RUN_ID)

    expect(tools.registry.list().map((tool) => [tool.name, tool.risk])).toEqual(EXPECTED_TOOLS)
  })

  it('registers no destructive tool, so no pending approval is reachable', () => {
    const tools = buildToolRegistry(registryDeps(), RUN_ID)

    expect(tools.registry.list().some((tool) => tool.risk === 'destructive')).toBe(false)
  })

  it('pairs every tool with a closed JSON Schema', () => {
    const tools = buildToolRegistry(registryDeps(), RUN_ID)

    expect(tools.schemas.map((schema) => schema.name)).toEqual(EXPECTED_TOOLS.map(([name]) => name))
    for (const schema of tools.schemas) {
      expect(schema.description.length).toBeGreaterThan(0)
      expect(schema.parametersJsonSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      })
    }
  })

  it('declares no body-text property on a write tool', () => {
    const tools = buildToolRegistry(registryDeps(), RUN_ID)

    for (const [name] of EXPECTED_TOOLS.filter(([, risk]) => risk === 'write')) {
      const schema = tools.schemas.find((entry) => entry.name === name)
      expect(Object.keys(readProperties(schema?.parametersJsonSchema))).not.toContain('content')
      expect(Object.keys(readProperties(schema?.parametersJsonSchema))).not.toContain('text')
    }
  })

  it('resolves a tool by name and reports an unknown name as undefined', () => {
    const tools = buildToolRegistry(registryDeps(), RUN_ID)

    expect(tools.registry.get('addBlock')?.risk).toBe('write')
    expect(tools.registry.get('deleteResume')).toBeUndefined()
  })

  it('builds a registry outside a run without pretending the tools have one', () => {
    const tools = buildToolRegistry(registryDeps(), null)

    expect(tools.registry.get('proposeVariant')?.name).toBe('proposeVariant')
  })
})

function readProperties(schema: unknown): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null) return {}
  const properties = (schema as { readonly properties?: unknown }).properties
  return typeof properties === 'object' && properties !== null
    ? (properties as Record<string, unknown>)
    : {}
}
