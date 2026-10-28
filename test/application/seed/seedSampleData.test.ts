/**
 * @file seedSampleData.test
 * @description What the sample action promises: the documented counts, every
 * value written through the ordinary use cases with user provenance, one draft
 * and one finalized resume, a conversation whose assistant turn is finished, and
 * a second run that changes nothing.
 */

import { describe, expect, it } from 'vitest'

import { INFO_MODULE_KINDS } from '../../../src/domain/info/InfoModuleKind'
import { stubCompositionRoot } from '../../support/stubCompositionRoot'

describe('seedSampleData', () => {
  it('fills the library with the documented counts and user provenance', async () => {
    const root = stubCompositionRoot()

    const result = await root.seed.seedSampleData()

    expect(result.alreadySeeded).toBe(false)
    expect(result.infoEntries).toBe(23)
    expect(result.resumes).toBe(2)
    expect(result.messages).toBe(3)

    const library = await root.info.listEntries()
    const counts = new Map<string, number>()
    for (const entry of library.entries) {
      counts.set(entry.moduleKind, (counts.get(entry.moduleKind) ?? 0) + 1)
      expect(entry.origin).toBe('user')
      expect(entry.sourceRunId).toBeNull()
    }
    expect(counts.get('personal')).toBe(1)
    expect(counts.get('education')).toBe(2)
    expect(counts.get('internship')).toBe(3)
    expect(counts.get('project')).toBe(5)
    expect(counts.get('skill')).toBe(6)
    expect(counts.get('award')).toBe(2)
    expect(counts.get('jobIntent')).toBe(1)
    expect(counts.get('selfEvaluation')).toBe(1)
    expect(counts.get('custom')).toBe(2)
    expect([...counts.keys()].every((kind) => INFO_MODULE_KINDS.includes(kind as never))).toBe(true)

    expect(library.customModules).toHaveLength(1)
    expect(library.customModules[0]?.name).toBe('开源贡献')
    expect(library.customModules[0]?.fields).toHaveLength(2)
  })

  it('creates one draft and one finalized resume', async () => {
    const root = stubCompositionRoot()

    await root.seed.seedSampleData()

    const resumes = await root.resume.listResumes()
    expect(resumes).toHaveLength(2)
    const draft = resumes.find((resume) => resume.status === 'draft')
    const frozen = resumes.find((resume) => resume.status === 'frozen')
    expect(draft).toBeDefined()
    expect(frozen).toBeDefined()
    expect(draft?.document.sections.some((section) => section.entryIds.length > 0)).toBe(true)
    expect(frozen?.snapshots).toHaveLength(1)
    expect(frozen?.targetJob?.company).toBe('云帆互动')
  })

  it('creates one conversation whose assistant turn is finished', async () => {
    const root = stubCompositionRoot()

    const result = await root.seed.seedSampleData()
    expect(result.conversationId).not.toBeNull()

    const listed = await root.conversation.listConversations()
    const conversation = listed.conversations.find(
      (candidate) => candidate.title === '示例：前端实习申请',
    )
    expect(conversation).toBeDefined()
    const messages = await root.conversation.listMessages(conversation?.id as never, 10)
    expect(messages).toHaveLength(3)
    expect(messages.map((message) => message.kind)).toEqual(['user', 'assistant', 'user'])
    const assistant = messages.find((message) => message.kind === 'assistant')
    expect(assistant?.status).toBe('complete')
    expect(assistant?.runId).toBeNull()
  })

  it('shares one run between triggers that land together', async () => {
    const root = stubCompositionRoot()

    await Promise.all([root.seed.seedSampleData(), root.seed.seedSampleData()])

    expect((await root.info.listEntries()).entries).toHaveLength(23)
    expect(await root.resume.listResumes()).toHaveLength(2)
  })

  it('marks the settings row and does nothing on a second run', async () => {
    const root = stubCompositionRoot()
    await root.seed.seedSampleData()

    const settings = await root.settings.read()
    expect(settings.sampleDataSeeded).toBe(true)

    const before = await root.info.listEntries()
    const second = await root.seed.seedSampleData()

    expect(second.alreadySeeded).toBe(true)
    expect((await root.info.listEntries()).entries).toHaveLength(before.entries.length)
    expect(await root.resume.listResumes()).toHaveLength(2)
  })
})
