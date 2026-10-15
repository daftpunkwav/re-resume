/**
 * @file fakeResumeServices
 * @description The composition root a presentation test renders against.
 *
 * Every service member is a mock that records its call and then throws, so a
 * test that reaches a method it never arranged fails with the method name
 * rather than with a silently undefined value. A test stubs what it expects
 * to be called and nothing else.
 */

import { vi } from 'vitest'
import type { Mock } from 'vitest'

import type { CompositionRoot, ExperienceLibrary, ResumeWorkbench } from '../../src/bootstrap/compositionRoot'
import type { AgentConsole } from '../../src/bootstrap/compositionRoot'

export interface RecordedCall {
  readonly method: string
  readonly args: readonly unknown[]
}

export interface FakeResumeWorkbench {
  readonly calls: RecordedCall[]
  readonly list: Mock
  readonly get: Mock
  readonly create: Mock
  readonly duplicate: Mock
  readonly commit: Mock
  readonly undo: Mock
  readonly redo: Mock
  readonly freeze: Mock
  readonly compare: Mock
  readonly materialize: Mock
  readonly layOut: Mock
  readonly staleReferences: Mock
}

export interface FakeExperienceLibrary {
  readonly calls: RecordedCall[]
  readonly list: Mock
  readonly get: Mock
  readonly create: Mock
}

export interface FakeResumeServices {
  readonly root: CompositionRoot
  readonly resumes: FakeResumeWorkbench
  readonly experiences: FakeExperienceLibrary
  /** Deterministic identifiers, so an added block id is assertable. */
  nextIdentifier: () => string
}

export interface FakeResumeServiceOverrides {
  readonly resumes?: Partial<Record<keyof ResumeWorkbench, unknown>>
  readonly experiences?: Partial<Record<keyof ExperienceLibrary, unknown>>
}

export function createFakeResumeServices(
  overrides: FakeResumeServiceOverrides = {},
): FakeResumeServices {
  const calls: RecordedCall[] = []
  const experienceCalls: RecordedCall[] = []
  let sequence = 0

  const workbench = {
    calls,
    list: refusing(calls, 'resumes.list'),
    get: refusing(calls, 'resumes.get'),
    create: refusing(calls, 'resumes.create'),
    duplicate: refusing(calls, 'resumes.duplicate'),
    commit: refusing(calls, 'resumes.commit'),
    undo: refusing(calls, 'resumes.undo'),
    redo: refusing(calls, 'resumes.redo'),
    freeze: refusing(calls, 'resumes.freeze'),
    compare: refusing(calls, 'resumes.compare'),
    materialize: refusing(calls, 'resumes.materialize'),
    layOut: refusing(calls, 'resumes.layOut'),
    staleReferences: refusing(calls, 'resumes.staleReferences'),
    ...overrides.resumes,
  } as unknown as FakeResumeWorkbench

  const experiences = {
    calls: experienceCalls,
    list: refusing(experienceCalls, 'experiences.list'),
    get: refusing(experienceCalls, 'experiences.get'),
    create: refusing(experienceCalls, 'experiences.create'),
    ...overrides.experiences,
  } as unknown as FakeExperienceLibrary

  const root = {
    clock: { now: () => new Date().toISOString() },
    ids: { next: () => `id-${(sequence += 1)}` },
    resumes: workbench,
    experiences,
    profile: refusing([], 'profile') as unknown as CompositionRoot['profile'],
    agent: refusing([], 'agent') as unknown as AgentConsole,
    shutdown: vi.fn(async () => undefined),
  } as unknown as CompositionRoot

  return {
    root,
    resumes: workbench,
    experiences,
    nextIdentifier: () => `id-${(sequence += 1)}`,
  }
}

/** Calls of one service member, in order. */
export function callsTo(workbench: FakeResumeWorkbench, method: string): RecordedCall[] {
  return workbench.calls.filter((call) => call.method === method)
}

function refusing(calls: RecordedCall[], method: string): Mock {
  return vi.fn((...args: unknown[]) => {
    calls.push({ method, args })
    throw new Error(`${method} was called without a stub.`)
  })
}
